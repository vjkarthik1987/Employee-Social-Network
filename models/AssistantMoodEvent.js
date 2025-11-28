// models/AssistantMoodEvent.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const AssistantMoodEventSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    rawMessage: { type: String, required: true },

    mood: {
      type: String,
      enum: ['STRESSED', 'TIRED', 'FRUSTRATED', 'SAD', 'OKAY', 'CALM', 'HAPPY', 'EXCITED', 'NEUTRAL'],
      required: true,
    },
    sentimentScore: { type: Number, min: -2, max: 2, default: 0 }, // -2 very negative, +2 very positive
    flags: [{ type: String, trim: true }], // ['workload', 'manager', 'personal', ...]

  },
  { timestamps: true }
);

module.exports = mongoose.model('AssistantMoodEvent', AssistantMoodEventSchema);
