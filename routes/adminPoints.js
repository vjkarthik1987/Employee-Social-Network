const express = require('express');
const router = express.Router({ mergeParams: true });

const { ensureAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminPointsController');

router.get('/', ensureAuth, requireRole('ORG_ADMIN'), ctrl.dashboard);
router.get('/points', ensureAuth, requireRole('ORG_ADMIN'), ctrl.pointsPage);
router.get('/export', ensureAuth, requireRole('ORG_ADMIN'), ctrl.exportCsv);

module.exports = router;
