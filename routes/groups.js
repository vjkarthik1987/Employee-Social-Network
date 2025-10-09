// /routes/groups.js
const express = require('express');
const { ensureAuth } = require('../middleware/auth');
const { loadGroup, requireGroupMemberIfPrivate, requireGroupOwnerOrMod } = require('../middleware/group');
const Group = require('../models/Group');

const router = express.Router({ mergeParams: true });

// List
router.get('/', ensureAuth, async (req, res, next) => {
  try {
    const groups = await Group.find({ companyId: req.companyId }).sort({ createdAt: -1 }).limit(100).lean();
    res.render('groups/index', { company: req.company, groups });
  } catch (e) { next(e); }
});

// New form
router.get('/new', ensureAuth, (req, res) => {
  res.render('groups/new', { company: req.company });
});

// Create (ANY authenticated user)
router.post('/', ensureAuth, async (req, res, next) => {
  try {
    const { name, description, isPrivate, membershipPolicy } = req.body;
    const g = await Group.create({
      companyId: req.companyId,
      name: name.trim(),
      description,
      isPrivate: !!isPrivate,
      membershipPolicy: membershipPolicy || 'open',
      owners: [req.user._id],
      members: [req.user._id],
      membersCount: 1,
      createdBy: req.user._id, // 👈
    });
    res.redirect(`/${req.params.org}/groups/${g._id}`);
  } catch (e) { next(e); }
});

// Show (guard private)
router.get('/:groupId', ensureAuth, loadGroup, requireGroupMemberIfPrivate, async (req, res) => {
  res.render('groups/show', { company: req.company, group: req.group, posts: [], user: req.user, });
});

// Edit + Update (owners/mods only)
router.get('/:groupId/edit', ensureAuth, loadGroup, requireGroupOwnerOrMod, (req, res) => {
  res.render('groups/edit', { company: req.company, group: req.group });
});
router.post('/:groupId', ensureAuth, loadGroup, requireGroupOwnerOrMod, async (req, res, next) => {
  try {
    const { name, description, isPrivate, membershipPolicy } = req.body;
    Object.assign(req.group, {
      name: name?.trim() || req.group.name,
      description,
      isPrivate: !!isPrivate,
      membershipPolicy: membershipPolicy || req.group.membershipPolicy,
    });
    await req.group.save();
    res.redirect(`/${req.params.org}/groups/${req.group._id}`);
  } catch (e) { next(e); }
});

// Join (open, non-private)
router.post('/:groupId/join', ensureAuth, loadGroup, async (req, res, next) => {
  try {
    const g = req.group;
    const uid = String(req.user._id);

    if ([...g.members, ...g.owners, ...g.moderators].some(id => String(id) === uid)) {
      req.flash('success', 'Already a member.');
      return res.redirect(`/${req.params.org}/groups/${g._id}`);
    }

    if (!g.isPrivate && g.membershipPolicy === 'open') {
      g.members.push(req.user._id);
      g.membersCount = g.members.length;
      await g.save();
      req.flash('success', 'Joined group.');
      return res.redirect(`/${req.params.org}/groups/${g._id}`);
    }

    req.flash('error', 'This group requires approval to join.');
    res.redirect(`/${req.params.org}/groups/${g._id}`);
  } catch (e) { next(e); }
});

// Leave (block last owner)
router.post('/:groupId/leave', ensureAuth, loadGroup, async (req, res, next) => {
  try {
    const g = req.group;
    const uid = String(req.user._id);

    const isOwner = g.owners.some(id => String(id) === uid);
    if (isOwner && g.owners.length === 1) {
      req.flash('error', 'You are the only owner. Transfer ownership before leaving.');
      return res.redirect(`/${req.params.org}/groups/${g._id}`);
    }

    g.members = g.members.filter(id => String(id) !== uid);
    g.moderators = g.moderators.filter(id => String(id) !== uid);
    g.owners = g.owners.filter(id => String(id) !== uid);
    g.membersCount = g.members.length;
    await g.save();

    req.flash('success', 'Left group.');
    res.redirect(`/${req.params.org}/groups`);
  } catch (e) { next(e); }
});

module.exports = router;
