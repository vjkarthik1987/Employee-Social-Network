// models/NewsletterSubscription.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const NewsletterSubscriptionSchema = new Schema({
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

  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  status: {
    type: String,
    enum: ['ACTIVE', 'UNSUBSCRIBED'],
    default: 'ACTIVE',
    index: true,
  },

  unsubscribedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Each user can have at most one row per newsletter
NewsletterSubscriptionSchema.index(
  { companyId: 1, newsletterId: 1, userId: 1 },
  { unique: true }
);

module.exports = mongoose.model('NewsletterSubscription', NewsletterSubscriptionSchema);
