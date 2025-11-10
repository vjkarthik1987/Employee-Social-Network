// /routes/auth.js
const express = require('express');
const passport = require('passport');
const bcrypt = require('bcrypt');
const Company = require('../models/Company');
const User = require('../models/User');
const crypto = require('crypto');
const EmailToken = require('../models/EmailToken');
const { sendOrgVerificationEmail } = require('../services/mailer');

const APP_BASE = process.env.APP_BASE_URL || 'http://localhost:3000';


const router = express.Router();
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };


// GET: register org (first admin)
router.get('/register-org', (_req, res) => {
  res.render('auth/register-org');
});

// POST /auth/register-org
router.post('/register-org', async (req, res) => {
  try {
    const { companyName, companySlug, fullName, email, password, seats, agree } = req.body;

    if (!agree) {
      req.flash('error', 'Please agree to the Terms & Privacy to continue.');
      return res.redirect('/auth/register-org');
    }
    if (!password || password.length < 8) {
      req.flash('error', 'Please provide a password with at least 8 characters.');
      return res.redirect('/auth/register-org');
    }

    const now = new Date();
    const trialEndsAt = addDays(now, 30);
    const nSeats = Math.max(1, Number(seats || 10));

    // Create company in FREE_TRIAL state
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const company = await Company.create({
      name: companyName.trim(),
      slug: companySlug.toLowerCase().trim(),
      planState: 'FREE_TRIAL',
      plan: { kind: 'trial', seats: nSeats, trialEndsAt },
      trialEndsAt,
      license: { seats: nSeats, used: 0, validTill: trialEndsAt },
      verifyToken,
      verifyExpiresAt: addDays(now, 1),
      verifiedAt: null
    });

    // 🔐 hash password and set passwordHash explicitly
    const passwordHash = await bcrypt.hash(password, 12);

    // First admin user (enum should allow ORG_ADMIN)
    const user = await User.create({
      companyId: company._id,
      role: 'ORG_ADMIN',
      email: email.toLowerCase().trim(),
      fullName: fullName.trim(),
      passwordHash                           // 🔐 set hashed password
    });

    // Update license usage
    company.license.used = 1;
    await company.save();

    // Send org verification email
    const verifyUrl = `${APP_BASE}/auth/verify-org?token=${verifyToken}`;
    console.log(APP_BASE);
    console.log(verifyUrl);
    await sendOrgVerificationEmail({
      to: user.email,
      fullName,
      companyName,                     // make sure this comes from req.body and is not undefined
      verifyUrl,                       // absolute URL like http(s)://host/auth/verify-org?token=...
      trialEndsAt: company.trialEndsAt // pass the actual Date from the doc
    });
    

    req.flash('success', 'We’ve emailed a verification link. Please check your inbox.');
    return res.redirect('/auth/check-email');

  } catch (err) {
    console.error('[register-org] error:', err);
    req.flash('error', err.code === 11000
      ? 'Org slug or user email already exists.'
      : 'Could not create your organization. Please try again.');
    return res.redirect('/auth/register-org');
  }
});


// Email verification endpoint
// GET /auth/verify-org
router.get('/verify-org', async (req, res) => {
  const { token } = req.query || {};
  if (!token) return res.render('auth/verify-org', { success: false });

  try {
    const company = await Company.findOne({
      verifyToken: token,
      verifyExpiresAt: { $gt: new Date() }
    });

    if (!company) return res.render('auth/verify-org', { success: false });

    company.verifiedAt = new Date();
    company.verifyToken = null;
    company.verifyExpiresAt = null;
    await company.save();

    return res.render('auth/verify-org', {
      success: true,
      companyName: company.name
    });

  } catch (err) {
    console.error('[verify-org] error:', err);
    return res.render('auth/verify-org', { success: false });
  }
});



// Simple page: “check your mail”
router.get('/check-email', (req, res) => {
  return res.render('auth/check-email', {
    title: 'Check your email',
    user: null,
    company: null
  });
});

// GET: login
router.get('/login', (req, res) => {
  res.render('auth/login', {
    title: 'Login — Engage',
    auth: true,                // tells layout it's an auth page (no navbar/right bar)
    csrfToken: req.csrfToken?.()
  });
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
