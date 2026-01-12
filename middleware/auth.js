// /middleware/auth.js
exports.ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  const org = (req.params && req.params.org) || (req.company && req.company.slug) || req.session?.companySlug;
  if (org) return res.redirect(`/auth/login`);
  return res.redirect('/auth/login'); // or '/auth/register-org'
};

exports.requireRole = (...allowed) => {
  const allowedUpper = allowed.map(r => String(r).toUpperCase());
  return (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      req.flash('error', 'Please log in.');
      return res.redirect(`/${req.params?.org || ''}/auth/login`);
    }

    const userRole = String(req.user?.role || '').toUpperCase();
    if (!userRole || !allowedUpper.includes(userRole)) {
      console.warn('[RBAC] 403 role denied', { route: req.originalUrl, need: allowedUpper, have: userRole });
      // For web routes, a friendly redirect is nicer than a hard 403:
      req.flash('error', 'You don’t have permission to do that.');
      return res.redirect('back');
    }

    return next();
  };
};