// models/PointEvent.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const PointEventSchema = new Schema({
  companyId: { type: Schema.Types.ObjectId, required: true, index: true },
  userId:    { type: Schema.Types.ObjectId, required: true, index: true }, // who earned/lost points

  action:    { type: String, required: true, index: true }, // e.g. REACTION_GIVEN_ADD
  points:    { type: Number, required: true },              // can be negative
  eventKey:  { type: String, required: true },              // idempotency key (unique)

  actorUserId: { type: Schema.Types.ObjectId, default: null }, // who triggered it (optional)
  targetType:  { type: String, default: null },                // post/comment
  targetId:    { type: Schema.Types.ObjectId, default: null },

  meta: {
    reactionType: { type: String, default: null }, // LIKE/HEART/...
    postId:       { type: Schema.Types.ObjectId, default: null },
    commentId:    { type: Schema.Types.ObjectId, default: null },
    parentCommentId: { type: Schema.Types.ObjectId, default: null },
    direction:    { type: String, default: null }, // GIVEN / RECEIVED
  }
}, { timestamps: true });

PointEventSchema.index({ companyId: 1, userId: 1, eventKey: 1 }, { unique: true });
PointEventSchema.index({ companyId: 1, actorUserId: 1, createdAt: -1 });
PointEventSchema.index({ companyId: 1, createdAt: -1 });
PointEventSchema.index({ companyId: 1, eventKey: 1 }, { unique: true });

module.exports = mongoose.model('PointEvent', PointEventSchema);
