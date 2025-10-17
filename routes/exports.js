// routes/exports.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const Post = require('../models/Post');
const User = require('../models/User');
const Group = require('../models/Group');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const Attachment = require('../models/Attachment');

const router = express.Router({ mergeParams: true });

// Helpers (minimal copies from controller)
function stripTags(html = '') { return String(html || '').replace(/<[^>]*>/g, ' '); }
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (/[",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /:org/export/posts.csv?…(same filters as feed)
router.get('/export/posts.csv', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;

    // Query params (mirror Day 23)
    const q        = (req.query.q || '').trim();
    const type     = (req.query.type || '').toUpperCase();
    const allowed  = new Set(['TEXT', 'IMAGE', 'LINK']);
    const authorId = (req.query.authorId && String(req.query.authorId)) || '';
    const people   = (req.query.people || '').trim();
    const from     = (req.query.from || '').trim();
    const to       = (req.query.to || '').trim();
    const myGroups = String(req.query.myGroups || '') === '1';
    const groupId  = (req.query.groupId && String(req.query.groupId)) || '';

    const match = { companyId: cid, deletedAt: null, status: 'PUBLISHED' };
    if (allowed.has(type)) match.type = type;
    if (groupId) match.groupId = groupId;
    if (authorId) match.authorId = authorId;

    // People → authorId IN set
    if (!authorId && people) {
      const rx = new RegExp(people.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const users = await User.find({ companyId: cid, $or: [{ fullName: rx }, { title: rx }] })
        .select('_id').lean();
      const ids = users.map(u => u._id);
      match.authorId = ids.length ? { $in: ids } : { $in: [] };
    }

    // Date range
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from + 'T00:00:00.000Z');
      if (to)   match.createdAt.$lte = new Date(to   + 'T23:59:59.999Z');
    }

    // My groups (only when not locked to single group)
    if (!groupId && myGroups) {
      const rows = await Group.find({
        companyId: cid,
        $or: [{ owners: req.user._id }, { moderators: req.user._id }, { members: req.user._id }]
      }).select('_id').lean();
      const ids = rows.map(r => r._id);
      match.groupId = { $in: ids };
    }

    // Build base cursor (we’ll not paginate—export all that match, but we’ll cap hard ceiling)
    const hardCap = Math.min(Math.max(parseInt(req.query.max || '5000', 10), 100), 20000);
    let cursor;
    if (q) {
      try {
        cursor = Post.find({ ...match, $text: { $search: q } }, { score: { $meta: 'textScore' } })
          .sort({ score: { $meta: 'textScore' }, createdAt: -1 })
          .limit(hardCap);
      } catch (_) {
        cursor = Post.find({ ...match, richText: { $regex: q, $options: 'i' } })
          .sort({ createdAt: -1 })
          .limit(hardCap);
      }
    } else {
      cursor = Post.find(match).sort({ createdAt: -1 }).limit(hardCap);
    }

    const posts = await cursor
      .populate('authorId', 'fullName title')
      .populate('groupId', 'name')
      .lean();

    // Get attachments (we'll include up to 3 URLs per post, comma-separated)
    const ids = posts.map(p => p._id);
    const att = await Attachment.find({ companyId: cid, targetType: 'post', targetId: { $in: ids } })
      .select('targetId storageUrl')
      .lean();
    const attMap = new Map();
    att.forEach(a => {
      const k = String(a.targetId);
      if (!attMap.has(k)) attMap.set(k, []);
      const arr = attMap.get(k);
      if (arr.length < 3) arr.push(a.storageUrl);
    });

    // CSV header
    let csv = [
      'postId',
      'createdAt',
      'type',
      'group',
      'author',
      'authorTitle',
      'text',
      'commentsCount',
      'totalReactions',
      'viewsCount',
      'imageUrls',
      'permalink'
    ].join(',') + '\n';

    // Build rows
    posts.forEach(p => {
      const totalReactions = Object.values(p.reactionsCountByType || {}).reduce((a,b)=>a+(+b||0),0);
      const imgs = (attMap.get(String(p._id)) || []).join(' | '); // pipe-separated inside the single CSV field
      const url = `/${req.params.org}/posts/${p._id}`;

      csv += [
        csvEscape(p._id),
        csvEscape(p.createdAt?.toISOString?.() || ''),
        csvEscape(p.type || ''),
        csvEscape(p.groupId?.name || ''),
        csvEscape(p.authorId?.fullName || ''),
        csvEscape(p.authorId?.title || ''),
        csvEscape(stripTags(p.richText || '').slice(0, 2000)), // keep it sane
        csvEscape(p.commentsCount || 0),
        csvEscape(totalReactions),
        csvEscape(p.viewsCount || 0),
        csvEscape(imgs),
        csvEscape(url)
      ].join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="posts-export.csv"');
    return res.send(csv);
  } catch (e) { next(e); }
});

// -------------- NEW: Full-tenant JSON snapshot --------------
router.get('/admin/export/backup.json', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const cid = req.companyId;
    const [companyUsers, groups, posts, comments, reactions, reports, attachments] = await Promise.all([
      User.find({ companyId: cid }).lean(),
      Group.find({ companyId: cid }).lean(),
      Post.find({ companyId: cid }).lean(),
      Comment.find({ companyId: cid }).lean(),
      Reaction.find({ companyId: cid }).lean(),
      Report.find({ companyId: cid }).lean(),
      Attachment.find({ companyId: cid }).lean(),
    ]);

    const payload = {
      org: req.company.slug,
      exportedAt: new Date().toISOString(),
      users: companyUsers,
      groups,
      posts,
      comments,
      reactions,
      reports,
      attachments,
    };

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.company.slug}-backup.json"`);
    return res.status(200).send(JSON.stringify(payload, null, 2));
  } catch (e) { next(e); }
});

// -------------- NEW: NDJSON stream (big-tenants friendly) --------------
router.get('/admin/export/backup.ndjson', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const cid = req.companyId;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.company.slug}-backup.ndjson"`);

    const write = (obj) => res.write(JSON.stringify(obj) + '\n');

    write({ _meta: { org: req.company.slug, exportedAt: new Date().toISOString() } });

    const collections = [
      ['users',       User.find({ companyId: cid }).lean().cursor()],
      ['groups',      Group.find({ companyId: cid }).lean().cursor()],
      ['posts',       Post.find({ companyId: cid }).lean().cursor()],
      ['comments',    Comment.find({ companyId: cid }).lean().cursor()],
      ['reactions',   Reaction.find({ companyId: cid }).lean().cursor()],
      ['reports',     Report.find({ companyId: cid }).lean().cursor()],
      ['attachments', Attachment.find({ companyId: cid }).lean().cursor()],
    ];

    for (const [name, cursor] of collections) {
      write({ _collection: name, _begin: true });
      for await (const doc of cursor) write({ _collection: name, doc });
      write({ _collection: name, _end: true });
    }

    res.end();
  } catch (e) { next(e); }
});

module.exports = router;
