// services/retentionService.js
const mongoose = require('mongoose');
const Company = require('../models/Company');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Reaction = require('../models/Reaction');
const Report = require('../models/Report');
const Attachment = require('../models/Attachment');

async function purgeForCompany(companyId, { verbose = false } = {}) {
  const company = await Company.findById(companyId).lean();
  if (!company) throw new Error('Company not found');
  const days = Number(company.policies?.retentionDays || 730);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 1) Hard-delete POSTS that were soft-deleted before cutoff
  const oldPosts = await Post.find({
    companyId,
    deletedAt: { $ne: null, $lte: cutoff },
  }).select('_id').lean();
  const postIds = oldPosts.map(p => p._id);

  // Cascade delete related doc sets
  const r1 = await Promise.allSettled([
    Comment.deleteMany({ companyId, postId: { $in: postIds } }),
    Reaction.deleteMany({ companyId, targetType: 'post', targetId: { $in: postIds } }),
    Reaction.deleteMany({ companyId, targetType: 'comment', targetId: { $in: postIds } }), // safe even if too broad
    Report.deleteMany({ companyId, targetType: 'post', targetId: { $in: postIds } }),
    Attachment.deleteMany({ companyId, targetType: 'post', targetId: { $in: postIds } }),
    Post.deleteMany({ companyId, _id: { $in: postIds } }),
  ]);

  // 2) Hard-delete COMMENTS marked deleted long back (your Comment uses status='deleted')
  const r2 = await Comment.deleteMany({
    companyId,
    status: 'deleted',
    updatedAt: { $lte: cutoff },
  });

  // 3) (Optional) prune stale REPORTS that are resolved long ago
  const r3 = await Report.deleteMany({
    companyId,
    status: 'resolved',
    handledAt: { $lte: cutoff },
  });

  if (verbose) {
    console.log('[retention] company:', String(companyId));
    console.log('  posts purged:', postIds.length);
    console.log('  comments purged (deleted):', r2.deletedCount || 0);
    console.log('  reports purged (resolved):', r3.deletedCount || 0);
    console.log('  detail:', r1.map(x => x.status).join(', '));
  }

  return {
    postsPurged: postIds.length,
    commentsPurged: r2.deletedCount || 0,
    reportsPurged: r3.deletedCount || 0,
  };
}

async function purgeAllCompanies({ verbose = false } = {}) {
  const companies = await Company.find({ status: 'active' }).select('_id').lean();
  const out = [];
  for (const c of companies) {
    const r = await purgeForCompany(c._id, { verbose });
    out.push({ companyId: c._id, ...r });
  }
  return out;
}

module.exports = { purgeForCompany, purgeAllCompanies };
