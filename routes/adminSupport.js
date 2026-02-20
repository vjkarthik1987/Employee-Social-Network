// routes/adminSupport.js
const express = require('express');
const router = express.Router({ mergeParams: true });

const { ensureAuth, requireRole } = require('../middleware/auth');
const UpgradeRequest = require('../models/UpgradeRequest');
const { sendMail } = require('../services/mailer');

function isoDate(d) {
  try { return new Date(d).toISOString().slice(0,10); } catch { return ''; }
}

router.get('/upgrade', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const recent = await UpgradeRequest.find({ companyId: req.companyId })
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    res.render('admin/support/upgrade', {
      company: req.company,
      user: req.user,
      recent,
      today: isoDate(new Date()),
    });
  } catch (e) { next(e); }
});

router.post('/upgrade', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const company = req.company;

    const upgradeType = String(req.body.upgradeType || '').toUpperCase();
    const allowed = new Set(['SEATS','VALIDITY','BOTH','MOVE_TO_PAID']);
    if (!allowed.has(upgradeType)) {
      req.flash('error', 'Select a valid upgrade type.');
      return res.redirect(`/${req.params.org}/admin/support/upgrade`);
    }

    const currentSeats = Number(company.license?.seats ?? 0);
    const currentUsed  = Number(company.license?.used ?? 0);

    const seatsRequested = (req.body.seatsRequested !== undefined && req.body.seatsRequested !== '')
      ? Number(req.body.seatsRequested)
      : null;

    const validTillRequested = req.body.validTillRequested
      ? new Date(String(req.body.validTillRequested) + 'T23:59:59.999Z')
      : null;

    const expectedCost = (req.body.expectedCost !== undefined && req.body.expectedCost !== '')
      ? Number(req.body.expectedCost)
      : null;

    const currency = (req.body.currency || 'INR').trim().toUpperCase();
    const urgency  = (req.body.urgency || 'NORMAL').trim().toUpperCase() === 'URGENT' ? 'URGENT' : 'NORMAL';
    const needBy   = req.body.needBy ? new Date(String(req.body.needBy) + 'T23:59:59.999Z') : null;

    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10) {
      req.flash('error', 'Please add a short justification (min 10 characters).');
      return res.redirect(`/${req.params.org}/admin/support/upgrade`);
    }

    if ((upgradeType === 'SEATS' || upgradeType === 'BOTH') && (!seatsRequested || seatsRequested < currentSeats)) {
      req.flash('error', `Seats requested must be at least current seats (${currentSeats}).`);
      return res.redirect(`/${req.params.org}/admin/support/upgrade`);
    }

    if ((upgradeType === 'VALIDITY' || upgradeType === 'BOTH') && (!validTillRequested || Number.isNaN(validTillRequested.getTime()))) {
      req.flash('error', 'Please provide a valid “valid till” date.');
      return res.redirect(`/${req.params.org}/admin/support/upgrade`);
    }

    const doc = await UpgradeRequest.create({
      companyId: company._id,
      requestedByUserId: req.user._id,
      requestedByName: req.user.fullName || 'Org Admin',
      requestedByEmail: req.user.email || '',

      currentPlanState: company.planState || null,
      currentSeats,
      currentUsedSeats: currentUsed,
      currentValidTill: company.license?.validTill || null,
      currentTrialEndsAt: company.trialEndsAt || null,

      upgradeType,
      seatsRequested: (upgradeType === 'SEATS' || upgradeType === 'BOTH') ? seatsRequested : null,
      validTillRequested: (upgradeType === 'VALIDITY' || upgradeType === 'BOTH') ? validTillRequested : null,

      expectedCost,
      currency,
      urgency,
      needBy: (needBy && !Number.isNaN(needBy.getTime())) ? needBy : null,

      reason,
      status: 'SUBMITTED',
      source: 'SETTINGS_PAGE',
    });

    // Email notify (configurable)
    const to = process.env.UPGRADE_REQUEST_TO || process.env.SUPPORT_EMAIL || '';
    if (to) {
      const subject = `[Upgrade Request] ${company.name} (${company.slug}) — ${upgradeType}`;
      const text = [
        `Upgrade Request ID: ${doc._id}`,
        ``,
        `Company: ${company.name} (${company.slug})`,
        `Plan state: ${company.planState || '-'}`,
        `Current seats: ${currentSeats}`,
        `Used seats: ${currentUsed}`,
        `Valid till: ${company.license?.validTill ? new Date(company.license.validTill).toISOString() : '-'}`,
        `Trial ends: ${company.trialEndsAt ? new Date(company.trialEndsAt).toISOString() : '-'}`,
        ``,
        `Requested type: ${upgradeType}`,
        `Seats requested: ${doc.seatsRequested ?? '-'}`,
        `Valid till requested: ${doc.validTillRequested ? doc.validTillRequested.toISOString() : '-'}`,
        `Expected cost: ${doc.expectedCost ?? '-'} ${doc.currency || ''}`,
        `Urgency: ${doc.urgency}`,
        `Need by: ${doc.needBy ? doc.needBy.toISOString() : '-'}`,
        ``,
        `Reason:`,
        doc.reason,
        ``,
        `Requested by: ${doc.requestedByName} <${doc.requestedByEmail}>`,
        `Submitted at: ${doc.createdAt.toISOString()}`,
      ].join('\n');

      // lightweight HTML
      const html = `<div style="font-family:system-ui,Segoe UI,Arial;color:#111">
        <h2>Upgrade Request</h2>
        <p><b>${company.name}</b> (${company.slug})</p>
        <p><b>Request ID:</b> ${doc._id}</p>
        <hr/>
        <p><b>Type:</b> ${upgradeType}</p>
        <p><b>Seats:</b> ${doc.seatsRequested ?? '-'} | <b>Valid till:</b> ${doc.validTillRequested ? doc.validTillRequested.toDateString() : '-'}</p>
        <p><b>Cost:</b> ${doc.expectedCost ?? '-'} ${doc.currency || ''}</p>
        <p><b>Urgency:</b> ${doc.urgency} | <b>Need by:</b> ${doc.needBy ? doc.needBy.toDateString() : '-'}</p>
        <p><b>Reason:</b><br/>${String(doc.reason).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
        <hr/>
        <p><b>Requested by:</b> ${doc.requestedByName} &lt;${doc.requestedByEmail}&gt;</p>
      </div>`;

      try {
        await sendMail({ to, subject, html, text });
      } catch (e) {
        console.warn('[upgrade-request] email failed:', e.message);
      }
    }

    req.flash('success', 'Upgrade request submitted. Our team will contact you soon.');
    return res.redirect(`/${req.params.org}/admin/support/upgrade`);
  } catch (e) { next(e); }
});

module.exports = router;