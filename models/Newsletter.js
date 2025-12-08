// models/Newsletter.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const NewsletterSchema = new Schema({
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
  },

  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 140,
  },

  // URL-safe slug: unique per company (e.g. "hr-digest", "ceo-weekly")
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },

  description: {
    type: String,
    trim: true,
    maxlength: 4000,
  },

  coverImageUrl: {
    type: String,
    trim: true,
    default: null,
  },

  // Ownership / roles
  ownerId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  editors: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],

  publishers: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
  }],

  // Frequency settings
  frequency: {
    type: String,
    enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'ADHOC'],
    default: 'ADHOC',
  },

  // If WEEKLY, which day (0 = Sunday, 6 = Saturday)
  dayOfWeek: {
    type: Number,
    min: 0,
    max: 6,
    default: null,
  },

  // If MONTHLY, which day (1–31)
  dayOfMonth: {
    type: Number,
    min: 1,
    max: 31,
    default: null,
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  subscribersCount: {
    type: Number,
    default: 0,
  },

  lastPublishedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Unique per company
NewsletterSchema.index({ companyId: 1, slug: 1 }, { unique: true });

// Quick lookup by company + active
NewsletterSchema.index({ companyId: 1, isActive: 1 });

module.exports = mongoose.model('Newsletter', NewsletterSchema);
