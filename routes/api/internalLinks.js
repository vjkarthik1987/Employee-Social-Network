// /routes/api/internalLinks.js
const express = require('express');
const { ensureAuth } = require('../../middleware/auth');
const c = require('../../controllers/internalLinksController');

const router = express.Router({ mergeParams: true });

// member-visible (require auth so it's tenant-aware; relax if you want public)
router.get('/links', ensureAuth, c.listPublic);

// optional analytics
router.post('/links/:id/click', ensureAuth, c.click);

module.exports = router;
