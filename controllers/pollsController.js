// controllers/pollsController.js
const { Types } = require('mongoose');
const Post = require('../models/Post');
const microcache = require('../middleware/microcache');
const audit = require('../services/auditService');

function cid(req){ return req.companyId || req.company?._id; }
function isId(v){ return Types.ObjectId.isValid(v); }

exports.submit = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.params;
    if (!isId(postId)) return res.status(400).json({ ok:false, error:'BAD_ID' });

    const post = await Post.findOne({ _id: postId, companyId, deletedAt: null, status: 'PUBLISHED', type: 'POLL' });
    if (!post) return res.status(404).json({ ok:false, error:'NOT_FOUND' });
    if (!post.poll || !post.poll.questions?.length) return res.status(400).json({ ok:false, error:'NO_POLL' });
    if (post.poll.isClosed) return res.status(400).json({ ok:false, error:'CLOSED' });
    if (post.poll.voterIds?.some(v => String(v) === String(req.user._id))) {
      return res.status(409).json({ ok:false, error:'ALREADY_VOTED' });
    }

    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const byQ = new Map(post.poll.questions.map(q => [q.qid, q]));

    for (const a of answers) {
      const q = byQ.get(String(a.qid));
      if (!q) continue;
      const opt = q.options.find(o => o.oid === String(a.oid));
      if (opt) {
        opt.votesCount += 1;
      }
    }

    post.poll.totalParticipants = (post.poll.totalParticipants || 0) + 1;
    post.poll.voterIds = [...(post.poll.voterIds || []), req.user._id];

    await post.save();

    audit.record({
      companyId, actorUserId: req.user._id,
      action: 'POLL_VOTED', targetType: 'post', targetId: post._id,
      metadata: { count: answers.length }
    }).catch(()=>{});

    await microcache.bustPost(req.company.slug, post._id);
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);

    return res.json({ ok:true, totalParticipants: post.poll.totalParticipants });
  } catch (e) { next(e); }
};

exports.close = async (req, res, next) => {
  try {
    const companyId = cid(req);
    const { postId } = req.params;
    if (!isId(postId)) return res.status(400).json({ ok:false, error:'BAD_ID' });

    const post = await Post.findOne({ _id: postId, companyId, deletedAt: null, type: 'POLL' });
    if (!post) return res.status(404).json({ ok:false, error:'NOT_FOUND' });
    if (!post.poll) return res.status(400).json({ ok:false, error:'NO_POLL' });

    post.poll.isClosed = true;
    post.poll.closesAt = post.poll.closesAt || new Date();
    await post.save();

    audit.record({
      companyId, actorUserId: req.user._id,
      action: 'POLL_CLOSED', targetType: 'post', targetId: post._id
    }).catch(()=>{});

    await microcache.bustPost(req.company.slug, post._id);
    await microcache.bustTenant(req.company.slug);
    if (post.groupId) await microcache.bustGroup(req.company.slug, post.groupId);

    return res.json({ ok:true, isClosed: true });
  } catch (e) { next(e); }
};
