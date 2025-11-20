// routes/superAdmin.js
const express = require('express');
const bcrypt = require('bcrypt');

const Company = require('../models/Company');
const User = require('../models/User');

const Group = require('../models/Group');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Attachment = require('../models/Attachment');
const PollResponse = require('../models/PollResponse');
const InternalLink = require('../models/InternalLink');

const router = express.Router();

// --- helpers ---
function superAdminEnabled() {
  // supports SUPERADMIN_ENABLED or SUPERADMIN__ENABLED
  const v = process.env.SUPERADMIN_ENABLED || process.env.SUPERADMIN__ENABLED || 'false';
  return String(v).toLowerCase() === 'true';
}

function getSuperAdminEmail() {
  return process.env.SUPERADMIN_EMAIL || process.env.SUPERADMIN__EMAIL || '';
}

function getSuperAdminHash() {
  return process.env.SUPERADMIN__PASSWORD_HASH || process.env.SUPERADMIN_PASSWORD_HASH || '';
}

function requireSuperAdmin(req, res, next) {
  if (!superAdminEnabled()) {
    const err = new Error('Super admin panel is disabled');
    err.status = 403;
    return next(err);
  }

  if (req.session && req.session.superAdmin && req.session.superAdmin.loggedIn) {
    return next();
  }

  return res.redirect('/super-admin/login');
}

// Tiny async wrapper
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Routes ---

// GET /super-admin/login
router.get('/login', aw(async (req, res) => {
  if (!superAdminEnabled()) {
    return res.status(404).render('errors/404');
  }

  if (req.session?.superAdmin?.loggedIn) {
    return res.redirect('/super-admin/home');
  }

  return res.render('superadmin/login', {
    title: 'Super Admin Login'
  });
}));

// POST /super-admin/login
router.post('/login', aw(async (req, res) => {
  if (!superAdminEnabled()) {
    req.flash('error', 'Super admin panel is disabled');
    return res.redirect('/super-admin/login');
  }

  const { email, password } = req.body || {};
  const envEmail = getSuperAdminEmail();
  const envHash = getSuperAdminHash();

  if (!envEmail || !envHash) {
    req.flash('error', 'Super admin credentials not configured');
    return res.redirect('/super-admin/login');
  }

  const emailOk =
    typeof email === 'string' &&
    email.trim().toLowerCase() === envEmail.trim().toLowerCase();

  const passwordOk = await bcrypt.compare(password || '', envHash);

  if (!emailOk || !passwordOk) {
    req.flash('error', 'Invalid email or password');
    return res.redirect('/super-admin/login');
  }

  req.session.superAdmin = {
    loggedIn: true,
    email: envEmail,
  };

  return res.redirect('/super-admin/home');
}));

// GET /super-admin/home
router.get('/home', requireSuperAdmin, aw(async (req, res) => {
  const [companiesCount, usersCount] = await Promise.all([
    Company.countDocuments({}),
    User.countDocuments({}),
  ]);

  return res.render('superadmin/home', {
    title: 'Super Admin Home',
    companiesCount,
    usersCount,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));

// POST /super-admin/logout
router.post('/logout', requireSuperAdmin, (req, res, next) => {
  try {
    if (req.session && req.session.superAdmin) {
      delete req.session.superAdmin;
    }
    return res.redirect('/super-admin/login');
  } catch (e) {
    return next(e);
  }
});


// GET /super-admin/companies
router.get('/companies', requireSuperAdmin, aw(async (req, res) => {
  const companies = await Company.find(
    {},
    'name slug status planState dataRegion createdAt'
  )
    .sort({ createdAt: -1 })
    .lean();

  return res.render('superadmin/companies', {
    title: 'All Companies',
    companies,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));

// GET /super-admin/companies/:id  - Company detail view
router.get('/companies/:id', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findById(companyId).lean();
  if (!company) {
    // adjust to your 404 view name if different
    return res.status(404).render('errors/404', { title: 'Company not found' });
  }

  const [
    usersCount,
    groupsCount,
    postsCount,
    commentsCount,
    attachmentsCount,
    pollResponsesCount,
    internalLinksCount,
  ] = await Promise.all([
    User.countDocuments({ companyId }),
    Group.countDocuments({ companyId }),
    Post.countDocuments({ companyId }),
    Comment.countDocuments({ companyId }),
    Attachment.countDocuments({ companyId }),
    PollResponse.countDocuments({ companyId }),
    InternalLink.countDocuments({ companyId }),
  ]);

  // derive some computed values for the template
  const isVerified = !!company.verifiedAt;
  const verificationStatus = isVerified ? 'Verified' : 'Not verified';
  const now = new Date();
  const trialStatus = company.trialEndsAt
    ? (company.trialEndsAt > now ? 'In trial' : 'Trial expired')
    : 'No trial set';

  return res.render('superadmin/company_detail', {
    title: `Company · ${company.name}`,
    company,
    verificationStatus,
    trialStatus,
    usersCount,
    groupsCount,
    postsCount,
    commentsCount,
    attachmentsCount,
    pollResponsesCount,
    internalLinksCount,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));


module.exports = router;
