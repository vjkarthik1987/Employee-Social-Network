// services/etag.js
const crypto = require('crypto');

// Build a stable SHA-1 fingerprint from any JSON-serializable payload
function fingerprint(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

// Set ETag header and tell caller if we should return 304
function setAndCheck(req, res, payload) {
  const tag = fingerprint(payload);
  res.set('ETag', tag);
  return req.headers['if-none-match'] === tag;
}

// Optional: set Last-Modified from a Date and tell caller if 304 applies
function setLastModifiedAndCheck(req, res, date) {
  if (!date) return false;
  const lm = new Date(date);
  res.set('Last-Modified', lm.toUTCString());
  const ims = req.headers['if-modified-since'];
  return ims && new Date(ims) >= lm;
}

module.exports = { fingerprint, setAndCheck, setLastModifiedAndCheck };
