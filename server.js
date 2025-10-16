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

// --- Routes ---
const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenant');

// --- Passport config (your local module that does serialize/deserialize & strategies)
const configurePassport = require('./config/passport'); // adjust path if yours differs

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

// Trust proxy (enable when behind a proxy like Nginx / Heroku)
// if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// --------- Parsers (must be before session) ---------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------- Session (must be before csrf & passport) ---------
app.use(
  session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      touchAfter: 24 * 3600, // seconds
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure: true, // uncomment in prod with HTTPS + trust proxy
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// Flash messages
app.use(flash());

// Static
app.use(express.static(path.join(__dirname, 'public')));

// --------- Passport ---------
app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// --------- CSRF (must be after session) ---------
app.use(csrf());

// Expose CSRF token & common locals to all views
app.use((req, res, next) => {
  try {
    res.locals.csrfToken = req.csrfToken();
  } catch {
    res.locals.csrfToken = '';
  }
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.companySlug = (req.session && req.session.companySlug) || null;
  // ensure `company` is at least defined so layouts can read it safely
  res.locals.company = typeof res.locals.company === 'undefined' ? null : res.locals.company;
  next();
});

// --------- Basic routes (public) ---------
app.get('/health', (_req, res) => res.json({ ok: true }));

// Landing (optional — render a generic page without company context)
app.get('/', (req, res) => {
  // You can redirect to /:org/feed if you want, or show a simple landing:
  res.render('pages/home', { title: 'Welcome', company: null, user: req.user || null });
});

// --------- App routes ---------
app.use('/auth', authRoutes);
app.use('/:org', tenantRoutes);

// --------- CSRF error handler (must be after routes) ---------
app.use((err, req, res, next) => {
  if (err && err.code === 'EBADCSRFTOKEN') {
    // token missing/invalid
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

// --------- 404 ---------
app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).render('errors/404', { company: res.locals.company || null, user: req.user || null });
  return res.status(404).json({ ok: false, error: 'Not Found' });
});

// --------- Generic error handler ---------
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  if (req.accepts('html')) {
    return res.status(status).render('errors/404', {
      company: res.locals.company || null,
      user: req.user || null,
      message: err.message || 'Something went wrong',
    });
  }
  return res.status(status).json({ ok: false, error: err.message || 'Server error' });
});

// Start
app.listen(PORT, () => {
  console.log(`➡  http://localhost:${PORT}`);
});