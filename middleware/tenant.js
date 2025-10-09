// middleware/tenant.js
const Company = require('../models/Company');

async function tenantGuard(req, res, next) {
  const slug = req.params.org || req.params.slug;
  if (!slug) return res.status(400).send('Company slug required');
  
  const company = await Company.findOne({ slug });
  if (!company) return res.status(404).send('Company not found');

  req.company = company;
  res.locals.company = company; // for views
  next();
}

module.exports = tenantGuard;
