// routes/savedSearches.js
const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const SavedSearch = require('../models/SavedSearch');

const router = express.Router({ mergeParams: true });

router.get('/', ensureAuth, async (req, res, next) => {
  try {
    const scope = (req.query.scope || 'COMPANY').toUpperCase();
    const groupId = scope === 'GROUP' ? (req.query.groupId || null) : null;
    const items = await SavedSearch.find({
      companyId: req.companyId, userId: req.user._id, scope, groupId: groupId || null
    })
      .sort({ pinned: -1, updatedAt: -1 })
      .lean();
    res.json({ ok: true, items });
  } catch (e) { next(e); }
});

router.post('/', ensureAuth, async (req, res, next) => {
  try {
    const {
      name, q = '', type = '', scope = 'COMPANY', groupId = null, pinned = false,
      authorId = null, people = '', fromDate = null, toDate = null, myGroups = false,
    } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ ok: false, error: 'NAME_REQUIRED' });

    const doc = await SavedSearch.findOneAndUpdate(
      {
        companyId: req.companyId,
        userId: req.user._id,
        scope: scope.toUpperCase(),
        groupId: scope.toUpperCase() === 'GROUP' ? (groupId || null) : null,
        name: name.trim(),
      },
      {
        q, type, pinned: !!pinned,
        authorId: authorId || null,
        people: (people || ''),
        fromDate: fromDate ? new Date(fromDate) : null,
        toDate: toDate ? new Date(toDate) : null,
        myGroups: !!myGroups,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ ok: true, item: doc });
  } catch (e) { next(e); }
});

router.post('/:id/pin', ensureAuth, async (req, res, next) => {
  try {
    const s = await SavedSearch.findOne({ _id: req.params.id, companyId: req.companyId, userId: req.user._id });
    if (!s) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
    s.pinned = !s.pinned;
    await s.save();
    res.json({ ok: true, pinned: s.pinned });
  } catch (e) { next(e); }
});

router.delete('/:id', ensureAuth, async (req, res, next) => {
  try {
    await SavedSearch.deleteOne({ _id: req.params.id, companyId: req.companyId, userId: req.user._id });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
