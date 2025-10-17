// routes/adminRetention.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const { purgeForCompany } = require('../services/retentionService');

const router = express.Router({ mergeParams: true });

router.post('/run', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const result = await purgeForCompany(req.companyId, { verbose: false });
    req.flash('success', `Retention run: ${JSON.stringify(result)}`);
    res.redirect(`/${req.params.org}/admin/settings`);
  } catch (e) { next(e); }
});

// JSON variant
router.post('/run.json', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const result = await purgeForCompany(req.companyId, { verbose: false });
    res.json({ ok: true, result });
  } catch (e) { next(e); }
});

module.exports = router;
