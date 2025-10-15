// models/Report.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const reportSchema = new Schema({
  companyId:        { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  targetType:       { type: String, enum: ['post', 'comment'], required: true },
  targetId:         { type: Schema.Types.ObjectId, required: true },
  reporterUserId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reasonCode:       { type: String, enum: ['INAPPROPRIATE', 'SPAM', 'HARASSMENT', 'OTHER'], required: true },
  notes:            { type: String, default: '' },

  status:           { type: String, enum: ['open', 'in-review', 'resolved'], default: 'open', index: true },
  handledBy:        { type: Schema.Types.ObjectId, ref: 'User' },
  handledAt:        { type: Date },

  createdAt:        { type: Date, default: Date.now }
});

// Helpful indexes for queue + grouping
reportSchema.index({ companyId: 1, status: 1, createdAt: -1 });
reportSchema.index({ companyId: 1, targetType: 1, targetId: 1 });

module.exports = mongoose.model('Report', reportSchema);
