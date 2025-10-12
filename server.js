// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const passport = require('passport');
const path = require('path');
const ejsMate = require('ejs-mate');


const Company = require('./models/Company');

const authRoutes = require('./routes/auth');
const tenantRoutes = require('./routes/tenant');

const { ensureAuth } = require('./middleware/auth');
const configurePassport = require('./config/passport');


const app = express();

// ---- DB ----
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/engage');

// ---- Parsers ----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Views ----
app.engine('ejs', ejsMate); 
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// helper to resolve slug via session cache → DB
async function resolveSlug(req) {
  if (req.session?.companySlug) return req.session.companySlug;
  if (!req.user?.companyId) return null;
  const company = await Company.findById(req.user.companyId).lean();
  if (company) {
    req.session.companySlug = company.slug;
    return company.slug;
  }
  return null;
}

// ---- Session ----
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_me',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/engage' }),
    cookie: {
      httpOnly: true,
      // secure: true, // enable in prod behind HTTPS
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);
app.use(flash());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Passport ----
app.use(passport.initialize());
app.use(passport.session());
configurePassport(passport);

// ---- Flash -> locals ----
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.companySlug = (req.session && req.session.companySlug) || null; // 👈 add this
  next();
});

// ---- Routes ----
app.use('/auth', authRoutes);
app.use('/:org', tenantRoutes);


// Make /dashboard redirect to tenant feed
app.get('/dashboard', ensureAuth, async (req, res, next) => {
  try {
    const slug = await resolveSlug(req);
    if (!slug) {
      req.flash('error', 'Could not resolve your organization.');
      return res.redirect('/auth/login');
    }
    return res.redirect(`/${slug}/feed`);
  } catch (e) { next(e); }
});

app.get('/', (req, res) => {
  res.render('pages/home', {
    user: req.user || null,
    companySlug: req.session?.companySlug || null
  });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use((req, res) => {
  res.status(404).render('errors/404');
});

// Error handler (optional catch-all for unexpected errors)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).send('Something went wrong');
});

// ---- Start ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
