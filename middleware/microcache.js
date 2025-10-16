// middleware/microcache.js
// Tiny read-through cache helpers (route-local). Works with memory or Redis.

const store = require('../services/cacheStore');
const perf  = require('../services/perfService');

function key(namespace, parts) {
  return `${namespace}:${store.hash(parts)}`;
}

async function getOrSet({ k, ttlSec, fetcher }) {
  const cached = await store.get(k);
  if (cached) {
    perf.cacheEvent({ type: 'hit', key: k });
    return { fromCache: true, value: cached };
  }
  const value = await fetcher();
  await store.set(k, value, ttlSec);
  perf.cacheEvent({ type: 'miss', key: k });
  return { fromCache: false, value };
}

// Invalidate helpers (tenant-aware)
async function bustTenant(slug) {
  const prefix = `feed:v1:${slug}:`;
  const n = await store.delPrefix(prefix);
  perf.cacheEvent({ type: 'bust', key: `${prefix}*`, count: n });
  return n;
}
async function bustGroup(slug, groupId) {
  const base = `groupfeed:v1:${slug}:${groupId}:`;
  const n = await store.delPrefix(base);
  perf.cacheEvent({ type: 'bust', key: `${base}*`, count: n });
  return n;
}
async function bustPost(slug, postId) {
  const k = `post:v1:${slug}:${postId}`;
  await store.del(k);
  perf.cacheEvent({ type: 'bust', key: k, count: 1 });
}

module.exports = { key, getOrSet, bustTenant, bustGroup, bustPost };
