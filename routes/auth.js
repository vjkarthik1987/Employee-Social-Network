// /routes/auth.js
const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const Company = require('../models/Company');
const User = require('../models/User');

const router = express.Router();

// GET: register org (first admin)
router.get('/register-org', (_req, res) => {
  res.render('auth/register-org');
});

router.post('/register-org', async (req, res) => {
    try {
      const { companyName, companySlug, fullName, email, password } = req.body;
  
      const company = await Company.create({
        name: companyName,
        slug: companySlug.toLowerCase().trim(),
      });
  
      const passwordHash = await bcrypt.hash(password, 12);
  
      await User.create({
        companyId: company._id,
        role: 'ORG_ADMIN',
        email: email.toLowerCase().trim(),
        fullName: fullName.trim(),
        passwordHash, // <-- set explicitly
      });
  
      req.flash('success', 'Organization created. You can now log in.');
      res.redirect('/auth/login');
    } catch (err) {
      console.error(err);
      req.flash('error', err.code === 11000 ? 'Org slug or user email already exists.' : 'Failed to create organization.');
      res.redirect('/auth/register-org');
    }
});

// GET: login
router.get('/login', (_req, res) => {
  res.render('auth/login');
});

// POST: login (local)
// /routes/auth.js 
router.post('/login', (req, res, next) => {
    passport.authenticate('local', async (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        req.flash('error', info?.message || 'Login failed');
        return res.redirect('/auth/login');
      }
      req.logIn(user, async (err2) => {
        if (err2) return next(err2);
        try {
          // Resolve company slug from the user's companyId
          const company = await Company.findById(user.companyId).lean();
          if (!company) {
            req.flash('error', 'Company not found for this account.');
            return res.redirect('/auth/login');
          }
          // Cache for quick use later
          req.session.companySlug = company.slug;
          req.flash('success', 'Welcome back!');
          return res.redirect(`/${company.slug}/feed`);
        } catch (e) { return next(e); }
      });
    })(req, res, next);
  });
  

// POST: logout
router.post('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.flash('success', 'Logged out.');
    res.redirect('/auth/login');
  });
});

module.exports = router;
