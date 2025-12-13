// routes/adminUsers.js
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const bcrypt = require('bcrypt'); 
const { ensureAuth, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Company = require('../models/Company');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }});
const router = express.Router({ mergeParams: true });

const profile = require('../controllers/profileController');

async function checkLicenseGuard(req) {
  const company = req.company || await Company.findById(req.companyId).lean();
  const now = new Date();
  const expired = (company.planState === 'EXPIRED') ||
                  (company.license?.validTill && new Date(company.license.validTill) < now) ||
                  (company.trialEndsAt && new Date(company.trialEndsAt) < now);

  if (expired) {
    return { ok: false, reason: 'expired' };
  }
  const used = company.license?.used || 0;
  const seats = company.license?.seats ?? 25;
  if (used >= seats) {
    return { ok: false, reason: 'limit' };
  }
  return { ok: true };
}

// List users
router.get('/', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const users = await User.find({ companyId: req.companyId })
      .sort({ createdAt: -1 })
      .lean();

    res.render('admin/users/index', {
      company: req.company,
      users,
      user: req.user,
      currentUser: req.user,
    });
  } catch (e) { next(e); }
});


// Import via CSV (bulk add)
router.post('/import', ensureAuth, requireRole('ORG_ADMIN'), upload.single('csv'), async (req, res, next) => {
  try {
    if (!req.file) {
      req.flash('error', 'Please upload a CSV file.');
      return res.redirect(`/${req.params.org}/admin/users`);
    }

    const rows = parse(req.file.buffer.toString('utf8'), {
      columns: true, skip_empty_lines: true, trim: true, bom: true,
    });

    const allowedRoles = new Set(['MEMBER', 'MODERATOR', 'ORG_ADMIN']);
    const results = { created: 0, skipped: 0, errors: 0 };

    for (const row of rows) {
      const fullName = row.fullName?.trim();
      const email = row.email?.toLowerCase().trim();
      const role = (row.role || 'MEMBER').toUpperCase();
      const rawDob   = (row.dateOfBirth || '').trim();
      const rawAnniv = (row.anniversaryDate || '').trim();
      const rawJoin  = (row.dateOfJoining || '').trim();

      if (!fullName || !email || !allowedRoles.has(role)) { results.skipped++; continue; }

      function parseDateSafe(s) {
        if (!s) return undefined;
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return undefined;
        return d;
      }
  
      const dateOfBirth    = parseDateSafe(rawDob);
      const anniversaryDate = parseDateSafe(rawAnniv);
      const dateOfJoining  = parseDateSafe(rawJoin);

      // Guard: seat limit & expiry
      const company = req.company;
      const now = new Date();
      const expired = company.planState === 'EXPIRED' || (company.license?.validTill && company.license.validTill < now);

      if (expired) {
        await auditService.record(req.user._id, 'INVITE_BLOCKED', {
          companyId: req.companyId,
          reason: guard.reason || (expired ? 'expired' : 'limit')
        });
        return res.status(402).render('billing/expired', { company, message: 'Your trial has ended. Request an extension to add users.' });
      }

      if (company.license && company.license.used >= company.license.seats) {
        await auditService.record(req.user._id, 'INVITE_BLOCKED', {
          companyId: req.companyId,
          reason: guard.reason || (expired ? 'expired' : 'limit')
        });
        return res.status(402).render('billing/limit', { company, message: 'Seat limit reached. Request an upgrade to add users.' });
      }

      const guard = await checkLicenseGuard(req);
      if (!guard.ok) {
        results.skipped++;
        if (guard.reason === 'expired') {
          await auditService.record(req.user._id, 'INVITE_BLOCKED', {
            companyId: req.companyId,
            reason: guard.reason || (expired ? 'expired' : 'limit')
          });
        }
        continue;
      }

      try {
        // Create invited user with temp password (or send invite token later)
        // For MVP, set a default password; you can force reset later.
        const existing = await User.findOne({ companyId: req.companyId, email });
        if (existing) { results.skipped++; continue; }

        //const temp = Math.random().toString(36).slice(2, 10);
        const temp ='password';
        const passwordHash = await bcrypt.hash(temp, 12);
        const u = new User({
          companyId: req.companyId,
          fullName,
          email,
          role,
          status: 'active',
          passwordHash,               // <-- set explicitly (matches your /routes/auth.js pattern)
          dateOfBirth,
          anniversaryDate,
          dateOfJoining,
        });
        await u.save();
        await User.countDocuments({ companyId: req.companyId, status: 'active' })
        .then(async count => {
          await Company.updateOne({ _id: req.companyId }, { $set: { 'license.used': count } });
        });

        results.created++;
        console.log(`Created user ${email} with temp password ${temp}`);
      } catch (_e) {
        results.errors++;
      }
    }

    req.flash('success', `Import complete. Created: ${results.created}, Skipped: ${results.skipped}, Errors: ${results.errors}`);
    res.redirect(`/${req.params.org}/admin/users`);
  } catch (e) { next(e); }
});

// Add single user
router.post('/create', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const fullName = (req.body.fullName || '').trim();
    const email = (req.body.email || '').toLowerCase().trim();
    const role = (req.body.role || 'MEMBER').toUpperCase();
    const status = (req.body.status || 'active').toLowerCase();

    const allowedRoles = new Set(['MEMBER', 'MODERATOR', 'ORG_ADMIN']);
    const allowedStatus = new Set(['active', 'invited', 'suspended']);

    if (!fullName || !email || !allowedRoles.has(role) || !allowedStatus.has(status)) {
      req.flash('error', 'Please enter valid name/email/role/status.');
      return res.redirect(`/${req.params.org}/admin/users`);
    }

    // License guard
    const guard = await checkLicenseGuard(req);
    if (!guard.ok) {
      const company = req.company;
      return res.status(402).render(
        guard.reason === 'expired' ? 'billing/expired' : 'billing/limit',
        { company, message: guard.reason === 'expired' ? 'Your trial has ended.' : 'Seat limit reached.' }
      );
    }

    const existing = await User.findOne({ companyId: req.companyId, email });
    if (existing) {
      req.flash('error', 'A user with this email already exists.');
      return res.redirect(`/${req.params.org}/admin/users`);
    }

    const temp = 'password'; // same as CSV import for now
    const passwordHash = await bcrypt.hash(temp, 12);

    const u = new User({
      companyId: req.companyId,
      fullName,
      email,
      role,
      status,
      passwordHash,
    });

    await u.save();

    // keep seats accurate (same as your import logic)
    const count = await User.countDocuments({ companyId: req.companyId, status: 'active' });
    await Company.updateOne({ _id: req.companyId }, { $set: { 'license.used': count } });

    req.flash('success', `User added: ${email}`);
    return res.redirect(`/${req.params.org}/admin/users`);
  } catch (e) { next(e); }
});


// Delete user
router.post('/:userId/delete', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    // Prevent self-delete and ensure same tenant
    if (String(req.user._id) === String(req.params.userId)) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect(`/${req.params.org}/admin/users`);
    }
    await User.deleteOne({ _id: req.params.userId, companyId: req.companyId });
    req.flash('success', 'User deleted.');
    await auditService.record(req.user._id, 'USER_DELETED', {
      companyId: req.companyId,
      targetUserId: req.params.userId
    });
    res.redirect(`/${req.params.org}/admin/users`);
  } catch (e) { next(e); }
});

//Edit user
router.get('/:userId/edit', ensureAuth, requireRole('ORG_ADMIN'), profile.editForm);
router.post('/:userId/edit', ensureAuth, requireRole('ORG_ADMIN'), profile.update);

module.exports = router;
