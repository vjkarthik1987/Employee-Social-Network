// models/PerfLog.js
const mongoose = require('mongoose');
const PerfLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true, required: false },
  route:     { type: String, index: true },
  durationMs:{ type: Number },
  count:     { type: Number, default: 0 },
  page:      { type: Number, default: null },
  limit:     { type: Number, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});
PerfLogSchema.index({ companyId: 1, route: 1, createdAt: -1 });
module.exports = mongoose.model('PerfLog', PerfLogSchema);
