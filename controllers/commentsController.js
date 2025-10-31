// controllers/commentsController.js
const path = require('path');
const sanitizeHtml = require('sanitize-html');
const Comment = require('../models/Comment');
const Post = require('../models/Post');
const User = require('../models/User');
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

// POST /:org/posts/:postId/comments (AJAX)
exports.createAjax = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { postId } = req.params;
    const { content = '', parentCommentId = null } = req.body;

    if (!content.trim()) {
      return res.status(400).json({ ok: false, error: 'EMPTY' });
    }

    // Validate post
    const post = await Post.findOne({ _id: postId, companyId: cid, deletedAt: null });
    if (!post) return res.status(404).json({ ok: false });

    // Parent/level
    let level = 0, parent = null;
    if (parentCommentId) {
      parent = await Comment.findOne({
        _id: parentCommentId,
        postId,
        companyId: cid,
        status: { $ne: 'deleted' }
      });
      if (!parent) return res.status(400).json({ ok: false, error: 'BAD_PARENT' });
      level = 1;
    }

    // Create comment
    const comment = await Comment.create({
      companyId: cid,
      postId,
      authorId: req.user._id,
      parentCommentId: parentCommentId || null,
      level,
      content: clean(content),
    });

    // Denorm counters
    await Post.updateOne({ _id: postId }, { $inc: { commentsCount: 1 } });
    if (parent) await Comment.updateOne({ _id: parent._id }, { $inc: { repliesCount: 1 } });

    // Hydrate for view
    const doc = await Comment.findById(comment._id)
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    // Render SSR HTML partial
    const view = level === 0 ? 'partials/_comment' : 'partials/_reply';
    const locals = {
      layout: false,
      company: req.company,
      user: req.user,
      post,
      comment: level === 0 ? doc : undefined,
      replies: level === 0 ? [] : undefined,
      r: level === 1 ? doc : undefined,
      csrfToken: req.csrfToken && req.csrfToken(),
    };
    const file = path.join(__dirname, '..', 'views', `${view}.ejs`);
    const html = await ejs.renderFile(file, locals, { async: true });

    // --- send @mention emails (non-blocking UX; scoped to this handler) ---
    try {
      const company = req.company;
      if (company?.policies?.notificationsEnabled) {
        const { handles, emails } = extractMentionsFromHtml(comment.content);

        if (handles.length || emails.length) {
          const usersByHandle = handles.length
            ? await User.find({ companyId: cid, handle: { $in: handles } }).lean()
            : [];
          const usersByEmail = emails.length
            ? await User.find({ companyId: cid, email: { $in: emails } }).lean()
            : [];

          const targets = [...usersByHandle, ...usersByEmail]
            .filter(u => String(u._id) !== String(req.user._id))   // avoid emailing self
            .filter(u => !!u.email);

          if (targets.length) {
            const snippet = makeSnippet(comment.content);
            const link = `${process.env.APP_BASE_URL}/${company.slug}/p/${post._id}#c-${comment._id}`;
            const mailHtml = renderMentionEmail({ company, actor: req.user, snippet, link });

            await Promise.allSettled(
              targets.map(u => sendMail({
                to: u.email,
                subject: `You were mentioned on ${company.name}`,
                html: mailHtml
              }))
            );
          }
        }
      }
    } catch (mailErr) {
      if (req.logger) req.logger.warn('[comment mention mail] failed', mailErr);
      // swallow mail errors so UI flow is not blocked
    }

    // Respond to client
    return res.json({
      ok: true,
      html,
      isReply: level === 1,
      parentCommentId: parent ? String(parent._id) : null,
      commentsCountDelta: 1,
      postId: String(postId)
    });
  } catch (e) {
    next(e);
  }
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