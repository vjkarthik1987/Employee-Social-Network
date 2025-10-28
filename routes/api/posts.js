// routes/api/posts.js
const express = require('express');
const { ensureAuth } = require('../../middleware/auth');
const Post = require('../../models/Post');

const router = express.Router({ mergeParams: true });

// GET /api/:org/posts?groupId=&q=&page=1&limit=10
// GET /api/:org/posts?groupId=&q=&type=&page=1&limit=10
router.get('/posts', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const q     = (req.query.q || '').trim();
    const groupId = req.query.groupId || null;
    const type  = (req.query.type || '').toUpperCase();
    const allowedTypes = new Set(['TEXT','IMAGE','LINK','POLL','ANNOUNCEMENT']);

    const match = { companyId: cid, deletedAt: null, status: 'PUBLISHED' };
    if (groupId) match.groupId = groupId;
    if (allowedTypes.has(type)) match.type = type;
    if (q) match.richText = { $regex: q, $options: 'i' };

    const [items, total] = await Promise.all([
      Post.find(match)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('_id type authorId groupId richText createdAt commentsCount reactionsCountByType viewsCount coverImageUrl')
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
router.post('/posts', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const { type = 'TEXT', richText = '', groupId = null, isPinned = false, poll = null } = req.body;

    // Policy: moderated orgs queue by default
    const mode = (req.company?.policies?.postingMode || 'OPEN').toUpperCase();
    const status = mode === 'MODERATED' ? 'QUEUED' : 'PUBLISHED';

    const canPin = ['MODERATOR','ORG_ADMIN'].includes(req.user.role);
    // build pollDoc if needed (normalize array/object)
    let pollDoc = undefined;
    if (String(type).toUpperCase() === 'POLL' && poll) {
      let qs = poll.questions;
      if (qs && !Array.isArray(qs) && typeof qs === 'object') qs = Object.values(qs);
      if (!Array.isArray(qs)) qs = [];
      if (qs.length < 1 || qs.length > 10) return res.status(400).json({ ok:false, error:'POLL_QUESTION_COUNT' });
      const normQs = qs.map((q, qi) => {
        let opts = q?.options;
        if (opts && !Array.isArray(opts) && typeof opts === 'object') opts = Object.values(opts);
        if (!Array.isArray(opts)) opts = [];
        if (opts.length < 2 || opts.length > 10) throw new Error('POLL_OPTION_COUNT');
        const qid = String(q?.qid || (qi + 1).toString(36));
        const normOpts = opts.map((o, oi) => {
          const label = (typeof o === 'object' ? String(o.label || '') : String(o || '')).trim();
          const oid = String((typeof o === 'object' ? (o.oid || (oi + 1).toString(36)) : (oi + 1).toString(36)));
          return { oid, label, votesCount: 0 };
        });
        return { qid, text: String(q?.text || '').trim(), options: normOpts, multiSelect: !!q?.multiSelect };
      });
      pollDoc = {
        title: String(poll.title || '').trim(),
        questions: normQs,
        totalParticipants: 0,
        voterIds: [],
        isClosed: false,
        closesAt: poll.closesAt ? new Date(poll.closesAt) : null
      };
    }
    const post = await Post.create({
      companyId: cid,
      authorId: req.user._id,
      groupId: groupId || null,
      type,
      richText,
      status,
      isPinned: type === 'ANNOUNCEMENT' ? !!(canPin && isPinned) : false,
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    });

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
