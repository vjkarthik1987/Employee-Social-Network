// middleware/errorHandler.js
const perf = require('../services/perfService');

module.exports = function errorHandler(err, req, res, next) {
  console.error('[ERR]', err.stack || err);

  perf.record({
    companyId: req.companyId || null,
    route: req.originalUrl,
    durationMs: 0,
    count: 0
  });

  const status = err.status || 500;
  const msg = err.message || 'Internal Server Error';

  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.status(status).json({ ok: false, error: msg });
  }

  if (status === 404) return res.status(404).render('errors/404');
  if (status === 403) return res.status(403).render('errors/403');
  return res.status(500).render('errors/500', { message: msg });
};
