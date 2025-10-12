// controllers/postController.js

const Post = require('../models/Post');
const Group = require('../models/Group');
const Comment = require('../models/Comment');
const Attachment = require('../models/Attachment');

// ---- Helpers ----
function companyIdOf(req) {
  return req.companyId || (req.company && req.company._id);
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

// ---- Controllers ----

// Company feed
exports.companyFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const posts = await Post.find({ companyId: cid, deletedAt: null, status: 'PUBLISHED' })
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    await attachFirstImages(posts, cid);
    await attachGroupStubs(posts, cid);

    return res.render('feed/index', {
      company: req.company,
      user: req.user,
      posts,
    });
  } catch (err) {
    next(err);
  }
};

// Group feed
exports.groupFeed = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { groupId } = req.params;

    const group = await Group.findOne({ _id: groupId, companyId: cid }).lean();
    if (!group) return res.status(404).render('errors/404');

    const posts = await Post.find({ companyId: cid, groupId, deletedAt: null, status: 'PUBLISHED' })
      .sort({ createdAt: -1 })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    await attachFirstImages(posts, cid);
    await attachGroupStubs(posts, cid);

    return res.render('feed/index', {
      company: req.company,
      user: req.user,
      group,
      posts,
    });
  } catch (err) {
    next(err);
  }
};

// Post detail
exports.getPost = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;

    const post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null })
      .populate('authorId', 'fullName title avatarUrl')
      .lean();
    if (!post) return res.status(404).render('errors/404');

    // First image
    const firstAttach = await Attachment.findOne({
      companyId: cid,
      targetType: 'post',
      targetId: post._id,
    })
      .select('storageUrl')
      .lean();
    post.firstAttachmentUrl = firstAttach?.storageUrl;

    // Group stub (for header breadcrumb)
    if (post.groupId) {
      post.group = await Group.findOne({ _id: post.groupId, companyId: cid })
        .select('_id name')
        .lean();
    }

    // Load comments (level 0 + children, adjust to your structure)
    const comments = await Comment.find({ postId: post._id, status: { $ne: 'deleted' } })
      .sort({ createdAt: 1 })
      .populate('authorId', 'fullName avatarUrl title')
      .lean();

    return res.render('posts/show', {
      company: req.company,
      user: req.user,
      post,
      comments,
    });
  } catch (err) {
    next(err);
  }
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
