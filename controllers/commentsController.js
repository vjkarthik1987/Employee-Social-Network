// controllers/commentsController.js
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const User = require('../models/User');
const ejs = require('ejs');
const pointsService = require('../services/pointsService');



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

// POST /:org/posts/:postId/comments (AJAX)
exports.createAjax = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;
    const { content = '', parentCommentId = null } = req.body;

    const raw = (content || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'EMPTY' });

    // OPTIONAL: blocked words (if configured)
    const blocked = Array.isArray(req.company?.policies?.blockedWords) ? req.company.policies.blockedWords : [];
    if (blocked.length && blocked.some(w => raw.toLowerCase().includes(String(w).toLowerCase()))) {
      return res.status(400).json({ ok: false, error: 'BLOCKED_WORD' });
    }

    // Validate post (lean + projection keeps it light)
    const post = await Post.findOne(
      { _id: postId, companyId: cid, deletedAt: null },
      { _id: 1 } // projection
    ).lean();
    if (!post) return res.status(404).json({ ok: false });

    // Validate parent (when replying)
    let level = 0, parent = null;
    if (parentCommentId) {
      parent = await Comment.findOne(
        { _id: parentCommentId, postId, companyId: cid, status: { $ne: 'deleted' } },
        { _id: 1 } // projection
      ).lean();
      if (!parent) return res.status(400).json({ ok: false, error: 'BAD_PARENT' });
      level = 1;
    }

    // Sanitize once
    const safeHtml = clean(raw);

    // Create
    const comment = await Comment.create({
      companyId: cid,
      postId,
      authorId: req.user._id,
      parentCommentId: parent ? parent._id : null,
      level,
      content: safeHtml,
    });

    await pointsService.award({
      company: req.company,
      companyId: cid,
      userId: req.user._id,        // ✅ ADD THIS
      actorUserId: req.user._id,
      action: parent ? 'REPLY_CREATED' : 'COMMENT_CREATED',
      targetType: parent ? 'reply' : 'comment',
      targetId: comment._id,
      meta: { postId: String(postId), parentCommentId: parent ? String(parent._id) : null }
    }).catch(() => {});
    
  
    // Denorm bumps in parallel
    const bumps = [
      Post.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } })
    ];
    if (parent) bumps.push(Comment.updateOne({ _id: parent._id }, { $inc: { repliesCount: 1 } }));
    await Promise.all(bumps);

    // Build a light "hydrated" doc for the view without an extra DB read
    const doc = {
      _id: comment._id,
      postId,
      parentCommentId: parent ? parent._id : null,
      level,
      content: comment.content,
      status: 'visible',
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      repliesCount: 0,
      authorId: {
        _id: req.user._id,
        fullName: req.user.fullName,
        title: req.user.title,
        avatarUrl: req.user.avatarUrl
      }
    };

    // SSR partial
    const csrfToken = (req.csrfToken && req.csrfToken()) || '';
    const view = level === 0 ? 'partials/_comment' : 'partials/_reply';
    const locals = {
      layout: false,
      company: req.company,
      user: req.user,
      post: { _id: postId },        // minimal (the partial only needs IDs)
      comment: level === 0 ? doc : undefined,
      replies: level === 0 ? [] : undefined,
      r: level === 1 ? doc : undefined,
      csrfToken
    };
    const file = path.join(__dirname, '..', 'views', `${view}.ejs`);
    const html = await ejs.renderFile(file, locals, { async: true });

    return res.json({
      ok: true,
      html,
      isReply: level === 1,
      parentCommentId: parent ? String(parent._id) : null,
      commentsCountDelta: 1,
      postId: String(postId)
    });
  } catch (e) { next(e); }
};

// controllers/commentsController.js
exports.listTopLevel = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const skip = (page - 1) * limit;

    // validate post exists (cheap projection)
    const post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null }, { _id: 1 }).lean();
    if (!post) return res.status(404).json({ ok: false });

    // fetch page of level-0 comments
    const [items, total] = await Promise.all([
      Comment.find({ companyId: cid, postId, level: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'fullName title avatarUrl')
        .lean(),
      Comment.countDocuments({ companyId: cid, postId, level: 0 })
    ]);

    // render each item using the same partial
    const csrfToken = (req.csrfToken && req.csrfToken()) || '';
    const file = path.join(__dirname, '..', 'views', 'partials/_comment.ejs');

    const htmlItems = await Promise.all(items.map(c =>
      ejs.renderFile(file, {
        layout: false,
        company: req.company,
        user: req.user,
        post: { _id: postId },
        comment: c,
        replies: [],       // lazy-load via replies endpoint
        csrfToken
      }, { async: true })
    ));

    const hasMore = (skip + items.length) < total;

    res.json({
      ok: true,
      html: htmlItems.join(''),
      page, limit, total, hasMore
    });
  } catch (e) { next(e); }
};

exports.listReplies = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId, parentCommentId } = req.params;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);
    const skip = (page - 1) * limit;

    // validate parent exists
    const parent = await Comment.findOne(
      { _id: parentCommentId, companyId: cid, postId, level: 0 },
      { _id: 1 }
    ).lean();
    if (!parent) return res.status(404).json({ ok: false });

    const [items, total] = await Promise.all([
      Comment.find({ companyId: cid, postId, parentCommentId, level: 1 })
        .sort({ createdAt: 1 })  // oldest-first for conversation feel
        .skip(skip)
        .limit(limit)
        .populate('authorId', 'fullName title avatarUrl')
        .lean(),
      Comment.countDocuments({ companyId: cid, postId, parentCommentId, level: 1 })
    ]);

    // render reply partial (you referenced 'partials/_reply' in create path)
    const csrfToken = (req.csrfToken && req.csrfToken()) || '';
    const file = path.join(__dirname, '..', 'views', 'partials/_reply.ejs'); // create if not present

    const htmlItems = await Promise.all(items.map(r =>
      ejs.renderFile(file, {
        layout: false,
        company: req.company,
        user: req.user,
        post: { _id: postId },
        r,
        csrfToken
      }, { async: true })
    ));

    const hasMore = (skip + items.length) < total;

    res.json({
      ok: true,
      html: htmlItems.join(''),
      page, limit, total, hasMore
    });
  } catch (e) { next(e); }
};



exports.editAjax = async (req,res,next)=>{
  const {commentId}=req.params;
  const {content=''}=req.body;
  if(!content.trim()) return res.status(400).json({ok:false,error:'EMPTY'});
  const c=await Comment.findById(commentId);
  if(!c) return res.status(404).json({ok:false});
  if(String(c.authorId)!==String(req.user._id)&&!['ORG_ADMIN','MODERATOR'].includes(req.user.role))
    return res.status(403).json({ok:false});
  c.editHistory.push({content:c.content,editedAt:new Date()});
  c.content=clean(content);
  c.editedAt=new Date();
  await c.save();
  res.json({ok:true,html:await renderUpdatedCommentHTML(c,req)});
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

    // ✅ keep schema happy (content is required)
    c.status = 'deleted';
    c.content = '(deleted)';          // <-- was '' (violated "required")
    await c.save();                   // validation now passes

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
      commentsCountDelta: wasVisible ? -1 : 0,
      postId: String(c.postId),
    });
  } catch (e) { next(e); }
};