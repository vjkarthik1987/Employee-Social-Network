// models/EmailToken.js
const mongoose = require('mongoose');

const emailTokenSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:     { type: String, required: true },
  token:     { type: String, required: true, unique: true },
  purpose:   { type: String, enum: ['verify-company'], required: true },
  expiresAt: { type: Date, required: true },
  used:      { type: Boolean, default: false }
}, { timestamps: true });

emailTokenSchema.index({ token: 1 });

module.exports = mongoose.model('EmailToken', emailTokenSchema);
