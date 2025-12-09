// models/NewsletterEdition.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const NewsletterEditionItemSchema = new Schema({
  kind: {
    type: String,
    enum: ['POST', 'EXTERNAL', 'NOTE'],
    required: true,
  },

  // Common display title inside the edition section
  title: {
    type: String,
    trim: true,
    maxlength: 200,
  },

  // Order of the item in the edition
  position: {
    type: Number,
    default: 0,
  },

  // POST-type fields
  postId: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    default: null,
  },

  // Optional "Why this matters" text
  highlight: {
    type: String,
    trim: true,
    maxlength: 1000,
  },

  // EXTERNAL-type fields
  url: {
    type: String,
    trim: true,
  },

  source: {
    type: String,
    trim: true,
    maxlength: 140,
  },

  summaryHtml: {
    type: String, // rich HTML (from AI or editor)
  },

  imageUrl: {
    type: String,
    trim: true,
  },

  // NOTE-type fields (free editorial text)
  bodyHtml: {
    type: String, // rich HTML block (intro, editor's note, etc.)
  },
}, {
  _id: true,
  timestamps: false, // no per-item timestamps needed
});

const NewsletterEditionSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  },

  newsletterId: {
    type: Schema.Types.ObjectId,
    ref: 'Newsletter',
    required: true,
    index: true,
  },

  // Sequential issue number within this newsletter (1,2,3...)
  number: {
    type: Number,
    required: true,
  },

  title: {
    type: String,
    trim: true,
    maxlength: 200,
  },

  subtitle: {
    type: String,
    trim: true,
    maxlength: 400,
  },

  coverImageUrl: {
    type: String,
    trim: true,
    default: null,
  },

  // Rich "from the editor" block (HTML)
  editorNoteHtml: {
    type: String,
    default: '',
  },

  // Optional visual + text used in email subject / preview
  coverImageUrl: {
    type: String,
    trim: true,
    default: null,
  },

  summaryText: {
    type: String,
    trim: true,
    maxlength: 280,
    default: '',
  },

  // AI generation metadata (we'll use this later)
  aiTopic: {
    type: String,
    trim: true,
    default: '',
  },

  aiSourceType: {
    type: String,
    enum: ['INTERNAL', 'EXTERNAL', 'MIXED', null],
    default: null,
  },

  aiFrom: {
    type: Date,
    default: null,
  },

  aiTo: {
    type: Date,
    default: null,
  },

  status: {
    type: String,
    enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
    default: 'DRAFT',
    index: true,
  },

  generatedByAi: {
    type: Boolean,
    default: false,
  },

  publishedAt: {
    type: Date,
    default: null,
  },

  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  lastEditedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  items: [NewsletterEditionItemSchema],
}, {
  timestamps: true,
});

// Unique numbering per newsletter
NewsletterEditionSchema.index(
  { companyId: 1, newsletterId: 1, number: 1 },
  { unique: true }
);

// Quick lookup by status + recency
NewsletterEditionSchema.index(
  { companyId: 1, newsletterId: 1, status: 1, publishedAt: -1 }
);

module.exports = mongoose.model('NewsletterEdition', NewsletterEditionSchema);
