// models/SavedSearch.js
const mongoose = require('mongoose');
const SavedSearchSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    scope:     { type: String, enum: ['COMPANY','GROUP'], default: 'COMPANY' },
    groupId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },

    name:      { type: String, required: true, trim: true, maxlength: 80 },

    q:         { type: String, default: '' },
    type:      { type: String, enum: ['', 'TEXT', 'IMAGE', 'LINK','POLL','ANNOUNCEMENT'], default: '' },
    pinned:    { type: Boolean, default: false },

    authorId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    people:    { type: String, default: '' }, // free-text people search (name/title)
    fromDate:  { type: Date, default: null },
    toDate:    { type: Date, default: null },
    myGroups:  { type: Boolean, default: false }, // company feed only
  },
  { timestamps: true }
);

SavedSearchSchema.index({ companyId: 1, userId: 1, scope: 1, groupId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SavedSearch', SavedSearchSchema);
