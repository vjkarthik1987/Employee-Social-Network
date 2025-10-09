// controllers/reactionsController.js
const Reaction = require('../models/Reaction');
const Post = require('../models/Post');

exports.toggle = async (req, res, next) => {
  try {
    const { targetType, targetId, reactionType } = req.body;
    const userId = req.user._id;
    const cid = req.companyId;

    const existing = await Reaction.findOne({ companyId: cid, userId, targetType, targetId });

    // no existing → create
    if (!existing) {
      await Reaction.create({ companyId: cid, userId, targetType, targetId, reactionType });
      if (targetType === 'post') {
        await Post.updateOne(
          { _id: targetId, companyId: cid },
          { $inc: { [`reactionsCountByType.${reactionType}`]: 1 } }
        );
      }
      return res.json({ ok: true, added: reactionType });
    }

    // same type → remove (toggle off)
    if (existing.reactionType === reactionType) {
      await existing.deleteOne();
      if (targetType === 'post') {
        await Post.updateOne(
          { _id: targetId, companyId: cid },
          { $inc: { [`reactionsCountByType.${reactionType}`]: -1 } }
        );
      }
      return res.json({ ok: true, removed: reactionType });
    }

    // different type → switch
    const prevType = existing.reactionType;
    if (targetType === 'post') {
      await Post.updateOne(
        { _id: targetId, companyId: cid },
        {
          $inc: {
            [`reactionsCountByType.${prevType}`]: -1,
            [`reactionsCountByType.${reactionType}`]: 1,
          },
        }
      );
    }
    existing.reactionType = reactionType;
    await existing.save();
    return res.json({ ok: true, changedTo: reactionType, prevType });
  } catch (err) { next(err); }
};
