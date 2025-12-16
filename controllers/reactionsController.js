// controllers/reactionsController.js
const Reaction = require('../models/Reaction');
const Post = require('../models/Post');
const Comment = require('../models/Comment'); // ✅ add (if you react to comments too)
const pointsService = require('../services/pointsService');

exports.toggle = async (req, res, next) => {
  try {
    const { targetType, targetId, reactionType } = req.body;
    const actorId = req.user._id;
    const companyId = req.companyId || req.company?._id;
    const rt = String(reactionType || '').toUpperCase();

    // find existing reaction by this user on this target
    const existing = await Reaction.findOne({
      companyId,
      userId: actorId,
      targetType,
      targetId
    });

    // helper to find "owner" (who receives points)
    async function getTargetOwnerId() {
      if (targetType === 'post') {
        const p = await Post.findOne({ _id: targetId, companyId }, { authorId: 1 }).lean();
        return p?.authorId || null;
      }
      if (targetType === 'comment') {
        const c = await Comment.findOne({ _id: targetId, companyId }, { authorId: 1 }).lean();
        return c?.authorId || null;
      }
      return null;
    }

    // 1) ADD (no existing)
    if (!existing) {
      await Reaction.create({ companyId, userId: actorId, targetType, targetId, reactionType: rt });

      if (targetType === 'post') {
        await Post.updateOne(
          { _id: targetId, companyId },
          { $inc: { [`reactionsCountByType.${rt}`]: 1 } }
        );
      }

      const ownerId = await getTargetOwnerId();

      // reactor gets points
      await pointsService.award({
        company: req.company,
        companyId,
        userId: actorId,
        actorUserId: actorId,
        action: 'REACTION_GIVEN_ADD',
        targetType,
        targetId,
        meta: { reactionType: rt }
      }).catch(() => {});

      // owner gets points (if different person)
      if (ownerId && String(ownerId) !== String(actorId)) {
        await pointsService.award({
          company: req.company,
          companyId,
          userId: ownerId,
          actorUserId: actorId,
          action: 'REACTION_RECEIVED_ADD',
          targetType,
          targetId,
          meta: { reactionType: rt }
        }).catch(() => {});
      }

      return res.json({ ok: true, added: rt });
    }

    // 2) TOGGLE OFF (same reaction)
    if (existing.reactionType === rt) {
      await existing.deleteOne();

      if (targetType === 'post') {
        await Post.updateOne(
          { _id: targetId, companyId },
          { $inc: { [`reactionsCountByType.${rt}`]: -1 } }
        );
      }

      const ownerId = await getTargetOwnerId();

      await pointsService.award({
        company: req.company,
        companyId,
        userId: actorId,
        actorUserId: actorId,
        action: 'REACTION_GIVEN_REMOVE',
        targetType,
        targetId,
        meta: { reactionType: rt },
        polarity: -1
      }).catch(() => {});

      if (ownerId && String(ownerId) !== String(actorId)) {
        await pointsService.award({
          company: req.company,
          companyId,
          userId: ownerId,
          actorUserId: actorId,
          action: 'REACTION_RECEIVED_REMOVE',
          targetType,
          targetId,
          meta: { reactionType: rt },
          polarity: -1
        }).catch(() => {});
      }

      return res.json({ ok: true, removed: rt });
    }

    // 3) SWITCH reaction type
    const prev = String(existing.reactionType || '').toUpperCase();
    existing.reactionType = rt;
    await existing.save();

    if (targetType === 'post') {
      await Post.updateOne(
        { _id: targetId, companyId },
        {
          $inc: {
            [`reactionsCountByType.${prev}`]: -1,
            [`reactionsCountByType.${rt}`]: 1
          }
        }
      );
    }

    const ownerId = await getTargetOwnerId();

    // remove prev (negative), add new (positive)
    await pointsService.award({
      company: req.company,
      companyId,
      userId: actorId,
      actorUserId: actorId,
      action: 'REACTION_GIVEN_REMOVE',
      targetType,
      targetId,
      meta: { reactionType: prev },
      polarity: -1
    }).catch(() => {});
    await pointsService.award({
      company: req.company,
      companyId,
      userId: actorId,
      actorUserId: actorId,
      action: 'REACTION_GIVEN_ADD',
      targetType,
      targetId,
      meta: { reactionType: rt }
    }).catch(() => {});

    if (ownerId && String(ownerId) !== String(actorId)) {
      await pointsService.award({
        company: req.company,
        companyId,
        userId: ownerId,
        actorUserId: actorId,
        action: 'REACTION_RECEIVED_REMOVE',
        targetType,
        targetId,
        meta: { reactionType: prev },
        polarity: -1
      }).catch(() => {});
      await pointsService.award({
        company: req.company,
        companyId,
        userId: ownerId,
        actorUserId: actorId,
        action: 'REACTION_RECEIVED_ADD',
        targetType,
        targetId,
        meta: { reactionType: rt }
      }).catch(() => {});
    }

    return res.json({ ok: true, changedTo: rt, prevType: prev });

  } catch (err) {
    next(err);
  }
};
