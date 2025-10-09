// models/Company.js
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  slug: { type: String, unique: true, required: true }, // e.g., "acme"
  name: { type: String, required: true },
  timezone: { type: String, default: 'Asia/Kolkata' },
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
    retentionDays: { type: Number, default: 730 }
  },
  integrations: {
    linkedinCompanyId: String,
    enableLinkedInSync: { type: Boolean, default: false },
    lastLinkedInSyncAt: Date
  },
  status: { type: String, enum: ['active','suspended'], default: 'active' },
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
