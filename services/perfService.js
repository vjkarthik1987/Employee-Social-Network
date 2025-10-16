// services/perfService.js
// Minimal write-through logger with backpressure guard.
// If you want persistence & charts, also add models/PerfLog.js below and uncomment writes.

let recent = []; // in-memory ring buffer (most recent 300 entries)
const MAX = 300;

exports.record = function ({ companyId, route, durationMs, count = 0, page = null, limit = null }) {
  try {
    const row = {
      ts: new Date(),
      companyId: companyId ? String(companyId) : null,
      route,
      durationMs: Number(durationMs || 0),
      count: Number(count || 0),
      page: page == null ? null : Number(page),
      limit: limit == null ? null : Number(limit),
    };
    recent.push(row);
    if (recent.length > MAX) recent = recent.slice(recent.length - MAX);
    // Optional: persist (uncomment after creating PerfLog model)
    // PerfLog.create({ ...row }).catch(()=>{});
  } catch (_) {}
};

exports.getRecent = function ({ limit = 100 } = {}) {
  return recent.slice(Math.max(0, recent.length - limit));
};

let cacheEvents = []; // { ts, type: 'hit'|'miss'|'bust', key, count? }
const CMAX = 400;

exports.cacheEvent = function ({ type, key, count = 1 }) {
  try {
    cacheEvents.push({ ts: new Date(), type, key, count });
    if (cacheEvents.length > CMAX) cacheEvents = cacheEvents.slice(cacheEvents.length - CMAX);
  } catch (_) {}
};

exports.getCacheSummary = function () {
  const last = cacheEvents.slice(-200);
  const agg = { hit: 0, miss: 0, bust: 0 };
  last.forEach(e => { agg[e.type] = (agg[e.type] || 0) + (e.count || 1); });
  const totalLookups = agg.hit + agg.miss;
  const hitRate = totalLookups ? Math.round((agg.hit / totalLookups) * 100) : 0;
  return { agg, hitRate, recent: last.slice().reverse() };
};

