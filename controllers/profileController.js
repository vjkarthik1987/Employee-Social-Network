// controllers/profileController.js
const sanitizeHtml = require('sanitize-html');
const { Types } = require('mongoose');
const User = require('../models/User');
const Post = require('../models/Post');
const Group = require('../models/Group');
const Attachment = require('../models/Attachment');

function cid(req) { return req.companyId || req.company?._id; }
function isSameUser(a, b) { return String(a) === String(b); }

async function attachFirstImages(posts, companyId) {
  if (!posts?.length) return posts;
  const ids = posts.map(p => p._id);
  const rows = await Attachment.aggregate([
    { $match: { companyId, targetType: 'post', targetId: { $in: ids } } },
    { $group: { _id: '$targetId', url: { $first: '$storageUrl' } } },
  ]);
  const map = new Map(rows.map(r => [String(r._id), r.url]));
  posts.forEach(p => (p.firstAttachmentUrl = map.get(String(p._id))));
  return posts;
}

async function attachGroupStubs(posts, companyId) {
  const groupIds = Array.from(new Set(
    posts
      .map(p => p.groupId)
      .filter(id => id && Types.ObjectId.isValid(id))
      .map(id => String(id))
  ));
  if (!groupIds.length) return posts;
  const groups = await Group.find({ companyId, _id: { $in: groupIds } })
    .select('_id name')
    .lean();
  const byId = new Map(groups.map(g => [String(g._id), g]));
  posts.forEach(p => {
    if (p.groupId && Types.ObjectId.isValid(p.groupId)) {
      p.group = byId.get(String(p.groupId));
    }
  });
  return posts;
}

// ---------- READ ----------
exports.show = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { userId } = req.params;

    const profileUser = await User.findOne({ _id: userId, companyId })
      .select('fullName title department linkedinUrl avatarUrl bio skills interests postsCount commentsCount reactionsGivenCount createdAt lastLoginAt role status')
      .lean();
    if (!profileUser) return res.status(404).render('errors/404');

    // latest posts by this user
    let posts = await Post.find({
      companyId,
      authorId: profileUser._id,
      status: 'PUBLISHED',
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('authorId', 'fullName title avatarUrl')
      .lean();

    posts = await attachFirstImages(posts, companyId);
    posts = await attachGroupStubs(posts, companyId);

    // groups the user belongs to
    const groups = await Group.find({
      companyId,
      $or: [
        { members: profileUser._id },
        { owners: profileUser._id },
        { moderators: profileUser._id },
      ],
    }).select('_id name isPrivate').lean();

    const canEdit = isSameUser(req.user._id, profileUser._id) || ['ORG_ADMIN'].includes(req.user.role);

    return res.render('profile/show', {
      company: req.company,
      user: req.user,
      profileUser,
      posts,
      groups,
      canEdit,
    });
  } catch (e) { next(e); }
};

// ---------- EDIT (SELF & ADMIN) ----------
exports.editForm = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const userId = req.params.userId || req.user._id; // admin route may pass :userId
    const profileUser = await User.findOne({ _id: userId, companyId }).lean();
    if (!profileUser) return res.status(404).render('errors/404');

    const isSelf = isSameUser(req.user._id, profileUser._id);
    const isAdmin = req.user.role === 'ORG_ADMIN';
    if (!(isSelf || isAdmin)) return res.status(403).render('errors/403');

    return res.render('profile/edit', {
      company: req.company,
      user: req.user,
      profileUser,
      isAdmin,
    });
  } catch (e) { next(e); }
};

function cleanText(s, max = 2000) {
  const t = (s || '').toString();
  const trimmed = t.slice(0, max);
  // keep plain text; if you later allow rich text, sanitizeHtml here
  return sanitizeHtml(trimmed, { allowedTags: [], allowedAttributes: {} });
}

function toArrayCSV(s) {
  if (!s) return [];
  return s.split(',').map(x => x.trim()).filter(Boolean).slice(0, 50);
}

exports.update = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const targetUserId = req.params.userId || req.user._id; // admin path may edit others

    const profileUser = await User.findOne({ _id: targetUserId, companyId });
    if (!profileUser) return res.status(404).render('errors/404');

    const isSelf = isSameUser(req.user._id, profileUser._id);
    const isAdmin = req.user.role === 'ORG_ADMIN';
    if (!(isSelf || isAdmin)) return res.status(403).render('errors/403');

    // Whitelist (self)
    profileUser.title = cleanText(req.body.title, 120);
    profileUser.department = cleanText(req.body.department, 120);
    profileUser.linkedinUrl = (req.body.linkedinUrl || '').trim();
    profileUser.avatarUrl = (req.body.avatarUrl || '').trim();
    profileUser.bio = cleanText(req.body.bio, 2000);
    profileUser.skills = toArrayCSV(req.body.skillsCSV);
    profileUser.interests = toArrayCSV(req.body.interestsCSV);

    // Extra admin-only fields
    if (isAdmin) {
      if (req.body.role && ['ORG_ADMIN','MODERATOR','MEMBER'].includes(req.body.role)) {
        profileUser.role = req.body.role;
      }
      if (req.body.status && ['active','invited','suspended'].includes(req.body.status)) {
        profileUser.status = req.body.status;
      }
    }

    await profileUser.save();
    req.flash('success', 'Profile updated.');
    const backTo = isAdmin && !isSelf
      ? `/${req.company.slug}/profile/${profileUser._id}`
      : `/${req.company.slug}/profile/${req.user._id}`;
    return res.redirect(backTo);
  } catch (e) { next(e); }
};
