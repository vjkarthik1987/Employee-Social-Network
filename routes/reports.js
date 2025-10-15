// routes/reports.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const reports = require('../controllers/reportsController');

const router = express.Router({ mergeParams: true });

// Member: create a report (post/comment)
// POST /:org/report
router.post('/report', ensureAuth, reports.create);

// Moderator/Admin: list open reports
// GET /:org/mod/reports
router.get('/mod/reports', ensureAuth, requireRole('MODERATOR','ORG_ADMIN'), reports.list);

// Moderator/Admin: resolve
// POST /:org/mod/reports/:id/resolve
router.post('/mod/reports/:id/resolve', ensureAuth, requireRole('MODERATOR','ORG_ADMIN'), reports.resolve);

module.exports = router;
