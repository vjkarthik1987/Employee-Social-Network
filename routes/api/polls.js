// /routes/api/polls.js
const express = require('express');
const { ensureAuth, requireRole } = require('../../middleware/auth');
const polls = require('../../controllers/pollsController');

const router = express.Router({ mergeParams: true });

router.post('/polls/:postId/submit', ensureAuth, polls.submit);
router.post('/polls/:postId/close', ensureAuth, requireRole('MODERATOR','ORG_ADMIN'), polls.close);

module.exports = router;
