// models/AssistantMessage.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const AssistantMessageSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Store one Q/A pair per document
    question:  { type: String, required: true, trim: true },
    answer:    { type: String, required: true, trim: true },

    // Optional metadata for future use
    mode:      { type: String, enum: ['qa', 'action'], default: 'qa' },
    action:    { type: String, default: null }, // e.g. create_post, search_groups
    tags:      [{ type: String, trim: true }],
  },
  { timestamps: true }
);

// Helpful compound index: quickly get recent history per user/company
AssistantMessageSchema.index({ companyId: 1, userId: 1, createdAt: -1 });

module.exports = mongoose.model('AssistantMessage', AssistantMessageSchema);
