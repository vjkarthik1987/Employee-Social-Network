// /models/Group.js
const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  companyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: true },
  name:       { type: String, required: true, trim: true },
  description:{ type: String, trim: true },
  isPrivate:  { type: Boolean, default: false },
  membershipPolicy: { type: String, enum: ['open', 'by-approval'], default: 'open' },

  owners:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  moderators: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  members:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  coverImageUrl: String,
  membersCount: { type: Number, default: 0 },
  postsCount:   { type: Number, default: 0 },

  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // 👈
}, { timestamps: true });

groupSchema.index({ companyId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Group', groupSchema);
