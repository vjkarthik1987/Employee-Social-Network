// routes/api/reports.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const { ensureAuth, requireRole } = require('../../middleware/auth');
const reports = require('../../controllers/reportsController');

// POST /:org/api/reports  → create report (member)
router.post('/reports', ensureAuth, reports.createApi);

// GET /:org/api/reports   → list (mod/admin)
router.get('/reports', ensureAuth, requireRole('MODERATOR','ORG_ADMIN'), reports.listApi);

// PATCH /:org/api/reports/:id → update status (mod/admin)
router.patch('/reports/:id', ensureAuth, requireRole('MODERATOR','ORG_ADMIN'), reports.updateApi);

module.exports = router;
