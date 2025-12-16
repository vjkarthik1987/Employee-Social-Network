// models/Company.js
const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  kind: { type: String, enum: ['trial','cloud','perpetual','byo'], default: 'trial' },
  seats: { type: Number, default: 10 },      // set from form
}, { _id: false });

const companySchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true }, // e.g., "acme"
  name: { type: String, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
  productName: { type: String, trim: true, default: '' },
  tagline:     { type: String, trim: true, default: '' },
  locale: { type: String, default: 'en' },
  dataRegion: { type: String, enum: ['IN','EU','US'], default: 'IN' },
  branding: {
    logoUrl: String,
    coverImageUrl: String,
    theme: {
      primary: { type: String, default: '#1976d2' },
      secondary: { type: String, default: '#ffffff' }
    }
  },
  policies: {
    postingMode: { type: String, enum: ['OPEN','MODERATED'], default: 'OPEN' },
    blockedWords: [String],
    retentionDays: { type: Number, default: 730 },
    notificationsEnabled: { type: Boolean, default: true },
  },
  integrations: {
    linkedinCompanyId: String,
    enableLinkedInSync: { type: Boolean, default: false },
    lastLinkedInSyncAt: Date
  },
  planState: { type: String, enum: ['FREE_TRIAL','ACTIVE','EXPIRED'], default: 'FREE_TRIAL' },
  plan: { type: PlanSchema, default: () => ({ kind:'trial', seats:10 }) },
  trialEndsAt: { type: Date },
  license: {
    seats: { type: Number, default: 25 },
    used: { type: Number, default: 0 },
    validTill: { type: Date }
  },
  // ORG verification (single source of truth)
  verifyToken: { type: String, index: true, default: null },
  verifyExpiresAt: { type: Date, default: null },
  verifiedAt: { type: Date, default: null },
  // Gamification / Points
  // models/Company.js  (add inside companySchema)
  gamification: {
    enabled: { type: Boolean, default: true },
    rules: {
      postCreated: { type: Number, default: 5 },
      commentCreated: { type: Number, default: 2 },
      replyCreated: { type: Number, default: 1 },

      // optional: when others engage with your content
      commentReceived: { type: Number, default: 1 },
      replyReceived: { type: Number, default: 1 },

      // per reaction type
      reactionsGiven: {
        LIKE: { type: Number, default: 1 },
        HEART: { type: Number, default: 1 },
        CELEBRATE: { type: Number, default: 1 },
        SUPPORT: { type: Number, default: 1 },
        LAUGH: { type: Number, default: 1 },
        INSIGHTFUL: { type: Number, default: 1 },
        THANKS: { type: Number, default: 1 },
      },
      reactionsReceived: {
        LIKE: { type: Number, default: 1 },
        HEART: { type: Number, default: 1 },
        CELEBRATE: { type: Number, default: 1 },
        SUPPORT: { type: Number, default: 1 },
        LAUGH: { type: Number, default: 1 },
        INSIGHTFUL: { type: Number, default: 1 },
        THANKS: { type: Number, default: 1 },
      }
    }
  },  
  status: { type: String, enum: ['active','suspended'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
