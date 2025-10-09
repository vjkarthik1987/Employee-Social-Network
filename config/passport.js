// /config/passport.js
const LocalStrategy = require('passport-local').Strategy;
const Company = require('../models/Company');
const User = require('../models/User');

module.exports = function configurePassport(passport) {
  passport.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password', passReqToCallback: true },
      async (req, email, password, done) => {
        try {
          // Prefer the tenant already resolved by /:org router
          let company = req.company;
          if (!company) {
            const slug = (req.body.org || '').toLowerCase().trim();
            company = await Company.findOne({ slug });
          }
          if (!company) return done(null, false, { message: 'Unknown organization.' });

          const user = await User.findOne({ companyId: company._id, email: email.toLowerCase().trim() });
          if (!user) return done(null, false, { message: 'Invalid email or password.' });

          const ok = await user.verifyPassword(password);
          if (!ok) return done(null, false, { message: 'Invalid email or password.' });

          // (optional) attach company for later
          req.loginCompany = company;
          return done(null, { _id: user._id, companyId: company._id });
        } catch (err) { return done(err); }
      }
    )
  );

  passport.serializeUser((user, done) => done(null, { uid: user._id, cid: user.companyId }));
  passport.deserializeUser(async (payload, done) => {
    try {
      const user = await User.findById(payload.uid);
      if (!user) return done(null, false);
      done(null, user);
    } catch (e) { done(e); }
  });
};
