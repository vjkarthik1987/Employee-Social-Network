// /models/InternalLink.js
const mongoose = require('mongoose');

const ICONS = [
  'HR', 'TRAVEL', 'EXPENSES', 'HELPDESK', 'POLICIES',
  'PAYSLIP', 'LEARNING', 'BENEFITS', 'APPROVALS', 'TIMESHEET'
];

function isHttps(v) {
  try { const u = new URL(v); return u.protocol === 'https:'; } catch { return false; }
}

const InternalLinkSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },

  title: { type: String, required: true, trim: true, maxlength: 80 },
  url:   { type: String, required: true, validate: [isHttps, 'URL must be https://'] },

  // Icon strategy: enum + optional custom SVG
  icon: { type: String, trim: true, uppercase: true, enum: ICONS, default: 'POLICIES' },
  customIconUrl: { type: String, default: null }, // optional trusted svg

  category: { type: String, trim: true, maxlength: 40, default: '' },

  order: { type: Number, default: 0 },           // sort in sidebar
  isActive: { type: Boolean, default: true },
  visibility: { type: String, enum: ['ALL','MEMBER','MODERATOR','ORG_ADMIN'], default: 'ALL' },

  clicks: { type: Number, default: 0 },          // optional lightweight analytics

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

InternalLinkSchema.index({ companyId: 1, isActive: 1, order: 1 });
InternalLinkSchema.index({ companyId: 1, category: 1, order: 1 });

module.exports = mongoose.model('InternalLink', InternalLinkSchema);
module.exports.ICONS = ICONS;
