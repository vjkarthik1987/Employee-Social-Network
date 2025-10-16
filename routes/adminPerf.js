// routes/adminPerf.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const perf = require('../services/perfService');

const router = express.Router({ mergeParams: true });

router.get('/', ensureAuth, requireRole('ORG_ADMIN'), async (req, res) => {
  const raw = perf.getRecent({ limit: 200 })
    .filter(r => !r.companyId || String(r.companyId) === String(req.companyId));

  const byRoute = new Map();
  for (const r of raw) {
    const k = r.route || 'unknown';
    if (!byRoute.has(k)) byRoute.set(k, []);
    byRoute.get(k).push(r.durationMs);
  }
  const rows = Array.from(byRoute.entries()).map(([route, durs]) => {
    const n = durs.length;
    const sum = durs.reduce((a,b)=>a+b,0);
    const avg = n ? sum / n : 0;
    const p95 = n ? durs.slice().sort((a,b)=>a-b)[Math.floor(n*0.95)-1] || durs[durs.length-1] : 0;
    return { route, count: n, avg: Math.round(avg), p95: Math.round(p95), last: Math.round(durs[durs.length-1] || 0) };
  }).sort((a,b)=> a.route.localeCompare(b.route));

  const cache = perf.getCacheSummary();

  res.render('admin/perf', {
    company: req.company,
    user: req.user,
    rows,
    recent: raw.slice(-50).reverse(),
    cache,
  });
});

module.exports = router;
