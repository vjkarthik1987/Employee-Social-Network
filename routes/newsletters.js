// /routes/newsletters.js
const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const newslettersController = require('../controllers/newslettersController');

const router = express.Router({ mergeParams: true });

// List all newsletters in this company
router.get('/', ensureAuth, newslettersController.listNewsletters);

// Show create form
router.get('/new', ensureAuth, newslettersController.showCreateForm);

// Create newsletter
router.post('/', ensureAuth, newslettersController.createNewsletter);

// View a single newsletter + its editions
router.get('/:slug', ensureAuth, newslettersController.showNewsletter);

// Subscribe / unsubscribe
router.post('/:slug/subscribe', ensureAuth, newslettersController.subscribe);
router.post('/:slug/unsubscribe', ensureAuth, newslettersController.unsubscribe);

// New edition form
router.get('/:slug/editions/new', ensureAuth, newslettersController.showCreateEditionForm);

// Create edition (basic, manual)
router.post('/:slug/editions', ensureAuth, newslettersController.createEdition);

// View edition
router.get('/:slug/editions/:number', ensureAuth, newslettersController.showEdition);

module.exports = router;
