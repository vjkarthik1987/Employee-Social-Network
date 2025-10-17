// routes/profile.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { ensureAuth, requireRole } = require('../middleware/auth');
const profile = require('../controllers/profileController');
const User = require('../models/User');



router.get('/:userId', ensureAuth, profile.show);

// Self-edit (no :userId)
router.get('/me/edit', ensureAuth, profile.editForm);
router.post('/me/edit', ensureAuth, profile.update);

// Admin edit any user
router.get('/:userId/edit', ensureAuth, requireRole('ORG_ADMIN'), profile.editForm);
router.post('/:userId/edit', ensureAuth, requireRole('ORG_ADMIN'), profile.update);

module.exports = router;
