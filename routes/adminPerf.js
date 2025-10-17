// routes/adminPerf.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const perf = require('../services/perfService');

const router = express.Router({ mergeParams: true });

// Page (unchanged summary table, now with live widgets fed by JSON)
router.get('/', ensureAuth, requireRole('ORG_ADMIN'), async (req, res) => {
  const raw = perf.getRecent({ limit: 200 })
    .filter(r => !r.companyId || String(r.companyId) === String(req.company?._id));

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

// ---------- Day 28 JSON endpoints ----------

// GET /:org/admin/perf/summary.json?window=60
router.get('/summary.json', ensureAuth, requireRole('ORG_ADMIN'), (req, res) => {
  const minutes = Math.max(1, Math.min(180, parseInt(req.query.window || '60', 10)));
  const data = perf.aggregateLast({
    minutes,
    companyId: req.company?._id,
    slug: req.company?.slug,
  });
  res.json(data);
});

// GET /:org/admin/perf/series.json?window=15
router.get('/series.json', ensureAuth, requireRole('ORG_ADMIN'), (req, res) => {
  const minutes = Math.max(5, Math.min(180, parseInt(req.query.window || '15', 10)));
  const data = perf.series({
    minutes,
    companyId: req.company?._id,
    slug: req.company?.slug,
  });
  res.json(data);
});

// GET /:org/admin/perf/recent-slow.json?threshold=400&limit=20
router.get('/recent-slow.json', ensureAuth, requireRole('ORG_ADMIN'), (req, res) => {
  const threshold = Math.max(100, Math.min(10000, parseInt(req.query.threshold || '400', 10)));
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '20', 10)));
  const data = perf.recentSlow({ companyId: req.company?._id, thresholdMs: threshold, limit });
  // shape it a bit for the UI
  res.json({
    items: data.map(r => ({
      ts: new Date(r.ts).toISOString(),
      route: r.route || 'unknown',
      durationMs: Math.round(r.durationMs || 0),
    })),
  });
});



module.exports = router;
