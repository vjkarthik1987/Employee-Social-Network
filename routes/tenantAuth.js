// routes/tenantAuth.js
const express = require('express');
const passport = require('passport');
const Company = require('../models/Company');
const router = express.Router({ mergeParams: true });

// Login page
router.get('/login', (req, res) => {
  res.render('auth/login', { company: req.company });
});

// Tenant-scoped login
router.post('/login', (req, res, next) => {
  // We’ll authenticate with local strategy, but ensure company via slug:
  passport.authenticate('local', async (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info?.message || 'Invalid credentials');
      return res.redirect(`/${req.params.org}/auth/login`);
    }
    req.logIn(user, async (err2) => {
      if (err2) return next(err2);

      // Guard: user must belong to this tenant
      if (String(user.companyId) !== String(req.company._id)) {
        req.flash('error', 'You are not a member of this organization.');
        req.logout(() => {});
        return res.redirect(`/${req.params.org}/auth/login`);
      }

      req.session.companySlug = req.company.slug;
      req.flash('success', 'Welcome!');
      return res.redirect(`/${req.params.org}/feed`);
    });
  })(req, res, next);
});

// Logout
router.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect(`/${req.params.org}/auth/login`);
  });
});

module.exports = router;
