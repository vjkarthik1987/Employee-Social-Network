// routes/adminCentral.js
const express = require('express');
const Company = require('../models/Company');
const auditService = require('../services/auditService');

// TODO: replace with your real platform-admin check
function requirePlatformAdmin(req, res, next) {
  if (req.user && req.user.isPlatformAdmin) return next();
  return res.status(403).send('Forbidden');
}

const router = express.Router();

// List companies
router.get('/admin-central/licenses', requirePlatformAdmin, async (req, res, next) => {
  try {
    const companies = await Company.find({})
      .select('name slug planState trialEndsAt license policies.branding')
      .sort({ createdAt: -1 }).lean();
    res.render('admin-central/licenses', { companies });
  } catch (e) { next(e); }
});

// Update company license/plan
router.post('/admin-central/licenses/:companyId', requirePlatformAdmin, async (req, res, next) => {
  try {
    const company = await Company.findById(req.params.companyId);
    if (!company) return res.status(404).send('Company not found');

    const before = {
      planState: company.planState,
      trialEndsAt: company.trialEndsAt,
      license: { ...company.license }
    };

    if (req.body.planState) company.planState = req.body.planState;
    if (req.body.trialEndsAt) company.trialEndsAt = new Date(req.body.trialEndsAt);

    company.license = company.license || {};
    if (req.body.seats) company.license.seats = Number(req.body.seats);
    if (req.body.validTill) company.license.validTill = new Date(req.body.validTill);

    // Recompute used for safety (optional)
    // const used = await User.countDocuments({ companyId: company._id, status: 'active' });
    // company.license.used = used;

    await company.save();

    await auditService.record(req.user._id, 'LICENSE_CHANGED', {
      companyId: company._id,
      before,
      after: {
        planState: company.planState,
        trialEndsAt: company.trialEndsAt,
        license: company.license
      },
      note: req.body.note || ''
    });

    req.flash('success', 'License updated.');
    res.redirect('/admin-central/licenses');
  } catch (e) { next(e); }
});

module.exports = router;
