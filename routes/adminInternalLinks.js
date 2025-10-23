// /routes/adminInternalLinks.js
const express = require('express');
const csrf = require('csurf');
const { ensureAuth, requireRole } = require('../middleware/auth');
const c = require('../controllers/internalLinksController');

const router = express.Router({ mergeParams: true });
const csrfProtection = csrf();

router.use(ensureAuth, requireRole('ORG_ADMIN'), csrfProtection);
router.use((req, res, next) => { res.locals.csrfToken = req.csrfToken(); next(); });
router.get('/', c.listPage);
router.get('/new', c.newPage);
router.post('/new', c.create);
router.get('/:id/edit', c.editPage);
router.post('/:id/edit', c.update);
router.post('/:id/delete', c.remove);
router.post('/reorder', c.reorder); // expects { ids: ['id1','id2',...] }

module.exports = router;
