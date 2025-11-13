// models/Comment.js
const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    postId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    authorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    parentCommentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null, index: true },
    level: { type: Number, enum: [0, 1], default: 0 }, // 0 = top-level, 1 = reply

    content: { type: String, trim: true, maxlength: 3000, required: true },
    status: { type: String, enum: ['visible', 'hidden', 'deleted'], default: 'visible', index: true },

    // light denorms
    repliesCount: { type: Number, default: 0 },
    reactionsCountByType: { type: Object, default: {} },
    editedAt: { type: Date, default: null },
    editHistory: [{ content: String, editedAt: Date }],
    attachmentsCount: { type: Number, default: 0 },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  },
  { timestamps: true }
);

CommentSchema.index({ companyId: 1, postId: 1, createdAt: -1 });
CommentSchema.index({ companyId: 1, parentCommentId: 1, createdAt: 1 });

module.exports = mongoose.model('Comment', CommentSchema);
