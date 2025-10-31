const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MailerConfigSchema = new Schema({
  // One singleton doc (or one per env if you prefer)
  kind: { type: String, default: 'central', unique: true },
  smtpHost: String,
  smtpPort: Number,
  smtpUser: String,
  smtpPass: String,
  fromEmail: String,
  fromName: String,
  enabled: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('MailerConfig', MailerConfigSchema);
