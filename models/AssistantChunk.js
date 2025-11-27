// models/AssistantChunk.js
const { Schema, model, Types } = require('mongoose');

const assistantChunkSchema = new Schema(
  {
    companyId: {
      type: Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    docId: {
      type: Types.ObjectId,
      ref: 'AssistantDoc',
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: ['FILE', 'URL'],
      default: 'FILE',
    },
    sourceName: {
      type: String,
      trim: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number], // GPT-3.5 embedding vector
      required: true,
    },
  },
  { timestamps: true }
);

assistantChunkSchema.index({ companyId: 1, docId: 1, chunkIndex: 1 });

module.exports = model('AssistantChunk', assistantChunkSchema);
