// controllers/reportsController.js
const mongoose = require('mongoose');
const Report = require('../models/Report');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const audit = require('../services/auditService');

function companyIdOf(req){ return req.companyId || req.company?._id; }
function backUrl(req, fallback){ return req.get('Referer') || fallback || `/${req.company?.slug || ''}/feed`; }

exports.create = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { targetType, targetId, reasonCode, notes = '' } = req.body;

    if (!['post','comment'].includes(targetType)) {
      req.flash('error', 'Invalid report target.');
      return res.redirect(backUrl(req));
    }
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      req.flash('error', 'Invalid target id.');
      return res.redirect(backUrl(req));
    }
    if (!['INAPPROPRIATE','SPAM','HARASSMENT','OTHER'].includes((reasonCode||'').toUpperCase())) {
      req.flash('error', 'Please choose a reason.');
      return res.redirect(backUrl(req));
    }

    // Ensure target exists under this tenant and is visible/not deleted
    if (targetType === 'post') {
      const p = await Post.findOne({ _id: targetId, companyId: cid, deletedAt: null }).select('_id').lean();
      if (!p) { req.flash('error', 'Post not found.'); return res.redirect(backUrl(req)); }
    } else {
      const c = await Comment.findOne({ _id: targetId, companyId: cid, status: { $ne: 'deleted' } }).select('_id').lean();
      if (!c) { req.flash('error', 'Comment not found.'); return res.redirect(backUrl(req)); }
    }

    const doc = await Report.create({
      companyId: cid,
      targetType,
      targetId,
      reporterUserId: req.user._id,
      reasonCode: reasonCode.toUpperCase(),
      notes: (notes || '').toString().slice(0, 500)
    });

    try {
      await audit.record({
        companyId: cid,
        actorUserId: req.user._id,
        action: 'REPORT_CREATED',
        targetType,
        targetId,
        metadata: { reasonCode: doc.reasonCode }
      });
    } catch (_) {}

    req.flash('success', 'Report submitted. Our moderators will review it.');
    return res.redirect(backUrl(req));
  } catch (e) { next(e); }
};

exports.list = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);

    const reports = await Report.find({ companyId: cid, status: 'open' })
      .sort({ createdAt: -1 })
      .populate('reporterUserId', 'fullName title avatarUrl')
      .lean();

    // Load minimal target context for table (title/snippet)
    const postIds = reports.filter(r => r.targetType === 'post').map(r => r.targetId);
    const commentIds = reports.filter(r => r.targetType === 'comment').map(r => r.targetId);

    const posts = postIds.length ? await Post.find({ _id: { $in: postIds }, companyId: cid })
      .select('_id richText type')
      .lean() : [];
    const comments = commentIds.length ? await Comment.find({ _id: { $in: commentIds }, companyId: cid })
      .select('_id content')
      .lean() : [];

    const postMap = new Map(posts.map(p => [String(p._id), p]));
    const commentMap = new Map(comments.map(c => [String(c._id), c]));

    reports.forEach(r => {
      if (r.targetType === 'post') {
        const p = postMap.get(String(r.targetId));
        r.targetPreview = p ? (p.richText || `[${p.type}]`).slice(0, 120) : '(deleted post)';
      } else {
        const c = commentMap.get(String(r.targetId));
        r.targetPreview = c ? (c.content || '').replace(/<[^>]+>/g,'').slice(0, 120) : '(deleted comment)';
      }
    });

    return res.render('mod/reports', { company: req.company, user: req.user, reports });
  } catch (e) { next(e); }
};

exports.resolve = async (req, res, next) => {
  try {
    const cid = companyIdOf(req);
    const { id } = req.params;

    const report = await Report.findOne({ _id: id, companyId: cid, status: { $ne: 'resolved' } });
    if (!report) { req.flash('error', 'Report not found or already resolved.'); return res.redirect(`/${req.company.slug}/mod/reports`); }

    report.status = 'resolved';
    report.handledBy = req.user._id;
    report.handledAt = new Date();
    await report.save();

    try {
      await audit.record({
        companyId: cid,
        actorUserId: req.user._id,
        action: 'REPORT_RESOLVED',
        targetType: report.targetType,
        targetId: report.targetId,
        metadata: { reasonCode: report.reasonCode }
      });
    } catch (_) {}

    req.flash('success', 'Report resolved.');
    return res.redirect(`/${req.company.slug}/mod/reports`);
  } catch (e) { next(e); }
};

// --- API: Create report (member) ---
exports.createApi = async (req, res, next) => {
    try {
      req.headers.accept = 'application/json';
      // Reuse same logic as create(), but JSON out
      const cid = (req.companyId || req.company?._id);
      const { targetType, targetId, reasonCode, notes = '' } = req.body;
  
      if (!['post','comment'].includes(targetType)) {
        return res.status(400).json({ ok: false, error: 'BAD_TARGET' });
      }
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(targetId)) {
        return res.status(400).json({ ok: false, error: 'BAD_ID' });
      }
      const rc = (reasonCode || '').toUpperCase();
      if (!['INAPPROPRIATE','SPAM','HARASSMENT','OTHER'].includes(rc)) {
        return res.status(400).json({ ok: false, error: 'BAD_REASON' });
      }
  
      // Validate target existence under tenant
      const Post = require('../models/Post');
      const Comment = require('../models/Comment');
      if (targetType === 'post') {
        const p = await Post.findOne({ _id: targetId, companyId: cid, deletedAt: null }).select('_id').lean();
        if (!p) return res.status(404).json({ ok: false, error: 'POST_NOT_FOUND' });
      } else {
        const c = await Comment.findOne({ _id: targetId, companyId: cid, status: { $ne: 'deleted' } }).select('_id').lean();
        if (!c) return res.status(404).json({ ok: false, error: 'COMMENT_NOT_FOUND' });
      }
  
      const Report = require('../models/Report');
      const doc = await Report.create({
        companyId: cid,
        targetType,
        targetId,
        reporterUserId: req.user._id,
        reasonCode: rc,
        notes: notes.toString().slice(0, 500),
      });
  
      try {
        const audit = require('../services/auditService');
        await audit.record({
          companyId: cid,
          actorUserId: req.user._id,
          action: 'REPORT_CREATED',
          targetType,
          targetId,
          metadata: { reasonCode: rc },
        });
      } catch (_) {}
  
      return res.json({ ok: true, id: String(doc._id) });
    } catch (e) { next(e); }
  };
  
  // --- API: List reports (moderator/admin) ---
  exports.listApi = async (req, res, next) => {
    try {
      const cid = (req.companyId || req.company?._id);
      const Report = require('../models/Report');
  
      const status = (req.query.status || 'open').toLowerCase();
      const allowed = new Set(['open','in-review','resolved','all']);
      if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'BAD_STATUS' });
  
      const q = { companyId: cid };
      if (status !== 'all') q.status = status;
  
      // simple pagination: ?page=1&limit=50
      const page  = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.max(Math.min(parseInt(req.query.limit || '50', 10), 100), 1);
      const skip  = (page - 1) * limit;
  
      const reports = await Report.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('reporterUserId', 'fullName title avatarUrl')
        .lean();
  
      return res.json({
        ok: true,
        page,
        limit,
        count: reports.length,
        items: reports.map(r => ({
          id: String(r._id),
          companyId: String(r.companyId),
          targetType: r.targetType,
          targetId: String(r.targetId),
          reporter: r.reporterUserId ? {
            id: String(r.reporterUserId._id),
            name: r.reporterUserId.fullName,
            title: r.reporterUserId.title || null,
            avatarUrl: r.reporterUserId.avatarUrl || null,
          } : null,
          reasonCode: r.reasonCode,
          notes: r.notes || '',
          status: r.status,
          handledBy: r.handledBy ? String(r.handledBy) : null,
          handledAt: r.handledAt || null,
          createdAt: r.createdAt,
        })),
      });
    } catch (e) { next(e); }
  };
  
  // --- API: Update report status (moderator/admin) ---
  exports.updateApi = async (req, res, next) => {
    try {
      const cid = (req.companyId || req.company?._id);
      const { id } = req.params;
      const { status } = req.body;
  
      if (!['open','in-review','resolved'].includes(status)) {
        return res.status(400).json({ ok: false, error: 'BAD_STATUS' });
      }
  
      const Report = require('../models/Report');
      const report = await Report.findOne({ _id: id, companyId: cid });
      if (!report) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  
      const prev = report.status;
      report.status = status;
      if (status === 'resolved') {
        report.handledBy = req.user._id;
        report.handledAt = new Date();
      }
      await report.save();
  
      try {
        const audit = require('../services/auditService');
        await audit.record({
          companyId: cid,
          actorUserId: req.user._id,
          action: status === 'resolved' ? 'REPORT_RESOLVED' : 'REPORT_STATUS_CHANGED',
          targetType: report.targetType,
          targetId: report.targetId,
          metadata: { from: prev, to: status, reasonCode: report.reasonCode },
        });
      } catch (_) {}
  
      return res.json({ ok: true, id: String(report._id), status: report.status });
    } catch (e) { next(e); }
  };
  