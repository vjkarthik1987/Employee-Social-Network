// controllers/commentsController.js
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const ejs = require('ejs');

function renderPartialToString(viewRelativePath, locals) {
  const file = path.join(__dirname, '..', 'views', viewRelativePath);
  return ejs.renderFile(file, locals, { async: true }); // returns Promise<string>
}

function clean(input) {
  return sanitizeHtml(input || '', {
    allowedTags: ['b','i','em','strong','a','ul','ol','li','p','br'],
    allowedAttributes: { a: ['href','target','rel'] },
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  }).trim();
}
function orgSlug(req){ return req.params.org || req.company?.slug || ''; }
function companyIdOf(req){ return req.companyId || req.company?._id; }

exports.create = async (req, res, next) => {
  try {
    // internally call createAjax but adapt response for normal form post
    req.headers.accept = 'application/json';
    await exports.createAjax(req, {
      status: (code) => ({ json: (obj) => obj }), // dummy chain
      json: (data) => {
        if (data.ok) return res.redirect(`/${req.params.org}/posts/${req.params.postId}`);
        return res.status(400).render('errors/400');
      },
    }, next);
  } catch (e) { next(e); }
};

exports.destroy = async (req, res, next) => {
  try {
    req.headers.accept = 'application/json';
    await exports.destroyAjax(req, {
      status: (code) => ({ json: (obj) => obj }),
      json: (data) => {
        if (data.ok) return res.redirect(`/${req.params.org}/posts/${data.parentCommentId || req.params.postId}`);
        return res.status(400).render('errors/400');
      },
    }, next);
  } catch (e) { next(e); }
};

exports.createAjax = async (req, res, next) => {
  try {

    const cid = companyIdOf(req);
    const { postId } = req.params;
    const { content = '', parentCommentId = null } = req.body;

    if (!content.trim()) {
      return res.status(400).json({ ok: false, error: 'EMPTY' });
    }

    const post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null });
    if (!post) return res.status(404).json({ ok: false });

    let level = 0, parent = null;
    if (parentCommentId) {
      parent = await Comment.findOne({ _id: parentCommentId, postId, companyId: cid, status: { $ne: 'deleted' } });
      if (!parent) return res.status(400).json({ ok: false, error: 'BAD_PARENT' });
      level = 1;
    }

    const comment = await Comment.create({
      companyId: cid,
      postId,
      authorId: req.user._id,
      parentCommentId: parentCommentId || null,
      level,
      content: clean(content),
    });

    // denorm counters
    await Post.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
    if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { repliesCount: 1 } });

    // hydrate for view
    const doc = await Comment.findById(comment._id)
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    // Render server-side HTML snippet for the new item
    const view = level === 0 ? 'partials/_comment' : 'partials/_reply'; // we'll create _reply.ejs below
    const locals = {
      layout: false,                       // ensure partial-only render
      company: req.company,
      user: req.user,
      post,
      // For _comment.ejs we need replies array; for new top-level it's empty.
      comment: level === 0 ? doc : undefined,
      replies: level === 0 ? [] : undefined,
      // For _reply.ejs we only need 'r'
      r: level === 1 ? doc : undefined,
    };

    const file = path.join(__dirname, '..', 'views', `${view}.ejs`);
    const html = await ejs.renderFile(file, locals, { async: true });

    return res.json({
      ok: true,
      html,
      isReply: level === 1,
      parentCommentId: parent ? String(parent._id) : null,
      commentsCountDelta: 1
    });
  } catch (e) { next(e); }
};

exports.destroyAjax = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { commentId } = req.params;

    const c = await Comment.findOne({ _id: commentId, companyId: cid });
    if (!c) return res.status(404).json({ ok: false });

    const isOwner = String(c.authorId) === String(req.user._id);
    const isPriv = ['ORG_ADMIN', 'MODERATOR'].includes(req.user.role);
    if (!isOwner && !isPriv) return res.status(403).json({ ok: false });

    const wasVisible = c.status === 'visible';
    c.status = 'deleted';
    c.content = '';
    await c.save();

    if (wasVisible) {
      await Post.updateOne({ _id: c.postId }, { $inc: { commentsCount: -1 } });
      if (c.parentCommentId) {
        await Comment.updateOne({ _id: c.parentCommentId }, { $inc: { repliesCount: -1 } });
      }
    }

    return res.json({
      ok: true,
      commentId: String(c._id),
      isReply: !!c.parentCommentId,
      parentCommentId: c.parentCommentId ? String(c.parentCommentId) : null,
      commentsCountDelta: wasVisible ? -1 : 0
    });
  } catch (e) { next(e); }
};