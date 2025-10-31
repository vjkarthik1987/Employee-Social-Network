// /routes/auth.js
const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const Company = require('../models/Company');
const User = require('../models/User');

const router = express.Router();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };


// GET: register org (first admin)
router.get('/register-org', (_req, res) => {
  res.render('auth/register-org');
});

router.post('/register-org', async (req, res) => {
  try {
    const { companyName, companySlug, fullName, email, password } = req.body;

    // 1) Create the company with trial + license bootstrap
    const company = await Company.create({
      name: companyName,
      slug: companySlug.toLowerCase().trim(),

      // ↓↓↓ NEW: bootstrapped plan & license for Day 35 ↓↓↓
      planState: 'FREE_TRIAL',
      trialEndsAt: addDays(new Date(), 90),
      license: {
        seats: 25,
        used: 0, // will set to 1 after we create the first admin
        validTill: addDays(new Date(), 90)
      }
    });

    // 2) Create the first admin user
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({
      companyId: company._id,
      role: 'ORG_ADMIN',
      email: email.toLowerCase().trim(),
      fullName: fullName.trim(),
      passwordHash
    });

    // 3) Bump license.used to 1 (first admin)
    company.license.used = 1;
    await company.save();

    // (Optional) Audit: org registered
    // const auditService = require('../services/auditService');
    // await auditService.record('system', 'ORG_REGISTERED', { companyId: company._id, slug: company.slug });

    // 4) Success & redirect to login
    req.flash('success', `Organization created. Free trial ends on ${company.trialEndsAt.toDateString()}. You can now log in.`);
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
