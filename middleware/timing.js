// middleware/timing.js
const { performance } = require('perf_hooks');
const perf = require('../services/perfService');

// Tiny "on-headers" helper without installing a package
function onHeaders(res, listener) {
  if (res.__onHeadersPatched) return;
  const writeHead = res.writeHead;
  res.writeHead = function patchedWriteHead(...args) {
    try {
      if (!res.headersSent) listener.call(res);
    } catch (_) { /* ignore */ }
    return writeHead.apply(this, args);
  };
  res.__onHeadersPatched = true;
}

module.exports = function timing(req, res, next) {
  const t0 = performance.now();

  // Set Server-Timing just before headers are written
  onHeaders(res, function setServerTiming() {
    const dur = performance.now() - t0;
    // append, don't overwrite, in case something else set it
    const existing = res.getHeader('Server-Timing');
    const value = `app;dur=${dur.toFixed(1)}`;
    if (!existing) res.setHeader('Server-Timing', value);
    else res.setHeader('Server-Timing', Array.isArray(existing) ? [...existing, value] : `${existing}, ${value}`);
  });

  // Record metrics after the response is finished (safe to NOT set headers here)
  res.on('finish', () => {
    const dur = performance.now() - t0;
    perf.record({
      companyId: req.companyId || req.company?._id,
      route: req.originalUrl.split('?')[0],
      durationMs: dur,
      count: 1,
    });
  });

  next();
};
