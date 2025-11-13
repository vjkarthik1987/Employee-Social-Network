// routes/api/comments.js
const express = require('express');
const router = express.Router({ mergeParams: true });

const { ensureAuth } = require('../../middleware/auth');
const cc = require('../../controllers/commentsController');

// List top-level comments (paged)
router.get('/posts/:postId/comments', ensureAuth, cc.listTopLevel);

// List replies (paged) for a parent
router.get('/posts/:postId/comments/:parentCommentId/replies', ensureAuth, cc.listReplies);


// Create (top-level or reply) → returns rendered HTML for the new item
router.post('/posts/:postId/comments', ensureAuth, cc.createAjax);

// Delete (soft) → returns JSON { ok: true, commentId, isReply, parentCommentId }
router.delete('/comments/:commentId', ensureAuth, cc.destroyAjax);

module.exports = router;
