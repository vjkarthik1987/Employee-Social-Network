// routes/superAdmin.js
const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const Company = require('../models/Company');
const User = require('../models/User');

const EmailToken = require('../models/EmailToken');
const AuditLog = require('../models/AuditLog');

const Group = require('../models/Group');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Attachment = require('../models/Attachment');
const PollResponse = require('../models/PollResponse');
const InternalLink = require('../models/InternalLink');

const { sendOrgVerificationEmail } = require('../services/mailer');
const APP_BASE = process.env.APP_BASE_URL || 'http://localhost:3000';


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

const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

async function logSuperAdminAction({ companyId, action, meta, req }) {
  try {
    await AuditLog.create({
      companyId,
      actorUserId: null,          // super admin is outside tenant users
      actorRole: 'SUPER_ADMIN',
      action,                     // e.g., 'COMPANY_SUSPENDED'
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
      meta: meta || {},
    });
  } catch (e) {
    // don't crash super admin flow if logging fails
    console.error('Failed to log super admin action', e);
  }
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
// GET /super-admin/companies  - with search + filters + sort
router.get('/companies', requireSuperAdmin, aw(async (req, res) => {
  const {
    q,
    status,
    planState,
    region,
    verification,
    trialWindow,
    sort,
  } = req.query || {};

  const filter = {};
  const now = new Date();

  // Text search on name / slug
  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), 'i');
    filter.$or = [
      { name: regex },
      { slug: regex },
    ];
  }

  // Status filter (active / suspended)
  if (status && status !== 'any') {
    filter.status = status;
  }

  // Plan state filter (FREE_TRIAL / ACTIVE / EXPIRED)
  if (planState && planState !== 'any') {
    filter.planState = planState;
  }

  // Region filter (IN / EU / US)
  if (region && region !== 'any') {
    filter.dataRegion = region;
  }

  // Verification filter
  if (verification === 'verified') {
    filter.verifiedAt = { $ne: null };
  } else if (verification === 'unverified') {
    filter.verifiedAt = null;
  }

  // Trial window filter (ending in X days)
  if (trialWindow === '7' || trialWindow === '30') {
    const days = Number(trialWindow);
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    filter.trialEndsAt = {
      $gte: now,
      $lte: end,
    };
  }

  // Sort
  let sortOption = { createdAt: -1 }; // default: newest
  if (sort === 'oldest') {
    sortOption = { createdAt: 1 };
  } else if (sort === 'trialEnding') {
    sortOption = { trialEndsAt: 1 };
  } else if (sort === 'name') {
    sortOption = { name: 1 };
  }

  const companies = await Company.find(
    filter,
    'name slug status planState dataRegion createdAt trialEndsAt verifiedAt'
  )
    .sort(sortOption)
    .lean();

  const filters = {
    q: q || '',
    status: status || 'any',
    planState: planState || 'any',
    region: region || 'any',
    verification: verification || 'any',
    trialWindow: trialWindow || 'all',
    sort: sort || 'newest',
  };

  const hasFilters =
    (filters.q && filters.q.trim()) ||
    filters.status !== 'any' ||
    filters.planState !== 'any' ||
    filters.region !== 'any' ||
    filters.verification !== 'any' ||
    filters.trialWindow !== 'all' ||
    filters.sort !== 'newest';

  return res.render('superadmin/companies', {
    title: 'All Companies',
    companies,
    filters,
    hasFilters,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));

// GET /super-admin/companies/new
router.get('/companies/new', requireSuperAdmin, (req, res) => {
  res.render('superadmin/company_new', {
    superAdminEmail: req.session.superAdmin?.email || null,
    currentSection: 'companies',
    error: req.flash('error'),
    success: req.flash('success')
  });
});


// POST /super-admin/companies
router.post('/companies', requireSuperAdmin, async (req, res) => {
  try {
    const {
      companyName,
      companySlug,
      seats,
      adminFullName,
      adminEmail,
      adminPassword
    } = req.body;

    if (!companyName || !companySlug || !adminFullName || !adminEmail || !adminPassword) {
      req.flash('error', 'Please fill in all required fields.');
      return res.redirect('/super-admin/companies/new');
    }

    if (adminPassword.length < 8) {
      req.flash('error', 'Admin password must be at least 8 characters.');
      return res.redirect('/super-admin/companies/new');
    }

    const now = new Date();
    const trialEndsAt = addDays(now, 30);
    const nSeats = Math.max(1, Number(seats || 10));

    // Normalize slug a bit
    const normalizedSlug = companySlug.trim().toLowerCase();

    // Create company in FREE_TRIAL state (same pattern as /auth/register-org)
    const verifyToken = crypto.randomBytes(32).toString('hex');

    const company = await Company.create({
      name: companyName.trim(),
      slug: normalizedSlug,
      planState: 'FREE_TRIAL',
      plan: { kind: 'trial', seats: nSeats, trialEndsAt },
      trialEndsAt,
      license: { seats: nSeats, used: 0, validTill: trialEndsAt },
      verifyToken,
      verifyExpiresAt: addDays(now, 1),
      verifiedAt: null
    });

    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const user = await User.create({
      companyId: company._id,
      role: 'ORG_ADMIN',
      email: adminEmail.toLowerCase().trim(),
      fullName: adminFullName.trim(),
      passwordHash
    });

    company.license.used = 1;
    await company.save();

    const verifyUrl = `${APP_BASE}/auth/verify-org?token=${verifyToken}`;

    await sendOrgVerificationEmail({
      to: user.email,
      fullName: adminFullName.trim(),
      companyName: companyName.trim(),
      verifyUrl,
      trialEndsAt: company.trialEndsAt
    });

    req.flash(
      'success',
      'Company created and verification email sent to the admin. They must verify before logging in.'
    );
    return res.redirect(`/super-admin/companies/${company._id}`);

  } catch (err) {
    console.error('[super-admin:create-company] error:', err);

    if (err.code === 11000) {
      req.flash(
        'error',
        'Org slug or admin email already exists. Please use a different slug/email.'
      );
    } else {
      req.flash(
        'error',
        'Could not create the company. Please try again.'
      );
    }

    return res.redirect('/super-admin/companies/new');
  }
});


// GET /super-admin/companies/pending
router.get('/companies/pending', requireSuperAdmin, aw(async (req, res) => {
  const message = req.query.msg || null;

  // Companies that are not yet verified
  const companies = await Company.find(
    { verifiedAt: null },
    'name slug dataRegion timezone createdAt verifyToken verifyExpiresAt'
  )
    .sort({ createdAt: -1 })
    .lean();

  if (!companies.length) {
    return res.render('superadmin/companies_pending', {
      title: 'Pending verification',
      rows: [],
      message,
      superAdminEmail: req.session.superAdmin?.email || null,
    });
  }

  const companyIds = companies.map(c => c._id);

  // Fetch latest verify-company EmailToken per company (if any)
  const tokens = await EmailToken.find({
    companyId: { $in: companyIds },
    purpose: 'verify-company',
  })
    .sort({ createdAt: -1 })
    .lean();

  const tokenMap = new Map();
  for (const t of tokens) {
    const key = String(t.companyId);
    if (!tokenMap.has(key)) {
      tokenMap.set(key, t); // keep only the latest per company
    }
  }

  const now = new Date();
  const rows = companies.map(c => {
    const key = String(c._id);
    const token = tokenMap.get(key) || null;
    const hasToken = !!token || !!c.verifyToken;
    const expiresAt = token?.expiresAt || c.verifyExpiresAt || null;
    const isExpired = expiresAt ? expiresAt <= now : false;

    return {
      company: c,
      token,
      hasToken,
      expiresAt,
      isExpired,
    };
  });

  return res.render('superadmin/companies_pending', {
    title: 'Pending verification',
    rows,
    message,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));

// POST /super-admin/companies/:id/mark-verified
router.post('/companies/:id/mark-verified', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findById(companyId);
  if (!company) {
    return res.status(404).render('errors/404', { title: 'Company not found' });
  }

  const now = new Date();
  company.verifiedAt = now;
  company.verifyToken = null;
  company.verifyExpiresAt = null;
  await company.save();


  return res.redirect('/super-admin/companies/pending?msg=Company%20marked%20as%20verified');
}));

// GET /super-admin/companies/:id  - Company detail view
router.get('/companies/:id', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findById(companyId).lean();
  if (!company) {
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
    groupsList,
    auditLogs,
  ] = await Promise.all([
    User.countDocuments({ companyId }),
    Group.countDocuments({ companyId }),
    Post.countDocuments({ companyId }),
    Comment.countDocuments({ companyId }),
    Attachment.countDocuments({ companyId }),
    PollResponse.countDocuments({ companyId }),
    InternalLink.countDocuments({ companyId }),
    // latest groups
    Group.find(
      { companyId },
      'name description isPrivate membershipPolicy membersCount postsCount createdAt'
    )
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
    // latest audit log entries for this tenant
    AuditLog.find({ companyId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
  ]);

  // ---- License utilisation (fallback to usersCount if used is 0/undefined) ----
  const licenseSeats = company.license?.seats || 0;

  let licenseUsed = typeof company.license?.used === 'number'
    ? company.license.used
    : 0;

  if ((!licenseUsed || licenseUsed === 0) && usersCount > 0) {
    licenseUsed = usersCount;
  }

  const licenseUtilisation =
    licenseSeats > 0 ? Math.round((licenseUsed / licenseSeats) * 100) : 0;

  // ---- Storage aggregation (attachments) ----
  const attachmentUsage = await Attachment.aggregate([
    { $match: { companyId } },
    {
      $group: {
        _id: null,
        totalBytes: { $sum: { $ifNull: ['$sizeBytes', 0] } },
      },
    },
  ]);

  const attachmentsTotalBytes =
    attachmentUsage.length && attachmentUsage[0].totalBytes
      ? attachmentUsage[0].totalBytes
      : 0;

  const attachmentsTotalMB = attachmentsTotalBytes / (1024 * 1024);

  // ---- Other computed values ----
  const isVerified = !!company.verifiedAt;
  const verificationStatus = isVerified ? 'Verified' : 'Not verified';

  const now = new Date();
  const trialStatus = company.trialEndsAt
    ? (company.trialEndsAt > now ? 'In trial' : 'Trial expired')
    : 'No trial set';

  const message = req.query.msg || null;

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
    attachmentsTotalBytes,
    attachmentsTotalMB,
    licenseSeats,
    licenseUsed,
    licenseUtilisation,
    groupsList,
    auditLogs, // 👈 NEW
    message,
    superAdminEmail: req.session.superAdmin?.email || null,
  });
}));




// POST /super-admin/companies/:id/suspend
router.post('/companies/:id/suspend', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findByIdAndUpdate(
    companyId,
    { status: 'suspended' },
    { new: true }
  );

  if (!company) {
    return res.status(404).render('errors/404', { title: 'Company not found' });
  }


  return res.redirect(`/super-admin/companies/${companyId}?msg=Company%20suspended`);
}));

// POST /super-admin/companies/:id/activate
router.post('/companies/:id/activate', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findByIdAndUpdate(
    companyId,
    { status: 'active' },
    { new: true }
  );

  if (!company) {
    return res.status(404).render('errors/404', { title: 'Company not found' });
  }


  return res.redirect(`/super-admin/companies/${companyId}?msg=Company%20activated`);
}));

// POST /super-admin/companies/:id/extend-trial
router.post('/companies/:id/extend-trial', requireSuperAdmin, aw(async (req, res) => {
  const companyId = req.params.id;

  const company = await Company.findById(companyId);
  if (!company) {
    return res.status(404).render('errors/404', { title: 'Company not found' });
  }

  const days = 30; // extend by 30 days (tweak if you prefer)
  const now = new Date();
  const base = company.trialEndsAt && company.trialEndsAt > now
    ? company.trialEndsAt
    : now;

  const newTrialEndsAt = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  company.trialEndsAt = newTrialEndsAt;
  await company.save();


  return res.redirect(`/super-admin/companies/${companyId}?msg=Trial%20extended%20by%20${days}%20days`);
}));



module.exports = router;
