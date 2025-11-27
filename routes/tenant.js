// /routes/tenant.js
const express = require('express');
const csrf = require('csurf');
const csrfProtection = csrf();

const { ensureAuth, requireRole } = require('../middleware/auth');
const tenantAuth = require('./tenantAuth');
const adminUsers = require('./adminUsers');
const groupsRouter = require('./groups');
const postsRouter = require('./posts');
const profileRoutes = require('./profile');
const savedSearches = require('./savedSearches');
const adminRetention = require('./adminRetention');
const adminInternalLinks = require('./adminInternalLinks'); 
const adminAssistantDocs = require('./adminAssistantDocs');
const assistantApiRoutes = require('./assistantApi');
const internalLinksApi = require('./api/internalLinks');
const adminPerf = require('./adminPerf');
const adminPolls = require('./adminPolls');
const adminAudit = require('./adminAudit');
const exportsRouter = require('./exports');

const adminController = require('../controllers/adminController');

const commentsApi = require('./api/comments');
const reactionsApi = require('./api/reactions'); 
const reportsApi = require('./api/reports');
const postsApi = require('./api/posts');
const usersApi = require('./api/users');
const pollsApi = require('./api/polls');

const pc = require('../controllers/postController');
const moderation = require('../controllers/moderationController');


const router = express.Router({ mergeParams: true });

const Company = require('../models/Company');
const Group = require('../models/Group');
const linksLoader = require('../middleware/linksLoader');

// Tiny async wrapper so errors don’t crash the process.
const aw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);


// tenant resolver
router.use(aw(async (req, res, next) => {
  const slug = (req.params.org || '').toLowerCase().trim();

  const company = await Company.findOne({ slug });
  if (!company) return res.status(404).render('errors/404');

  req.company = company;
  req.companyId = company._id;         // handy for queries: { companyId: req.companyId }
  res.locals.company = company;        // for views (logo, name, theme)
  res.locals.org = company;            // keep your existing usage working
  next();
}));

router.use(linksLoader);
router.use('/auth', tenantAuth);
router.use('/admin/users', adminUsers);
router.use('/groups', groupsRouter);
router.use('/posts', postsRouter);
router.use('/', require('./reports'));
router.use('/profile', ensureAuth, profileRoutes);
router.get('/feed', ensureAuth, csrfProtection, pc.companyFeed);
router.use('/saved-searches', savedSearches);
router.use('/admin/retention', adminRetention);
router.use('/admin/internal-links', adminInternalLinks);
router.use('/admin/assistant-docs', adminAssistantDocs);
router.use('/admin/perf', ensureAuth, requireRole('ORG_ADMIN'), adminPerf);
router.use('/admin/polls', ensureAuth, requireRole('ORG_ADMIN'), adminPolls)
router.use('/api/assistant', assistantApiRoutes);
router.use('/', exportsRouter);
router.use('/admin/audit', adminAudit);
router.use('/api', commentsApi);
router.use('/api', reactionsApi);
router.use('/api', postsApi); 
router.use('/api', reportsApi);
router.use('/api', usersApi);
router.use('/api', internalLinksApi);
router.use('/api', pollsApi);

// Org root → feed
router.get('/', ensureAuth, (req, res) => {
  res.redirect(`/${req.params.org}/feed`);
});

// Feed (all members)
// Later, when Post model exists, query with { companyId: req.companyId, status: 'PUBLISHED' }
// router.get('/feed', ensureAuth, async (req, res, next) => {
//   try {
//     const groups = await Group.find({ companyId: req.companyId })
//       .sort({ createdAt: -1 })
//       .limit(6)
//       .lean();

//     res.render('feed/index', {
//       user: req.user,
//       company: req.company,
//       groups
//     });
//   } catch (e) { next(e); }
// });

// Moderation queue (mods + admins)
router.get(
  '/mod/queue',
  ensureAuth,
  requireRole('MODERATOR', 'ORG_ADMIN'),
  moderation.queue
);

router.post('/posts/mod/approve',
  ensureAuth,
  requireRole('MODERATOR','ORG_ADMIN'),
  moderation.approve
);

router.post('/posts/mod/reject',
  ensureAuth,
  requireRole('MODERATOR','ORG_ADMIN'),
  moderation.reject
);

// Admin settings (admins only)
router.get(
  '/admin/settings',
  ensureAuth,
  requireRole('ORG_ADMIN'),
  adminController.settingsForm
);

router.post(
  '/admin/settings',
  ensureAuth,
  requireRole('ORG_ADMIN'),
  adminController.updateSettings
);


module.exports = router;