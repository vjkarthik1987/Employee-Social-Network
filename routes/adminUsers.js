// routes/adminUsers.js
const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const bcrypt = require('bcrypt'); 
const { ensureAuth, requireRole } = require('../middleware/auth');
const User = require('../models/User');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 }});
const router = express.Router({ mergeParams: true });

const profile = require('../controllers/profileController');

// List users
router.get('/', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const users = await User.find({ companyId: req.companyId }).sort({ createdAt: -1 }).lean();
    res.render('admin/users/index', { org: req.company, currentUser: req.user, users });
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
      columns: true, skip_empty_lines: true, trim: true
    });

    const allowedRoles = new Set(['MEMBER', 'MODERATOR', 'ORG_ADMIN']);
    const results = { created: 0, skipped: 0, errors: 0 };

    for (const row of rows) {
      const fullName = row.fullName?.trim();
      const email = row.email?.toLowerCase().trim();
      const role = (row.role || 'MEMBER').toUpperCase();

      if (!fullName || !email || !allowedRoles.has(role)) { results.skipped++; continue; }

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
        });
        await u.save();
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
    res.redirect(`/${req.params.org}/admin/users`);
  } catch (e) { next(e); }
});

router.get('/:userId/edit', ensureAuth, requireRole('ORG_ADMIN'), profile.editForm);
router.post('/:userId', ensureAuth, requireRole('ORG_ADMIN'), profile.update);

module.exports = router;
