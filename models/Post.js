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

// ---- Poll subdocument pieces ----
const PollOptionSchema = new mongoose.Schema(
  {
    oid:        { type: String, required: true },                 // option id
    label:      { type: String, required: true, trim: true, maxlength: 60 },
    votesCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const PollQuestionSchema = new mongoose.Schema(
  {
    qid:        { type: String, required: true },                 // question id
    text:       { type: String, required: true, trim: true, maxlength: 200 },
    options:    { type: [PollOptionSchema], validate: v => Array.isArray(v) && v.length >= 2 && v.length <= 10 },
    multiSelect:{ type: Boolean, default: false },
  },
  { _id: false }
);

const PollSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, maxlength: 120, default: '' },
    questions: { type: [PollQuestionSchema], validate: v => Array.isArray(v) && v.length >= 1 && v.length <= 10 },
    totalParticipants: { type: Number, default: 0 },
    voterIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    isClosed: { type: Boolean, default: false },
    closesAt: { type: Date, default: null },
  },
  { _id: false }
);

const PostSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    authorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    groupId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },

    type: { type: String, enum: ['TEXT','LINK','IMAGE','POLL','ANNOUNCEMENT'], default: 'TEXT', required: true },
    status: {
      type: String,
      enum: ['DRAFT','QUEUED','APPROVED','PUBLISHED','REJECTED'],
      default: 'PUBLISHED',
      index: true,
    },
    visibility: { type: String, enum: ['COMPANY','GROUP'], default: 'COMPANY' },

    // main content
    richText: { type: String, default: '' }, // sanitized HTML
    linkPreview: {
      url: String,
      title: String,
      description: String,
      imageUrl: String,
      fetchedAt: Date,
    },

    // Day 31: announcements + polls
    isPinned: { type: Boolean, default: false },   // announcements can be pinned
    poll: { type: PollSchema, default: undefined }, // only present when type === 'POLL'

    // counters
    commentsCount: { type: Number, default: 0 },
    reactionsCountByType: { type: ReactionCountSchema, default: () => ({}) },
    viewsCount: { type: Number, default: 0 },

    // embedded moderation metadata
    approvalNeeded: { type: Boolean, default: false },
    approvalStatus: {
      type: String,
      enum: ['na','pending','approved','rejected'],
      default: 'na',
      index: true,
    },
    reviewerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:     { type: Date, default: null },

    // scheduling / deletion
    scheduledAt:    { type: Date, default: null },
    publishedAt:    { type: Date, default: null },
    deletedAt:      { type: Date, default: null },
    deletedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    attachmentsCount: { type: Number, default: 0 },
    coverImageUrl:    { type: String, default: null },

    //for announcement
    title: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null
    },
  
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
  },
  { timestamps: true }
);

// Guardrails: poll presence for POLL type; no poll for non-POLL types
PostSchema.pre('validate', function () {
  if (this.type === 'POLL') {
    // Be forgiving here; the controller enforces correctness & normalization.
    if (!this.poll) return; // allow create; controller should supply poll
    const qs = this.poll.questions;
    const count = Array.isArray(qs)
      ? qs.length
      : (qs && typeof qs === 'object' ? Object.keys(qs).length : 0);
    if (count < 1) this.invalidate('poll.questions', 'POLL must include at least one question');
  } else {
    // Strip accidental poll payload on non-POLL posts
    if (this.poll && Object.keys(this.poll.toObject ? this.poll.toObject() : this.poll).length > 0) {
      this.poll = undefined;
    }
  }
});

PostSchema.virtual('attachments', {
  ref: 'Attachment',
  localField: '_id',
  foreignField: 'targetId',
  justOne: false,
  options: { match: { targetType: 'post' }, sort: { createdAt: 1 } },
});

// Pin-first for feeds
PostSchema.index({ companyId: 1, isPinned: -1, createdAt: -1 });
PostSchema.index({ companyId: 1, status: 1, type: 1, groupId: 1, createdAt: -1 });
PostSchema.index({ richText: 'text' });
PostSchema.index({ companyId: 1, authorId: 1, createdAt: -1 });
PostSchema.index({ groupId: 1, companyId: 1, createdAt: -1 });

module.exports = mongoose.model('Post', PostSchema);
