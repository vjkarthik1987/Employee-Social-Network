// routes/posts.js
const express = require('express');
const router = express.Router({ mergeParams: true }); // keep :org available

const { ensureAuth, requireRole } = require('../middleware/auth');
const pc = require('../controllers/postController');
const cc = require('../controllers/commentsController');

// ---------- Feeds ----------
router.get('/feed', ensureAuth, pc.companyFeed);
router.get('/g/:groupId', ensureAuth, pc.groupFeed);

// ---------- Post CRUD ----------
router.post('/', ensureAuth, pc.create);
router.get('/:postId', ensureAuth, pc.getPost);
router.post('/:postId/delete', ensureAuth, pc.destroy);

// ---------- Comments (level-1 threaded) ----------
// Create top-level comment or reply (send optional parentCommentId in body)
router.post('/:postId/comments', ensureAuth, cc.create);

// Soft-delete a specific comment on a post
router.post('/:postId/comments/:commentId/delete', ensureAuth, cc.destroy);

// ---------- Moderation ----------
router.get(
  '/mod/queue',
  ensureAuth,
  requireRole('MODERATOR', 'ORG_ADMIN'),
  pc.queue
);

router.post(
  '/mod/approve',
  ensureAuth,
  requireRole('MODERATOR', 'ORG_ADMIN'),
  pc.approve
);

router.post(
  '/mod/reject',
  ensureAuth,
  requireRole('MODERATOR', 'ORG_ADMIN'),
  pc.reject
);

module.exports = router;
