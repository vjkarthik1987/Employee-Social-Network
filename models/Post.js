// models/Post.js
const mongoose = require('mongoose');

const ReactionCountSchema = new mongoose.Schema(
  {
    LIKE: { type: Number, default: 0 },
    HEART: { type: Number, default: 0 },
    CELEBRATE: { type: Number, default: 0 },
    SUPPORT: { type: Number, default: 0 },
    LAUGH: { type: Number, default: 0 },
    INSIGHTFUL: { type: Number, default: 0 },
    THANKS: { type: Number, default: 0 },
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },

    type: { type: String, enum: ['TEXT', 'LINK', 'IMAGE'], default: 'TEXT', required: true },
    status: {
      type: String,
      enum: ['DRAFT', 'QUEUED', 'APPROVED', 'PUBLISHED', 'REJECTED'],
      default: 'PUBLISHED',
      index: true,
    },
    visibility: { type: String, enum: ['COMPANY', 'GROUP'], default: 'COMPANY' },

    // main content
    richText: { type: String, default: '' }, // sanitized HTML
    linkPreview: {
      url: String,
      title: String,
      description: String,
      imageUrl: String,
      fetchedAt: Date,
    },

    // counters
    commentsCount: { type: Number, default: 0 },
    reactionsCountByType: { type: ReactionCountSchema, default: () => ({}) },
    viewsCount: { type: Number, default: 0 },

    // embedded moderation metadata
    approvalNeeded: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['na', 'pending', 'approved', 'rejected'],
      default: 'na',
      index: true,
    },
    reviewerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },

    // scheduling / deletion
    scheduledAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    attachmentsCount: { type: Number, default: 0 },
    coverImageUrl: { type: String, default: null },
  },
  { timestamps: true }
);

PostSchema.virtual('attachments', {
  ref: 'Attachment',
  localField: '_id',
  foreignField: 'targetId',
  justOne: false,
  options: { match: { targetType: 'post' }, sort: { createdAt: 1 } },
});

PostSchema.index({ companyId: 1, createdAt: -1 });
PostSchema.index({ companyId: 1, status: 1, type: 1, groupId: 1, createdAt: -1 });
PostSchema.index({ richText: 'text' }); // enables $text search + score
PostSchema.index({ companyId: 1, authorId: 1, createdAt: -1 }); // profile feed
PostSchema.index({ groupId: 1, companyId: 1, createdAt: -1 });  // group feed

module.exports = mongoose.model('Post', PostSchema);
