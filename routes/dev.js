// /routes/dev.js (optional; mount only in development)
const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

router.post('/role', ensureAuth, async (req, res) => {
  const { role } = req.body; // 'MEMBER' | 'MODERATOR' | 'ORG_ADMIN'
  if (!['MEMBER','MODERATOR','ORG_ADMIN'].includes(role)) return res.status(400).send('Bad role');
  req.user.role = role;
  await req.user.save();
  req.flash('success', `Role changed to ${role}`);
  res.redirect('back');
});

module.exports = router;
