// services/perfService.js
// Lightweight in-memory perf logger + cache stats + aggregations.

let recent = [];       // perf events: { ts, companyId, route, durationMs, count, page, limit }
const MAX = 3000;      // keep a bigger ring for charts

exports.record = function ({ companyId, route, durationMs, count = 0, page = null, limit = null }) {
  try {
    const row = {
      ts: new Date(),
      companyId: companyId ? String(companyId) : null,
      route: route || 'unknown',
      durationMs: Number(durationMs || 0),
      count: Number(count || 0),
      page: page == null ? null : Number(page),
      limit: limit == null ? null : Number(limit),
    };
    recent.push(row);
    if (recent.length > MAX) recent = recent.slice(recent.length - MAX);
  } catch (_) {}
};

exports.getRecent = function ({ limit = 100 } = {}) {
  return recent.slice(Math.max(0, recent.length - limit));
};

// ---- Cache events ----
let cacheEvents = [];  // { ts, type: 'hit'|'miss'|'bust', key, count }
const CMAX = 4000;

exports.cacheEvent = function ({ type, key, count = 1 }) {
  try {
    cacheEvents.push({ ts: new Date(), type, key, count });
    if (cacheEvents.length > CMAX) cacheEvents = cacheEvents.slice(cacheEvents.length - CMAX);
  } catch (_) {}
};

// Basic summary used earlier
exports.getCacheSummary = function () {
  const last = cacheEvents.slice(-200);
  const agg = { hit: 0, miss: 0, bust: 0 };
  last.forEach(e => { agg[e.type] = (agg[e.type] || 0) + (e.count || 1); });
  const totalLookups = agg.hit + agg.miss;
  const hitRate = totalLookups ? Math.round((agg.hit / totalLookups) * 100) : 0;
  return { agg, hitRate, recent: last.slice().reverse() };
};

// ---------- Day 28 helpers ----------

function p95(arr) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  const idx = Math.max(0, Math.min(a.length - 1, Math.floor(a.length * 0.95) - 1));
  return a[idx];
}
function floorToMinute(d) {
  const t = new Date(d);
  t.setSeconds(0, 0);
  return t;
}
function withinWindow(items, minutes) {
  const now = Date.now();
  const start = now - minutes * 60 * 1000;
  return items.filter(r => +new Date(r.ts) >= start);
}
function filterByCompany(items, companyId) {
  if (!companyId) return items;
  const s = String(companyId);
  return items.filter(r => !r.companyId || String(r.companyId) === s);
}
function filterCacheBySlug(items, slug) {
  if (!slug) return items;
  // our keys look like: feed:v1:{slug}:..., groupfeed:v1:{slug}:..., post:v1:{slug}:...
  const needle = `:${slug}:`;
  return items.filter(e => typeof e.key === 'string' && e.key.includes(needle));
}

exports.aggregateLast = function aggregateLast({ minutes = 60, companyId = null, slug = null } = {}) {
  const win = withinWindow(recent, minutes);
  const scoped = filterByCompany(win, companyId);

  const durs = scoped.map(r => Number(r.durationMs || 0)).filter(n => n >= 0);
  const avg = durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  const p = p95(durs);

  const rpm = Math.round(scoped.length / Math.max(1, minutes));

  const ce = withinWindow(cacheEvents, minutes);
  const ceScoped = filterCacheBySlug(ce, slug);
  const cacheAgg = { hit: 0, miss: 0, bust: 0 };
  ceScoped.forEach(e => { cacheAgg[e.type] = (cacheAgg[e.type] || 0) + (e.count || 1); });
  const lookups = cacheAgg.hit + cacheAgg.miss;
  const hitRate = lookups ? Math.round((cacheAgg.hit / lookups) * 100) : 0;

  return {
    windowMin: minutes,
    now: new Date().toISOString(),
    latency: { avgMs: Math.round(avg), p95Ms: Math.round(p) },
    throughput: { rpm },
    cache: { ...cacheAgg, hitRate },
  };
};

exports.series = function series({ minutes = 15, companyId = null, slug = null } = {}) {
  const win = withinWindow(recent, minutes);
  const scoped = filterByCompany(win, companyId);

  // bucket perf events by minute
  const buckets = new Map(); // minuteISO -> { durs:[], count }
  scoped.forEach(r => {
    const key = floorToMinute(r.ts).toISOString();
    if (!buckets.has(key)) buckets.set(key, { durs: [], count: 0 });
    const b = buckets.get(key);
    b.durs.push(Number(r.durationMs || 0));
    b.count += 1;
  });

  // bucket cache events by minute (scoped by slug)
  const ce = filterCacheBySlug(withinWindow(cacheEvents, minutes), slug);
  const cacheB = new Map(); // minuteISO -> { hit, miss, bust }
  ce.forEach(e => {
    const key = floorToMinute(e.ts).toISOString();
    if (!cacheB.has(key)) cacheB.set(key, { hit: 0, miss: 0, bust: 0 });
    const b = cacheB.get(key);
    b[e.type] = (b[e.type] || 0) + (e.count || 1);
  });

  // Build last N minutes timeline
  const points = [];
  const now = floorToMinute(new Date());
  for (let i = minutes - 1; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 60000);
    const key = t.toISOString();

    const p = buckets.get(key) || { durs: [], count: 0 };
    const c = cacheB.get(key) || { hit: 0, miss: 0, bust: 0 };

    const avg = p.durs.length ? Math.round(p.durs.reduce((a, b) => a + b, 0) / p.durs.length) : 0;
    const p95v = Math.round(p95(p.durs));
    const rpm = p.count; // per-minute count

    points.push({
      t: t.toISOString(),
      avgMs: avg,
      p95Ms: p95v,
      rpm,
      hit: c.hit || 0,
      miss: c.miss || 0,
      bust: c.bust || 0,
    });
  }

  return { windowMin: minutes, points };
};

exports.recentSlow = function recentSlow({ companyId = null, thresholdMs = 400, limit = 20 } = {}) {
  const scoped = filterByCompany(recent, companyId);
  const slow = scoped
    .filter(r => r.durationMs >= thresholdMs)
    .slice(-200) // look at a subset
    .reverse()
    .slice(0, limit);
  return slow;
};
