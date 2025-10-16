// models/Reaction.js
const mongoose = require('mongoose');

const ReactionSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetType: { type: String, enum: ['post', 'comment'], required: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  reactionType: {
    type: String,
    enum: ['LIKE','HEART','CELEBRATE','SUPPORT','LAUGH','INSIGHTFUL','THANKS'],
    required: true,
  },
  createdAt: { type: Date, default: Date.now },
});

ReactionSchema.index({ userId: 1, targetType: 1, targetId: 1 }, { unique: true });
ReactionSchema.index({ companyId: 1, targetType: 1, targetId: 1 }); // analytics & cleanup

module.exports = mongoose.model('Reaction', ReactionSchema);
