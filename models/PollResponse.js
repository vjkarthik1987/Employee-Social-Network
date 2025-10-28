// /models/PollResponse.js
const mongoose = require('mongoose');

const AnswerSchema = new mongoose.Schema({
  qid: { type: String, required: true }, // question id (string key stored on Post.poll.questions)
  oid: { type: String, required: true }, // option id
}, { _id: false });

const PollResponseSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  postId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  answers:   { type: [AnswerSchema], required: true }, // one per question
}, { timestamps: true });

PollResponseSchema.index({ companyId: 1, postId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('PollResponse', PollResponseSchema);
