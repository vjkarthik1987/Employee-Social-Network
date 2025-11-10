// /models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const ROLES = ['ORG_ADMIN', 'MODERATOR', 'MEMBER'];

const UserSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    role: { type: String, enum: ROLES, default: 'MEMBER' },
    email: { type: String, required: true, lowercase: true, trim: true },
    fullName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },

    // optional profile fields (future-proof)
    title: { type: String, trim: true },
    department: { type: String, trim: true },
    linkedinUrl: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    bio: { type: String, trim: true, maxlength: 2000 },
    skills: [{ type: String, trim: true }],
    interests: [{ type: String, trim: true }],
    isEmailVerified:{type: Boolean},
    preferences: {
      darkMode: { type: Boolean, default: null } // null = follow company default
    },

    // denorm counters
    postsCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    reactionsGivenCount: { type: Number, default: 0 },
    status: { type: String, enum: ['active','invited','suspended'], default: 'active' },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

// Unique email per company
UserSchema.index({ companyId: 1, email: 1 }, { unique: true });
UserSchema.index({ companyId: 1, role: 1 }); // admin dashboards

UserSchema.methods.setPassword = async function (plain) {
  this.password = plain;  // triggers pre-save hashing
};

// Virtual "password" setter to hash automatically
UserSchema.virtual('password')
  .set(function (plain) {
    this._password = plain;
  })
  .get(function () {
    return this._password;
  });

UserSchema.pre('validate', function () {
  if (!this.passwordHash && !this._password) {
    this.invalidate('password', 'Password is required');
  }
});

UserSchema.pre('save', async function () {
  if (this._password) {
    const saltRounds = 12;
    this.passwordHash = await bcrypt.hash(this._password, saltRounds);
  }
});

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

module.exports = mongoose.model('User', UserSchema);
