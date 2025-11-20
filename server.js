// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const passport = require('passport');
const engine = require('ejs-mate');
const csrf = require('csurf');
const pkg = require('./package.json');
const { licenseSweep } = require('./jobs/licenseSweep');
setInterval(() => { licenseSweep().catch(err => console.warn('[licenseSweep] failed', err)); }, 6 * 60 * 60 * 1000); // every 6h

// --- Routes ---
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenant');
const adminCentral = require('./routes/adminCentral');
const superAdminRoutes = require('./routes/superAdmin');

// --- Middleware ---
const timing = require('./middleware/timing');
const errorHandler = require('./middleware/errorHandler'); // central 4xx/5xx handler

// --- Passport config ---
const configurePassport = require('./config/passport'); // ensure this exists

// --- App & DB ---
const app = express();
 
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/engage';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me';

// Connect Mongo
mongoose.set('strictQuery', false);
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('[mongo] connected'))
  .catch((err) => {
    console.error('[mongo] connection error:', err.message);
    process.exit(1);
  });

// View engine
app.engine('ejs', engine);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Dev: ensure templates always re-render fresh
if (process.env.NODE_ENV !== 'production') {
  app.set('view cache', false);
  app.disable('etag');            // avoid 304s on HTML in dev
}

// if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// --------- Parsers (before session) ---------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------- Session (before csrf & passport) ---------
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI, touchAfter: 24 * 3600 }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // enable with HTTPS + trust proxy
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

// Flash
app.use(flash());

// Static
app.use(express.static(path.join(__dirname, 'public'), {maxAge: '1y'}));

// --------- Passport ---------
app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// --------- CSRF (after session) ---------
//app.use(csrf());

// Perf/Server-Timing
app.use(timing);

// Locals
app.use((req, res, next) => {
  try { res.locals.csrfToken = req.csrfToken(); } catch { res.locals.csrfToken = ''; }
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.assetVersion = Date.now(); 
  res.locals.companySlug = (req.session && req.session.companySlug) || null;
  res.locals.currentPath = req.originalUrl || '';
  // Keep `company` defined so layouts don't explode
  if (typeof res.locals.company === 'undefined') res.locals.company = null;
  if (req.method === 'GET' && req.accepts('html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
  }
  next();
});

// --------- Public basics ---------
app.get('/health', (_req, res) => res.json({ ok: true }));



// If you don't have views/pages/home.ejs, consider redirecting to a default org or render a tiny page.
app.get('/', (_req, res) => {
  res.render('pages/home', { title: 'Welcome', company: null, user: null });
});

app.get('/features', (_req, res) => {
  res.render('pages/features', {title: "Features of Jaango", company: null, user: null})
})

app.get('/about-us', (_req, res) => {
  res.render('pages/about-us', {title: "About us", company: null, user: null})
})

app.get('/pricing', (_req, res) => {
  res.render('pages/pricing', {title: "A world of single price", company: null, user: null})
})

app.get('/how-it-works', (_req, res) => {
  res.render('pages/how-it-works', {title: "How it works", company: null, user: null})
})

app.use('/super-admin', superAdminRoutes);
app.use('/', adminCentral);

app.use('/:org', (req, res, next) => {
  res.locals.org = req.params.org;       // available in all EJS views
  next();
});


// --------- App routes ---------
app.use('/auth', authRoutes);
app.use('/:org', tenantRoutes);

// 1) No-store for HTML responses
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store'); // for HTML routes
  next();
});

// 2) Long cache for static assets
app.use(express.static('public', {
  maxAge: '1y',
  setHeaders: (res, path) => {
    // mark versioned assets as immutable
    if (path.includes('?v=')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));


// --------- CSRF error handler (after routes) ---------
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    if (req.accepts('html')) {
      return res.status(403).render('errors/403', {
        company: res.locals.company || null,
        user: req.user || null,
        message: 'Invalid CSRF token',
      });
    }
    return res.status(403).json({ ok: false, error: 'Invalid CSRF token' });
  }
  return next(err);
});

// --------- Not found ---------
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).render('errors/404', {
      company: res.locals.company || null,
      user: req.user || null,
    });
  }
  return res.status(404).json({ ok: false, error: 'Not Found' });
});

// --------- Central error handler (single source of truth) ---------
app.use(errorHandler);

// Start
app.listen(PORT, () => {
  console.log(`➡  http://localhost:${PORT}`);
});
