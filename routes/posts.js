// routes/posts.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const csrf = require('csurf');
const csrfProtection = csrf();
const User = require('../models/User');

/** Auth middleware */
const auth = require('../middleware/auth');
// Expect { ensureAuth } export
const ensureAuth = auth?.ensureAuth || ((req, _res, next) => next());

/** Controllers */
const pc = require('../controllers/postController');
let cc = null;
try {
  cc = require('../controllers/commentsController');
} catch (_e) {
  cc = null;
}

/** Upload (multer) */
const upload = require('../services/storage');

// ---------- Feeds ----------
if (typeof pc?.companyFeed !== 'function') {
  throw new Error('postController.companyFeed is not a function (check your exports).');
}

router.get('/mentions', ensureAuth, async (req, res, next) => {
  try {
    const companyId = req.company?._id || req.companyId;
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ ok: true, users: [] });

    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx  = new RegExp('^' + esc(q), 'i');

    const users = await User.find({
      companyId,
      $or: [{ handle: rx }, { fullName: rx }, { email: rx }]
    })
    .select('_id fullName handle email avatarUrl title')
    .limit(8)
    .lean();

    res.json({
      ok: true,
      users: users.map(u => ({
        id: String(u._id),
        fullName: u.fullName,
        handle: u.handle || null,
        email: u.email,
        avatarUrl: u.avatarUrl || null,
        subtitle: u.title || ''
      }))
    });
  } catch (e) { next(e); }
});

router.get('/feed', ensureAuth, csrfProtection, pc.companyFeed);


if (typeof pc?.groupFeed !== 'function') {
  throw new Error('postController.groupFeed is not a function (check your exports).');
}
router.get('/g/:groupId', ensureAuth, csrfProtection, pc.groupFeed);

// ---------- Post CRUD ----------
if (typeof pc?.create !== 'function') {
  throw new Error('postController.create is not a function (check your exports).');
}
router.post('/',
  ensureAuth,               // your auth guard
  upload.array('images', 10),   // multer if used
  csrfProtection,           // if you run CSRF per-route
  pc.create
);

if (typeof pc?.getPost !== 'function') {
  throw new Error('postController.getPost is not a function (check your exports).');
}

// Edit draft (or any post you own)
router.get('/:postId/edit', ensureAuth, csrfProtection, pc.editPost);



if (typeof pc?.destroy !== 'function') {
  throw new Error('postController.destroy is not a function (check your exports).');
}
router.post('/:postId/delete', ensureAuth, pc.destroy);

// ---------- Comments (only if controller present) ----------
if (cc && typeof cc?.create === 'function') {
  router.post('/:postId/comments', ensureAuth, cc.create);
}
if (cc && typeof cc?.destroy === 'function') {
  router.post('/:postId/comments/:commentId/delete', ensureAuth, cc.destroy);
}

// Update (save draft / publish)
router.post('/:postId', ensureAuth, upload.array('images', 10), csrfProtection, pc.update);

router.get('/:postId', ensureAuth, pc.getPost);

module.exports = router;
