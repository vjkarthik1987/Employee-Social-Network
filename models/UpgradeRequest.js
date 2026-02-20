// models/UpgradeRequest.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const UpgradeRequestSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },

  requestedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByName: { type: String, required: true, trim: true },
  requestedByEmail: { type: String, required: true, trim: true, lowercase: true },

  // snapshot at request time
  currentPlanState: { type: String, default: null },
  currentSeats: { type: Number, default: 0 },
  currentUsedSeats: { type: Number, default: 0 },
  currentValidTill: { type: Date, default: null },
  currentTrialEndsAt: { type: Date, default: null },

  // request
  upgradeType: { type: String, enum: ['SEATS','VALIDITY','BOTH','MOVE_TO_PAID'], required: true },
  seatsRequested: { type: Number, default: null },
  validTillRequested: { type: Date, default: null },

  expectedCost: { type: Number, default: null },
  currency: { type: String, default: 'INR', trim: true },

  urgency: { type: String, enum: ['NORMAL','URGENT'], default: 'NORMAL' },
  needBy: { type: Date, default: null },

  reason: { type: String, required: true, trim: true },

  status: { type: String, enum: ['SUBMITTED','IN_REVIEW','APPROVED','REJECTED','CANCELLED'], default: 'SUBMITTED', index: true },
  adminNotes: { type: String, default: null },
  handledByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  handledAt: { type: Date, default: null },

  source: { type: String, enum: ['SETTINGS_PAGE','BILLING_LIMIT_PAGE','API'], default: 'SETTINGS_PAGE' },
}, { timestamps: true });

UpgradeRequestSchema.index({ companyId: 1, createdAt: -1 });
UpgradeRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('UpgradeRequest', UpgradeRequestSchema);