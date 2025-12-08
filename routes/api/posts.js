// routes/api/posts.js
const express = require('express');
const { ensureAuth } = require('../../middleware/auth');
const Post = require('../../models/Post');

const router = express.Router({ mergeParams: true });

// GET /api/:org/posts?groupId=&q=&page=1&limit=10
// GET /api/:org/posts?groupId=&q=&type=&page=1&limit=10
// routes/api/posts.js
router.get('/posts', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const q     = (req.query.q || '').trim();
    const groupId = req.query.groupId || null;
    const type  = (req.query.type || '').toUpperCase();
    const allowedTypes = new Set(['TEXT','IMAGE','LINK','POLL','ANNOUNCEMENT']);

    const now = new Date();

    const match = {
      companyId: cid,
      deletedAt: null,
      status: 'PUBLISHED',
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } }
      ]
    };

    if (groupId) match.groupId = groupId;
    if (allowedTypes.has(type)) match.type = type;
    if (q) match.richText = { $regex: q, $options: 'i' };

    const [items, total] = await Promise.all([
      Post.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('_id type title authorId groupId richText createdAt commentsCount reactionsCountByType viewsCount coverImageUrl')
        .lean(),
      Post.countDocuments(match),
    ]);

    res.json({ ok: true, data: items, page, limit, total });
  } catch (e) { next(e); }
});


// GET /api/:org/posts/:postId
router.get('/posts/:postId', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const post = await Post.findOne({
      _id: req.params.postId, companyId: cid, deletedAt: null
    }).lean();
    if (!post) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    res.json({ ok: true, data: post });
  } catch (e) { next(e); }
});

// POST /api/:org/posts  { type?, richText, groupId? }
// routes/api/posts.js

router.post('/posts', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const {
      type: incomingType = 'TEXT',
      richText = '',
      groupId = null,
      isPinned = false,
      poll = null
    } = req.body;

    const type = String(incomingType).toUpperCase();

    // 🔹 New inputs
    const title = (req.body.title || '').trim() || null;
    let expiresAt = null;
    if (req.body.expiresAt) {
      const d = new Date(req.body.expiresAt);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        expiresAt = d;
      }
    }

    const mode = (req.company?.policies?.postingMode || 'OPEN').toUpperCase();
    const status = mode === 'MODERATED' ? 'QUEUED' : 'PUBLISHED';

    const canPin = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);

    // ...existing pollDoc building code...

    const doc = {
      companyId: cid,
      authorId:  req.user._id,
      groupId:   groupId || null,
      type,
      richText,
      status,
      isPinned: type === 'ANNOUNCEMENT' ? !!(canPin && isPinned) : false,
      publishedAt: status === 'PUBLISHED' ? new Date() : null
    };

    if (type === 'ANNOUNCEMENT') {
      if (title) doc.title = title;
      doc.expiresAt = expiresAt;
    }

    const post = await Post.create(doc);

    res.status(201).json({ ok: true, data: post });
  } catch (e) { next(e); }
});


// PATCH /api/:org/posts/:postId  { richText? }  (edit only if not deleted & you’re author)
router.patch('/posts/:postId', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const { postId } = req.params;

    const post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null });
    if (!post) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

    const isAuthor = String(post.authorId) === String(req.user._id);
    const isPriv   = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);
    if (!(isAuthor || isPriv)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

    if (typeof req.body.richText === 'string') post.richText = req.body.richText;
    await post.save();

    res.json({ ok: true, data: post });
  } catch (e) { next(e); }
});

// DELETE /api/:org/posts/:postId  (soft delete; author or mod/admin)
router.delete('/posts/:postId', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const post = await Post.findOne({ _id: req.params.postId, companyId: cid });
    if (!post) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

    const isAuthor = String(post.authorId) === String(req.user._id);
    const isPriv   = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);
    if (!(isAuthor || isPriv)) return res.status(403).json({ ok: false, error: 'FORBIDDEN' });

    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    await post.save();

    res.json({ ok: true, data: { postId: post._id, deletedAt: post.deletedAt } });
  } catch (e) { next(e); }
});

module.exports = router;
