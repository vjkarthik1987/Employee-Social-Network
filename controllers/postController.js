// controllers/postController.js

const Post = require('../models/Post');
const Group = require('../models/Group');
const Company = require('../models/Company');
const Comment = require('../models/Comment');

// Helper to get companyId from request (tenant guard sets req.company or req.companyId)
function companyIdOf(req) {
  return req.companyId || (req.company && req.company._id);
}

// ---------------------------------------------
// Feed: company-level
// ---------------------------------------------
exports.companyFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const posts = await Post.find({ companyId: cid, deletedAt: null })
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    res.render('feed/index', {
      company: req.company,
      user: req.user,
      posts,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// Feed: group-level
// ---------------------------------------------
exports.groupFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { groupId } = req.params;

    const group = await Group.findOne({ _id: groupId, companyId: cid }).lean();
    if (!group) return res.status(404).render('errors/404');

    const posts = await Post.find({
      companyId: cid,
      groupId,
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    res.render('feed/index', {
      company: req.company,
      user: req.user,
      group,
      posts,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// Create post
// ---------------------------------------------
exports.create = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { type = 'TEXT', content, linkUrl, groupId = null } = req.body;

    const post = await Post.create({
      companyId: cid,
      authorId: req.user._id,
      groupId,
      type,
      richText: content,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    });

    req.flash('success', 'Post created.');
    return res.redirect(`/${req.company.slug}/feed`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// Delete (soft) post
// ---------------------------------------------
exports.destroy = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;

    const post = await Post.findOne({ _id: postId, companyId: cid });
    if (!post) return res.status(404).render('errors/404');

    const isOwner = String(post.authorId) === String(req.user._id);
    const isPriv = ['ORG_ADMIN', 'MODERATOR'].includes(req.user.role);
    if (!isOwner && !isPriv) return res.status(403).render('errors/403');

    post.deletedAt = new Date();
    post.deletedBy = req.user._id;
    await post.save();

    req.flash('success', 'Post deleted.');
    res.redirect(`/${req.company.slug}/feed`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// Show single post (with comments + replies)
// ---------------------------------------------
exports.getPost = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const post = await Post.findOne({
      _id: req.params.postId,
      companyId: cid,
      deletedAt: null,
    })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    if (!post) return res.status(404).render('errors/404');

    // --- Fetch top-level comments
    const topComments = await Comment.find({
      companyId: cid,
      postId: post._id,
      level: 0,
      status: 'visible',
    })
      .sort({ createdAt: 1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    // --- Fetch replies (level=1)
    const replies = await Comment.find({
      companyId: cid,
      postId: post._id,
      level: 1,
      status: 'visible',
    })
      .sort({ createdAt: 1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    // --- Group replies by parentCommentId
    const repliesByParent = {};
    for (const r of replies) {
      const pid = String(r.parentCommentId);
      if (!repliesByParent[pid]) repliesByParent[pid] = [];
      repliesByParent[pid].push(r);
    }

    res.render('posts/show', {
      company: req.company,
      user: req.user,
      post,
      topComments,
      repliesByParent,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------
// Moderation queue / approval endpoints (as-is)
// ---------------------------------------------
exports.queue = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const queued = await Post.find({
      companyId: cid,
      status: 'QUEUED',
    })
      .populate('authorId', 'fullName')
      .lean();

    res.render('moderation/queue', { company: req.company, queued });
  } catch (err) {
    next(err);
  }
};

exports.approve = async (req, res, next) => {
  try {
    const { postId } = req.body;
    await Post.updateOne({ _id: postId }, { $set: { status: 'PUBLISHED' } });
    req.flash('success', 'Post approved.');
    res.redirect('back');
  } catch (err) {
    next(err);
  }
};

exports.reject = async (req, res, next) => {
  try {
    const { postId } = req.body;
    await Post.updateOne({ _id: postId }, { $set: { status: 'REJECTED' } });
    req.flash('info', 'Post rejected.');
    res.redirect('back');
  } catch (err) {
    next(err);
  }
};
