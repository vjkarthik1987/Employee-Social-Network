// /middleware/auth.js
exports.ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  const org = (req.params && req.params.org) || (req.company && req.company.slug) || req.session?.companySlug;
  if (org) return res.redirect(`/${org}/auth/login`);
  return res.redirect('/auth/login'); // or '/auth/register-org'
};

exports.requireRole = (...allowed) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      req.flash('error', 'Please log in.');
      return res.redirect('/auth/login');
    }
    if (!req.user?.role || !allowed.includes(req.user.role)) {
      return res.status(403).render('errors/403'); // or flash + redirect
    }
    return next();
  };
};