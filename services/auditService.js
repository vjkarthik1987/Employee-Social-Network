// services/auditService.js
const AuditLog = require('../models/AuditLog');

exports.record = async ({
  companyId,
  actorUserId,
  action,        // 'POST_CREATED' | 'POST_APPROVED' | 'POST_REJECTED' | 'USER_ROLE_CHANGED' | 'POLICY_UPDATED'
  targetType,    // 'post' | 'user' | 'company'
  targetId,
  metadata = {},
}) => {
  try {
    await AuditLog.create({ companyId, actorUserId, action, targetType, targetId, metadata });
  } catch (err) {
    console.error('AuditLog write failed:', err?.message);
  }
};
