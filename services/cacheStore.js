// services/cacheStore.js
// Pluggable cache: in-memory (default) or Redis if REDIS_URL is set.

const crypto = require('crypto');

function hash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}
exports.hash = hash;

const REDIS_URL = process.env.REDIS_URL || '';
if (!REDIS_URL) {
  // ---- Memory LRU-ish (simple) ----
  const MAX = parseInt(process.env.CACHE_MAX_KEYS || '500', 10);
  const store = new Map(); // key -> { v, exp, seen }

  function set(k, v, ttlSec = 10) {
    const exp = Date.now() + ttlSec * 1000;
    store.set(k, { v, exp, seen: 0 });
    if (store.size > MAX) {
      // remove ~10% oldest by seen (super lightweight eviction)
      const arr = Array.from(store.entries());
      arr.sort((a,b) => (a[1].seen - b[1].seen));
      for (let i = 0; i < Math.ceil(MAX * 0.1); i++) store.delete(arr[i][0]);
    }
  }
  function get(k) {
    const e = store.get(k);
    if (!e) return null;
    if (Date.now() > e.exp) { store.delete(k); return null; }
    e.seen++;
    return e.v;
  }
  function delPrefix(prefix) {
    let n = 0;
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) { store.delete(key); n++; }
    }
    return n;
  }
  function del(k) { return store.delete(k); }
  function keysWithPrefix(prefix) {
    return Array.from(store.keys()).filter(k => k.startsWith(prefix));
  }

  module.exports = { kind: 'memory', set, get, del, delPrefix, keysWithPrefix, hash };
} else {
  // ---- Redis ----
  const { createClient } = require('redis');
  const client = createClient({ url: REDIS_URL });
  client.on('error', (e) => console.error('[redis]', e?.message));
  client.connect().catch(()=>{});

  async function set(k, v, ttlSec = 10) {
    await client.set(k, JSON.stringify(v), { EX: ttlSec });
  }
  async function get(k) {
    const s = await client.get(k);
    return s ? JSON.parse(s) : null;
  }
  async function delPrefix(prefix) {
    const iter = client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 });
    let n = 0;
    for await (const key of iter) { await client.del(key); n++; }
    return n;
  }
  async function del(k) { await client.del(k); }
  async function keysWithPrefix(prefix) {
    const arr = [];
    const iter = client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 });
    for await (const key of iter) arr.push(key);
    return arr;
  }

  module.exports = { kind: 'redis', set, get, del, delPrefix, keysWithPrefix, hash };
}
