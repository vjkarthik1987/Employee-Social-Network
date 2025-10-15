// controllers/moderationController.js
const Post = require('../models/Post');
const audit = require('../services/auditService');


function companyIdOf(req){ return req.companyId || req.company?._id; }

exports.queue = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const posts = await Post.find({ companyId: cid, status: 'QUEUED', deletedAt: null })
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName')
      .lean();

    return res.render('mod/queue', { company: req.company, user: req.user, posts });
  } catch (e) { next(e); }
};

exports.approve = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.body;

    const post = await Post.findOne({ _id: postId, companyId: cid, status: 'QUEUED' });
    if (!post) { req.flash('error', 'Not found or not in queue'); return res.redirect(`/${req.params.org}/mod/queue`); }

    post.status = 'PUBLISHED';
    post.approvalStatus = 'approved';
    post.reviewerUserId = req.user._id;
    post.reviewedAt = new Date();
    post.publishedAt = new Date();
    await post.save();

    try {
      await audit.record({
        companyId: cid,
        actorUserId: req.user._id,
        action: 'POST_APPROVED',
        targetType: 'post',
        targetId: post._id,
        metadata: { fromStatus: 'QUEUED', toStatus: 'PUBLISHED' },
      });
    } catch (_e) {}

    req.flash('success', 'Post approved & published.');
    return res.redirect(`/${req.params.org}/mod/queue`);
  } catch (e) { next(e); }
};

exports.reject = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.body;

    const post = await Post.findOne({ _id: postId, companyId: cid, status: { $in: ['QUEUED','APPROVED'] } });
    if (!post) { req.flash('error', 'Not found or not eligible'); return res.redirect(`/${req.params.org}/mod/queue`); }

    post.status = 'REJECTED';
    post.approvalStatus = 'rejected';
    post.reviewerUserId = req.user._id;
    post.reviewedAt = new Date();
    await post.save();

    try {
      await audit.record({
        companyId: cid,
        actorUserId: req.user._id,
        action: 'POST_REJECTED',
        targetType: 'post',
        targetId: post._id,
        metadata: { fromStatus: 'QUEUED', toStatus: 'REJECTED' }, // add reason later if UI includes it
      });
    } catch (_e) {}

    req.flash('success', 'Post rejected.');
    return res.redirect(`/${req.params.org}/mod/queue`);
  } catch (e) { next(e); }
};
