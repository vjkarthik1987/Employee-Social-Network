// routes/api/users.js
const express = require('express');
const { ensureAuth } = require('../../middleware/auth');
const User = require('../../models/User');

const router = express.Router({ mergeParams: true });

// GET /:org/api/users?query=raj&limit=8
router.get('/users', ensureAuth, async (req, res, next) => {
  try {
    const cid = req.companyId;
    const q = (req.query.query || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit || '8', 10), 1), 25);

    if (!q) return res.json({ ok: true, items: [] });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({
      companyId: cid,
      $or: [{ fullName: rx }, { title: rx }, { email: rx }]
    })
      .select('_id fullName title avatarUrl email')
      .limit(limit)
      .lean();

    res.json({
      ok: true,
      items: users.map(u => ({
        _id: String(u._id),
        name: u.fullName,
        title: u.title || '',
        avatarUrl: u.avatarUrl || '',
        email: u.email || ''
      }))
    });
  } catch (e) { next(e); }
});

module.exports = router;
