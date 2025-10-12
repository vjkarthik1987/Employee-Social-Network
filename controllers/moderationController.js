// controllers/moderationController.js
const Post = require('../models/Post');

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

    req.flash('success', 'Post rejected.');
    return res.redirect(`/${req.params.org}/mod/queue`);
  } catch (e) { next(e); }
};
