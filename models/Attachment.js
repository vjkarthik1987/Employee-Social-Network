const mongoose = require('mongoose');
const AttachmentSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
  ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetType: { type: String, enum: ['post', 'comment'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  storageUrl: { type: String, required: true },
  mimeType: String,
  sizeBytes: Number,
  width: Number,
  height: Number,
  createdAt: { type: Date, default: Date.now },
});

AttachmentSchema.index({ companyId: 1, targetType: 1, targetId: 1 }); // feed preload

module.exports = mongoose.model('Attachment', AttachmentSchema);
