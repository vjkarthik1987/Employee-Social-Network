// controllers/postController.js

const User = require('../models/User');
const Post = require('../models/Post');
const Group = require('../models/Group');
const Comment = require('../models/Comment');
const Attachment = require('../models/Attachment');
const audit = require('../services/auditService');


// ---- Helpers ----
function companyIdOf(req) {
  return req.companyId || (req.company && req.company._id);
}

// Utility to fetch user’s group IDs (owner/mod/member)
async function memberGroupIds(companyId, userId) {
  const rows = await Group.find({
    companyId,
    $or: [{ owners: userId }, { moderators: userId }, { members: userId }]
  }).select('_id').lean();
  return rows.map(r => r._id);
}

async function attachFirstImages(posts, companyId) {
  if (!posts?.length) return posts;
  const ids = posts.map(p => p._id);
  const rows = await Attachment.aggregate([
    { $match: { companyId, targetType: 'post', targetId: { $in: ids } } },
    { $group: { _id: '$targetId', url: { $first: '$storageUrl' } } },
  ]);
  const map = new Map(rows.map(r => [String(r._id), r.url]));
  posts.forEach(p => (p.firstAttachmentUrl = map.get(String(p._id))));
  return posts;
}

// Light helper to attach { group: { _id, name } } for cards
const { Types } = require('mongoose');
async function attachGroupStubs(posts, companyId) {
  const groupIds = Array.from(
    new Set(
      posts
        .map(p => p.groupId)
        .filter(id => id && Types.ObjectId.isValid(id))
        .map(id => String(id))
    )
  );
  if (!groupIds.length) return posts;
  const groups = await Group.find({ companyId, _id: { $in: groupIds } })
    .select('_id name')
    .lean();
  const byId = new Map(groups.map(g => [String(g._id), g]));
  posts.forEach(p => {
        if (p.groupId && Types.ObjectId.isValid(p.groupId)) {
            p.group = byId.get(String(p.groupId));
         }
  });
  return posts;
}

function canDelete(user, post) {
  if (!user) return false;
  const isAuthor = String(user._id) === String(post.authorId?._id || post.authorId);
  const isMod = user.role === 'MODERATOR' || user.role === 'ORG_ADMIN';
  return isAuthor || isMod;
}

// --- Blocked words helper ---
function findBlockedMatches(text, blockedWords = []) {
  if (!text || !blockedWords?.length) return [];
  const hay = String(text).toLowerCase();
  const hits = [];
  for (const raw of blockedWords) {
    const w = String(raw || '').trim().toLowerCase();
    if (!w) continue;
    // word-boundary if purely word chars; else substring match
    const isWord = /^[a-z0-9]+$/i.test(w);
    const re = isWord ? new RegExp(`\\b${w}\\b`, 'i') : new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(hay)) hits.push(raw);
  }
  // de-dupe, cap to a few to keep flash message short
  return Array.from(new Set(hits)).slice(0, 5);
}

//----Showing post view and reaction counts ------//
function sumReactions(byType = {}) {
  const vals = Object.values(byType || {});
  return vals.reduce((a, b) => a + (Number(b) || 0), 0);
}

function computeDerived(post) {
  post.totalReactions = sumReactions(post.reactionsCountByType);
  const denom = Math.max(post.viewsCount || 0, 1);
  post.engagementRate = ((post.totalReactions + (post.commentsCount || 0)) / denom) * 100;
  // keep 1 decimal place for UI
  post.engagementRate = Math.round(post.engagementRate * 10) / 10;
  return post;
}
function ensureViewedSession(req) {
  if (!req.session) return;
  if (!Array.isArray(req.session.viewedPosts)) req.session.viewedPosts = [];
  // cap to prevent bloat
  if (req.session.viewedPosts.length > 500) req.session.viewedPosts = req.session.viewedPosts.slice(-300);
}

function stripTags(html = '') { return String(html || '').replace(/<[^>]*>/g, ' '); }
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function makeExcerpt(text = '', q = '', win = 80) {
  if (!q) return '';
  const hay = stripTags(text);
  const idx = hay.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return '';
  const start = Math.max(0, idx - win);
  const end   = Math.min(hay.length, idx + q.length + win);
  const pre   = start > 0 ? '…' : '';
  const post  = end < hay.length ? '…' : '';
  const slice = hay.slice(start, end);
  const esc   = escapeHtml(slice);
  // highlight all occurrences, case-insensitive
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return pre + esc.replace(re, (m) => `<mark>${escapeHtml(m)}</mark>`) + post;
}
function pushRecentSearch(req, q) {
  if (!q) return;
  if (!req.session) return;
  if (!Array.isArray(req.session.recentSearches)) req.session.recentSearches = [];
  const arr = req.session.recentSearches.filter(v => v.toLowerCase() !== q.toLowerCase());
  arr.unshift(q);
  req.session.recentSearches = arr.slice(0, 8);
}


// ---- Controllers ----

// Company feed — paginated + Day 21 polish
exports.companyFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);

    // Filters
    const q        = (req.query.q || '').trim();
    const type     = (req.query.type || '').toUpperCase();
    const allowed  = new Set(['TEXT', 'IMAGE', 'LINK']);
    const authorId = (req.query.authorId && String(req.query.authorId)) || '';
    const people   = (req.query.people || '').trim();
    const from     = (req.query.from || '').trim();   // yyyy-mm-dd
    const to       = (req.query.to || '').trim();     // yyyy-mm-dd
    const myGroups = String(req.query.myGroups || '') === '1'; // only for company feed

    // Pagination
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '15', 10), 5), 50);
    const skip  = (page - 1) * limit;

    // Base match
    const match = { companyId: cid, deletedAt: null, status: 'PUBLISHED' };
    if (allowed.has(type)) match.type = type;

    // Author filter (explicit)
    if (authorId) match.authorId = authorId;

    // People (name/title → resolve to authorId list) — only if authorId not explicitly set
    if (!authorId && people) {
      const rx = new RegExp(people.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const User = require('../models/User');
      const users = await User.find({
        companyId: cid,
        $or: [{ fullName: rx }, { title: rx }]
      }).select('_id').lean();
      const ids = users.map(u => u._id);
      match.authorId = ids.length ? { $in: ids } : { $in: [] }; // no matches if empty
    }

    // Date range
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to)   match.createdAt.$lte = new Date(to   + 'T23:59:59.999Z');
    }

    // "My groups" (company feed only): restrict to groups the user belongs to
    if (myGroups) {
      const rows = await Group.find({
        companyId: cid,
        $or: [{ owners: req.user._id }, { moderators: req.user._id }, { members: req.user._id }]
      }).select('_id').lean();
      const ids = rows.map(r => r._id);
      match.groupId = { $in: ids }; // if ids is empty, it returns none, which is correct
    }

    // Query + relevance sort (with $text fallback to regex)
    let cursor, total;
    if (q) {
      try {
        const textQuery = { ...match, $text: { $search: q } };
        cursor = Post.find(textQuery, { score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
        total  = await Post.countDocuments(textQuery);
      } catch (_) {
        const rxQuery = { ...match, richText: { $regex: q, $options: 'i' } };
        cursor = Post.find(rxQuery).sort({ createdAt: -1 });
        total  = await Post.countDocuments(rxQuery);
      }
    } else {
      cursor = Post.find(match).sort({ createdAt: -1 });
      total  = await Post.countDocuments(match);
    }

    const posts = await cursor
      .skip(skip)
      .limit(limit)
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    await attachFirstImages(posts, cid);
    await attachGroupStubs(posts, cid);
    posts.forEach(p => {
      computeDerived(p);
      if (q) p._qExcerpt = makeExcerpt(p.richText || '', q, 80);
    });

    ensureViewedSession(req);
    const viewedPostIds = new Set((req.session?.viewedPosts || []).map(String));

    const totalPages   = Math.max(Math.ceil(total / limit), 1);
    const searchAction = `/${req.company.slug}/feed`;

    if (q) pushRecentSearch(req, q);
    const recentSearches = Array.isArray(req.session?.recentSearches) ? req.session.recentSearches : [];

    return res.render('feed/index', {
      company: req.company,
      user: req.user,
      posts,
      viewedPostIds,
      filters: {
        q,
        type: allowed.has(type) ? type : '',
        authorId,
        people,
        from,
        to,
        myGroups
      },
      searchAction,
      page, limit, total, totalPages,
      recentSearches,
    });
  } catch (err) { next(err); }
};

// Group feed — paginated + relevance + highlights + author/people/date
exports.groupFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { groupId } = req.params;

    const group = await Group.findOne({ _id: groupId, companyId: cid }).lean();
    if (!group) return res.status(404).render('errors/404');

    // Filters
    const q        = (req.query.q || '').trim();
    const type     = (req.query.type || '').toUpperCase();
    const allowed  = new Set(['TEXT', 'IMAGE', 'LINK']);
    const authorId = (req.query.authorId && String(req.query.authorId)) || '';
    const people   = (req.query.people || '').trim();
    const from     = (req.query.from || '').trim();
    const to       = (req.query.to || '').trim();

    // Pagination
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '15', 10), 5), 50);
    const skip  = (page - 1) * limit;

    // Base match — IMPORTANT: lock to this group
    const match = { companyId: cid, groupId, deletedAt: null, status: 'PUBLISHED' };
    if (allowed.has(type)) match.type = type;

    // Author filter (explicit)
    if (authorId) match.authorId = authorId;

    // People (name/title → resolve to authorId list) — only if authorId not explicitly set
    if (!authorId && people) {
      const rx = new RegExp(people.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const User = require('../models/User');
      const users = await User.find({
        companyId: cid,
        $or: [{ fullName: rx }, { title: rx }]
      }).select('_id').lean();
      const ids = users.map(u => u._id);
      match.authorId = ids.length ? { $in: ids } : { $in: [] };
    }

    // Date range
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to)   match.createdAt.$lte = new Date(to   + 'T23:59:59.999Z');
    }

    // Query + relevance sort (with $text fallback to regex)
    let cursor, total;
    if (q) {
      try {
        const textQuery = { ...match, $text: { $search: q } };
        cursor = Post.find(textQuery, { score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' }, createdAt: -1 });
        total  = await Post.countDocuments(textQuery);
      } catch (_) {
        const rxQuery = { ...match, richText: { $regex: q, $options: 'i' } };
        cursor = Post.find(rxQuery).sort({ createdAt: -1 });
        total  = await Post.countDocuments(rxQuery);
      }
    } else {
      cursor = Post.find(match).sort({ createdAt: -1 });
      total  = await Post.countDocuments(match);
    }

    const posts = await cursor
      .skip(skip)
      .limit(limit)
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    await attachFirstImages(posts, cid);
    await attachGroupStubs(posts, cid);
    posts.forEach(p => {
      computeDerived(p);
      if (q) p._qExcerpt = makeExcerpt(p.richText || '', q, 80);
    });

    ensureViewedSession(req);
    const viewedPostIds = new Set((req.session?.viewedPosts || []).map(String));

    const totalPages   = Math.max(Math.ceil(total / limit), 1);
    const searchAction = `/${req.company.slug}/g/${group._id}`;

    if (q) pushRecentSearch(req, q);
    const recentSearches = Array.isArray(req.session?.recentSearches) ? req.session.recentSearches : [];

    return res.render('feed/index', {
      company: req.company,
      user: req.user,
      group,
      posts,
      viewedPostIds,
      filters: {
        q,
        type: allowed.has(type) ? type : '',
        authorId,
        people,
        from,
        to,
        myGroups: false // not applicable inside a specific group
      },
      searchAction,
      page, limit, total, totalPages,
      recentSearches,
    });
  } catch (err) { next(err); }
};

// Post detail
exports.getPost = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;

    let post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();
    if (!post) return res.status(404).render('errors/404');

    // Day 14: session-unique views bump
    ensureViewedSession(req);
    const alreadyViewed = (req.session?.viewedPosts || []).map(String).includes(String(post._id));
    if (!alreadyViewed) {
      await Post.updateOne({ _id: post._id, companyId: cid }, { $inc: { viewsCount: 1 } });
      // reflect increment in the in-memory object so the page shows the correct count
      post.viewsCount = (post.viewsCount || 0) + 1;
      req.session.viewedPosts.push(String(post._id));
    }

    // First image
    const firstAttach = await Attachment.findOne({
      companyId: cid,
      targetType: 'post',
      targetId: post._id,
    }).select('storageUrl').lean();
    post.firstAttachmentUrl = firstAttach?.storageUrl || post.firstAttachmentUrl;

    // Group stub (for breadcrumb)
    if (post.groupId) {
      post.group = await Group.findOne({ _id: post.groupId, companyId: cid })
        .select('_id name')
        .lean();
    }

    // Day 14: derived metrics for detail view
    post = computeDerived(post);

    // Load comments (visible only)
    const comments = await Comment.find({ postId: post._id, status: { $ne: 'deleted' } })
      .sort({ createdAt: 1 })
      .populate('authorId', 'fullName avatarUrl title')
      .lean();

    return res.render('posts/show', {
      company: req.company,
      user: req.user,
      post,
      comments,
      viewed: true, // current session has viewed this post
    });
  } catch (err) { next(err); }
};

// Create post (TEXT/LINK/IMAGE)
exports.create = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { type = 'TEXT', content, linkUrl, groupId: rawGroupId } = req.body;
    const groupId = rawGroupId && rawGroupId !== 'null' && rawGroupId !== '' ? rawGroupId : null;

    if (type === 'IMAGE' && !req.file) {
            const back = req.get('Referer') || `/${req.company?.slug || ''}/feed`;
            req.flash('error', 'Please attach an image (JPG/PNG/GIF up to 2 MB).');
            return res.redirect(back);
    }

    // Determine initial status (Day 11 will add approval queue UI)
    const postingMode = req.company?.policies?.postingMode || 'OPEN';
    const status = postingMode === 'MODERATED' ? 'QUEUED' : 'PUBLISHED';

    // Policies: blocked words soft validation
    const blocked = req.company?.policies?.blockedWords || [];
    const toScan = [
      content || '',
      linkUrl || '',
    ].join(' ');
    const matches = findBlockedMatches(toScan, blocked);
    if (matches.length) {
      const back = req.get('Referer') || `/${req.company?.slug || ''}/feed`;
      req.flash('error', `Your post includes blocked terms: ${matches.join(', ')}. Please edit and try again.`);
      return res.redirect(back);
    }

    const post = await Post.create({
      companyId: cid,
      authorId: req.user._id,
      groupId: groupId || null,
      type,
      richText: content || '',
      status,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // If IMAGE: persist attachment + increment counter
    if (type === 'IMAGE' && req.file) {
      const storageUrl = req.file.secure_url || req.file.path || req.file.location;
      await Attachment.create({ companyId: cid, ownerUserId: req.user._id,
        targetType: 'post', targetId: post._id, storageUrl,
        mimeType: req.file.mimetype, sizeBytes: req.file.size
      });
      await Post.updateOne(
        { _id: post._id },
        {
          $inc: { attachmentsCount: 1 },
          $setOnInsert: { coverImageUrl: storageUrl }, // or set if null in a second update
          $set: { coverImageUrl: storageUrl } // if you want first image to be cover when empty
        }
      );
    }

    try {
      await audit.record({
        companyId: cid,
        actorUserId: req.user._id,
        action: 'POST_CREATED',
        targetType: 'post',
        targetId: post._id,
        metadata: {
          type,
          groupId: groupId || null,
          status,
          hadImage: type === 'IMAGE' && !!req.file,
        },
      });
    } catch (_e) {}
    
    // (Optional) LINK handling: you can later trigger a preview fetcher job using linkUrl/content.

    req.flash(
      'success',
      status === 'QUEUED' ? 'Submitted for approval.' : 'Post created.'
    );
    return res.redirect(`/${req.company.slug}/feed`);
  } catch (err) {
    // Multer validation errors surface here as plain Error
    const back = req.get('Referer') || `/${req.company?.slug || ''}/feed`;
    req.flash('error', err?.message || 'Unable to create post.');
    return res.redirect(back);
  }
};

// Delete (soft delete)
exports.destroy = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;

    const post = await Post.findOne({ _id: postId, companyId: cid });
    if (!post) return res.status(404).render('errors/404');

    if (!canDelete(req.user, post)) {
      req.flash('error', 'You do not have permission to delete this post.');
      return res.redirect(`/${req.company.slug}/posts/${postId}`);
    }

    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    await post.save();

    req.flash('success', 'Post deleted.');
    return res.redirect(`/${req.company.slug}/feed`);
  } catch (err) {
    next(err);
  }
};

module.exports = {
  companyFeed: exports.companyFeed,
  groupFeed: exports.groupFeed,
  getPost: exports.getPost,
  create: exports.create,
  destroy: exports.destroy,
};
