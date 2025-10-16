// routes/posts.js
const express = require('express');
const router = express.Router({ mergeParams: true });

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
router.get('/feed', ensureAuth, pc.companyFeed);

if (typeof pc?.groupFeed !== 'function') {
  throw new Error('postController.groupFeed is not a function (check your exports).');
}
router.get('/g/:groupId', ensureAuth, pc.groupFeed);

// ---------- Post CRUD ----------
if (typeof pc?.create !== 'function') {
  throw new Error('postController.create is not a function (check your exports).');
}
router.post('/', ensureAuth, upload.single('image'), pc.create);

if (typeof pc?.getPost !== 'function') {
  throw new Error('postController.getPost is not a function (check your exports).');
}
router.get('/:postId', ensureAuth, pc.getPost);

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

module.exports = router;
