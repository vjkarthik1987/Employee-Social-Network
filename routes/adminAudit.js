// routes/adminAudit.js
const express = require('express');
const { ensureAuth, requireRole } = require('../middleware/auth');
const AuditLog = require('../models/AuditLog');

const router = express.Router({ mergeParams: true });

router.get('/', ensureAuth, requireRole('ORG_ADMIN'), async (req, res, next) => {
  try {
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      AuditLog.find({ companyId: req.companyId })
        .populate('actorUserId', 'fullName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AuditLog.countDocuments({ companyId: req.companyId }),
    ]);

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);

    res.render('admin/audit', {
      company: req.company,
      user: req.user,
      rows,
      page,
      totalPages,
    });
  } catch (e) { next(e); }
});

module.exports = router;
