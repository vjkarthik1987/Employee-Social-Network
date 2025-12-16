// controllers/adminPointsController.js
const PointEvent = require('../models/PointEvent');
const User = require('../models/User');

// ✅ add these 3
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');

function dayStart(s) {
  const d = s ? new Date(s) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function dayEnd(s) {
  const d = s ? new Date(s) : new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toMap(rows, fieldName) {
  return new Map(rows.map(r => [String(r._id), Number(r[fieldName] || 0)]));
}

/**
 * Build leaderboard for a date range.
 * - Points/events from PointEvent
 * - Counts from Post/Comment/Reaction
 * - Optional userId filter (earner)
 */
async function buildLeaderboard({ companyId, from, to, userId = '' }) {
    const match = { companyId, createdAt: { $gte: from, $lte: to } };
    if (userId) match.userId = userId;
  
    const rows = await PointEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$userId',
          points: { $sum: '$points' },
          events: { $sum: 1 },
  
          // activity counts (based on your pointsService action names)
          posts: {
            $sum: { $cond: [{ $eq: ['$action', 'POST_CREATED'] }, 1, 0] }
          },
          comments: {
            $sum: { $cond: [{ $eq: ['$action', 'COMMENT_CREATED'] }, 1, 0] }
          },
          replies: {
            $sum: { $cond: [{ $eq: ['$action', 'REPLY_CREATED'] }, 1, 0] }
          },
  
          // count only ADD reactions (not removes)
          reactions: {
            $sum: { $cond: [{ $eq: ['$action', 'REACTION_GIVEN_ADD'] }, 1, 0] }
          },
  
          // optional: likes specifically (if you want it)
          likes: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$action', 'REACTION_GIVEN_ADD'] },
                    { $eq: ['$meta.reactionType', 'LIKE'] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      { $sort: { points: -1 } },
      { $limit: 200 }
    ]);
  
    const ids = rows.map(r => r._id).filter(Boolean);
    const users = await User.find({ _id: { $in: ids } })
      .select('_id fullName email title avatarUrl')
      .lean();
    const uMap = new Map(users.map(u => [String(u._id), u]));
  
    return rows.map(r => ({
      user: uMap.get(String(r._id)) || { _id: r._id, fullName: 'Unknown', email: '' },
      points: r.points || 0,
      events: r.events || 0,
      posts: r.posts || 0,
      comments: r.comments || 0,
      replies: r.replies || 0,
      reactions: r.reactions || 0,
      likes: r.likes || 0
    }));
  }

// ------------------------------
// Views
// ------------------------------

exports.dashboard = async (req, res, next) => {
  try {
    const companyId = req.companyId || req.company?._id;
    const from = dayStart(req.query.from);
    const to = dayEnd(req.query.to);
    const userId = (req.query.userId || '').trim();

    const leaderboard = await buildLeaderboard({ companyId, from, to, userId });

    return res.render('admin/points', {
      company: req.company,
      user: req.user,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      leaderboard
    });
  } catch (e) {
    next(e);
  }
};

exports.pointsPage = async (req, res, next) => {
  try {
    const companyId = req.companyId || req.company?._id;

    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    to.setHours(23, 59, 59, 999);

    // 1) points + events from ledger
    const pointRows = await PointEvent.aggregate([
      { $match: { companyId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$userId', points: { $sum: '$points' }, events: { $sum: 1 } } },
      { $sort: { points: -1 } },
      { $limit: 500 }
    ]);

    const userIds = pointRows.map(r => r._id).filter(Boolean);

    // 2) activity counts (by actor)
    const [postRows, commentRows, replyRows, reactionRows, likeRows] = await Promise.all([
      Post.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, deletedAt: null } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, status: { $ne: 'deleted' }, level: 0 } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, status: { $ne: 'deleted' }, level: 1 } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Reaction.aggregate([
        { $match: { companyId, userId: { $in: userIds }, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } }
      ]),
      Reaction.aggregate([
        { $match: { companyId, userId: { $in: userIds }, reactionType: 'LIKE', createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } }
      ]),
    ]);

    const toMap = (rows) => new Map(rows.map(r => [String(r._id), r.n]));
    const postsMap = toMap(postRows);
    const commentsMap = toMap(commentRows);
    const repliesMap = toMap(replyRows);
    const reactionsMap = toMap(reactionRows);
    const likesMap = toMap(likeRows);

    // 3) users
    const users = await User.find({ _id: { $in: userIds } })
      .select('_id fullName email title avatarUrl')
      .lean();
    const uMap = new Map(users.map(u => [String(u._id), u]));

    const leaderboard = pointRows.map(r => {
      const uid = String(r._id);
      return {
        user: uMap.get(uid) || { _id: r._id, fullName: 'Unknown', email: '' },
        points: r.points || 0,
        events: r.events || 0,
        posts: postsMap.get(uid) || 0,
        comments: commentsMap.get(uid) || 0,
        replies: repliesMap.get(uid) || 0,
        reactions: reactionsMap.get(uid) || 0,
        likes: likesMap.get(uid) || 0
      };
    });

    return res.render('admin/points/index', {
      company: req.company,
      user: req.user,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      leaderboard
    });
  } catch (e) { next(e); }
};

  

// ------------------------------
// CSV export
// ------------------------------
exports.exportCsv = async (req, res, next) => {
  try {
    // reuse the same logic as pointsPage, but build rows and send CSV
    // easiest: call pointsPage logic by extracting to a helper,
    // but for now do a minimal duplication:

    const companyId = req.companyId || req.company?._id;
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    to.setHours(23, 59, 59, 999);

    const pointRows = await PointEvent.aggregate([
      { $match: { companyId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$userId', points: { $sum: '$points' }, events: { $sum: 1 } } },
      { $sort: { points: -1 } },
      { $limit: 1000 }
    ]);

    const userIds = pointRows.map(r => r._id).filter(Boolean);

    const [postRows, commentRows, replyRows, reactionRows, likeRows, users] = await Promise.all([
      Post.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, deletedAt: null } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, status: { $ne: 'deleted' }, level: 0 } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Comment.aggregate([
        { $match: { companyId, authorId: { $in: userIds }, createdAt: { $gte: from, $lte: to }, status: { $ne: 'deleted' }, level: 1 } },
        { $group: { _id: '$authorId', n: { $sum: 1 } } }
      ]),
      Reaction.aggregate([
        { $match: { companyId, userId: { $in: userIds }, createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } }
      ]),
      Reaction.aggregate([
        { $match: { companyId, userId: { $in: userIds }, reactionType: 'LIKE', createdAt: { $gte: from, $lte: to } } },
        { $group: { _id: '$userId', n: { $sum: 1 } } }
      ]),
      User.find({ _id: { $in: userIds } }).select('_id fullName email title').lean()
    ]);

    const toMap = (rows) => new Map(rows.map(r => [String(r._id), r.n]));
    const postsMap = toMap(postRows);
    const commentsMap = toMap(commentRows);
    const repliesMap = toMap(replyRows);
    const reactionsMap = toMap(reactionRows);
    const likesMap = toMap(likeRows);

    const uMap = new Map(users.map(u => [String(u._id), u]));

    const lines = [];
    lines.push([
      'userId','fullName','email','title',
      'points','events','posts','comments','replies','reactions','likes'
    ].join(','));

    for (const r of pointRows) {
      const uid = String(r._id);
      const u = uMap.get(uid) || {};
      lines.push([
        csvEscape(uid),
        csvEscape(u.fullName || ''),
        csvEscape(u.email || ''),
        csvEscape(u.title || ''),
        csvEscape(r.points || 0),
        csvEscape(r.events || 0),
        csvEscape(postsMap.get(uid) || 0),
        csvEscape(commentsMap.get(uid) || 0),
        csvEscape(repliesMap.get(uid) || 0),
        csvEscape(reactionsMap.get(uid) || 0),
        csvEscape(likesMap.get(uid) || 0),
      ].join(','));
    }

    const filename = `points_${req.company?.slug || 'org'}_${from.toISOString().slice(0,10)}_to_${to.toISOString().slice(0,10)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(lines.join('\n'));
  } catch (e) { next(e); }
};
