// models/AssistantDoc.js
const { Schema, model, Types } = require('mongoose');

const assistantDocSchema = new Schema(
    {
      companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  
      title: { type: String, required: true, trim: true },
      description: { type: String, trim: true },
  
      // URL is optional now
      url: { type: String, trim: true },
  
      // File-based docs (optional)
      originalName: { type: String, trim: true },
      mimeType: { type: String, trim: true },
      size: { type: Number },
      buffer: { type: Buffer }, // for now, store in Mongo; later we can move to S3/GridFS
  
      tags: [{ type: String, trim: true }],
      visibility: {
        type: String,
        enum: ['ALL', 'ADMINS', 'MODS', 'HIDDEN'],
        default: 'ALL',
      },
      isActive: { type: Boolean, default: true },
  
      createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
      updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
  );
  
  // Optional: ensure we always have at least URL or file
  assistantDocSchema.pre('validate', function (next) {
    if (!this.url && !this.buffer) {
      this.invalidate('url', 'Either url or uploaded file is required.');
    }
    next();
  });

module.exports = model('AssistantDoc', assistantDocSchema);
