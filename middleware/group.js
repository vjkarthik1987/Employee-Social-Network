// /middleware/group.js
const Group = require('../models/Group');

exports.loadGroup = async (req, _res, next) => {
  const g = await Group.findOne({ _id: req.params.groupId, companyId: req.companyId });
  if (!g) return next({ status: 404 });
  req.group = g;
  next();
};

exports.requireGroupMemberIfPrivate = (req, res, next) => {
  const g = req.group;
  if (!g.isPrivate) return next();
  const uid = String(req.user._id);
  const isMember = g.members.some(id => String(id) === uid) ||
                   g.owners.some(id => String(id) === uid) ||
                   g.moderators.some(id => String(id) === uid);
  if (!isMember) return res.status(403).render('errors/403');
  next();
};

exports.requireGroupOwnerOrMod = (req, res, next) => {
  const uid = String(req.user._id);
  const g = req.group;
  const isOwner = g.owners.some(id => String(id) === uid);
  const isMod   = g.moderators.some(id => String(id) === uid);
  if (!isOwner && !isMod) return res.status(403).render('errors/403');
  next();
};
