// scripts/retention.js
// Usage:
//   node scripts/retention.js               # all companies
//   node scripts/retention.js --org acme    # only org by slug
require('dotenv').config();

const mongoose = require('mongoose');
const Company = require('../models/Company');
const { purgeForCompany, purgeAllCompanies } = require('../services/retentionService');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/engage';

(async function main() {
  try {
    await mongoose.connect(MONGODB_URI);
    const idx = process.argv.indexOf('--org');

    if (idx > -1 && process.argv[idx + 1]) {
      const slug = process.argv[idx + 1].toLowerCase().trim();
      const company = await Company.findOne({ slug }).select('_id slug').lean();
      if (!company) throw new Error(`Org not found: ${slug}`);
      const result = await purgeForCompany(company._id, { verbose: true });
      console.log('[done]', slug, result);
    } else {
      const results = await purgeAllCompanies({ verbose: true });
      console.log('[done all]', results);
    }
  } catch (e) {
    console.error('[retention error]', e);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
