// models/AuditLog.js
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  companyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action:      { type: String, required: true, index: true }, // e.g., 'POLICY_UPDATED'
  targetType:  { type: String, default: 'company' },          // 'company' for now
  targetId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  metadata:    { type: Object, default: {} },                  // changed fields, old/new etc.
  createdAt:   { type: Date, default: Date.now }
});

AuditLogSchema.index({ companyId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
