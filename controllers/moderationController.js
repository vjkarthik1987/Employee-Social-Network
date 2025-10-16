// controllers/moderationController.js
const { Types } = require('mongoose');
const Post = require('../models/Post');
const audit = require('../services/auditService');
const microcache = require('../middleware/microcache');

function cid(req) { return req.companyId || req.company?._id; }
function isObjId(v) { return Types.ObjectId.isValid(v); }

// GET /:org/mod/queue   (mods + admins)
exports.queue = async (req, res, next) => {
  try {
    const companyId = cid(req);

    const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 5), 100);
    const skip  = (page - 1) * limit;

    const match = { companyId, deletedAt: null, status: 'QUEUED' };

    const [items, total] = await Promise.all([
      Post.find(match)
        .sort({ createdAt: 1 }) // oldest first
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'fullName title avatarUrl')
        .lean(),
      Post.countDocuments(match),
    ]);

    const totalPages = Math.max(Math.ceil(total / limit), 1);

    return res.render('mod/queue', {
      company: req.company,
      user: req.user,
      posts: items,
      page, limit, total, totalPages,
    });
  } catch (e) { next(e); }
};

// POST /:org/posts/mod/approve   (body: postId)
exports.approve = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.body || {};
    if (!postId || !isObjId(postId)) { req.flash('error','Invalid id'); return res.redirect('back'); }

    const post = await Post.findOne({ _id: postId, companyId, deletedAt: null });
    if (!post) { req.flash('error','Not found'); return res.redirect('back'); }
    if (post.status === 'PUBLISHED') { req.flash('success','Already published.'); return res.redirect('back'); }

    post.status = 'PUBLISHED';
    post.publishedAt = new Date();
    await post.save();

    audit.record({
      companyId,
      actorUserId: req.user._id,
      action: 'POST_APPROVED',
      targetType: 'post',
      targetId: post._id,
    }).catch(()=>{});

    // bust caches for this tenant (and group if any)
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);
    await microcache.bustPost(req.company.slug, post._id);

    req.flash('success', 'Post approved and published.');
    return res.redirect(`/${req.params.org}/mod/queue`);
  } catch (e) { next(e); }
};

// POST /:org/posts/mod/reject   (body: postId, reason?)
exports.reject = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.body || {};
    if (!postId || !isObjId(postId)) { req.flash('error','Invalid id'); return res.redirect('back'); }

    const post = await Post.findOne({ _id: postId, companyId, deletedAt: null });
    if (!post) { req.flash('error','Not found'); return res.redirect('back'); }

    // Two common patterns: "REJECTED" status or soft-delete.
    // We’ll mark as REJECTED (keeps an audit trail without showing on feeds).
    post.status = 'REJECTED';
    await post.save();

    audit.record({
      companyId,
      actorUserId: req.user._id,
      action: 'POST_REJECTED',
      targetType: 'post',
      targetId: post._id,
      metadata: { reason: (req.body.reason || '').slice(0, 200) }
    }).catch(()=>{});

    // bust any cached lists that might include it (defensive)
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);
    await microcache.bustPost(req.company.slug, post._id);

    req.flash('success', 'Post rejected.');
    return res.redirect(`/${req.params.org}/mod/queue`);
  } catch (e) { next(e); }
};
