// routes/api/reactions.js
const express = require('express');
const { ensureAuth } = require('../../middleware/auth');
const rc = require('../../controllers/reactionsController');

const router = express.Router({ mergeParams: true });

router.put('/reactions', ensureAuth, rc.toggle);   // toggle/add/update
router.delete('/reactions', ensureAuth, rc.toggle); // optional identical handler for delete body

module.exports = router;
