// services/pointsService.js
const PointEvent = require('../models/PointEvent');

function getRules(company) {
  const g = company?.gamification;
  if (!g || g.enabled === false) return null;
  return g.rules || null;
}

function safeNum(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : def;
}

function pointsForAction(company, action, meta = {}) {
  const rules = getRules(company);
  if (!rules) return 0;

  const rt = (meta.reactionType || '').toUpperCase();

  switch (action) {
    case 'POST_CREATED': return safeNum(rules.postCreated, 0);
    case 'COMMENT_CREATED': return safeNum(rules.commentCreated, 0);
    case 'REPLY_CREATED': return safeNum(rules.replyCreated, 0);

    case 'COMMENT_RECEIVED': return safeNum(rules.commentReceived, 0);
    case 'REPLY_RECEIVED': return safeNum(rules.replyReceived, 0);

    case 'REACTION_GIVEN_ADD':
    case 'REACTION_GIVEN_REMOVE': {
      const m = rules.reactionsGiven || {};
      return safeNum(m[rt], 0);
    }

    case 'REACTION_RECEIVED_ADD':
    case 'REACTION_RECEIVED_REMOVE': {
      const m = rules.reactionsReceived || rules.reactionsGiven || {};
      return safeNum(m[rt], 0);
    }

    default: return 0;
  }
}

/**
 * Write a points ledger row with idempotency (eventKey unique).
 * points can be negative.
 */
async function recordEvent({
  company,
  companyId,
  userId,
  action,
  points,
  eventKey,
  actorUserId = null,
  targetType = null,
  targetId = null,
  meta = {}
}) {
  if (!companyId || !userId || !action || !eventKey) return;
  if (!points) return; // don’t store 0-point rows

  try {
    await PointEvent.create({
      companyId,
      userId,
      action,
      points,
      eventKey,
      actorUserId,
      targetType,
      targetId,
      meta
    });
  } catch (e) {
    // duplicate key -> already recorded (idempotent)
    if (String(e?.code) === '11000') return;
    throw e;
  }
}

async function award({
  company,
  companyId,
  userId,           // earner
  actorUserId,      // who caused it
  action,           // logical action
  targetType,
  targetId,
  meta,
  polarity = +1     // +1 for add, -1 for remove
}) {
  const base = pointsForAction(company, action, meta);
  const pts = base * polarity;
  const ek = [
    action,
    String(companyId),
    String(userId),
    String(targetType || ''),
    String(targetId || ''),
    String(meta?.reactionType || ''),
    String(meta?.direction || ''),
    String(meta?.postId || ''),
    String(meta?.commentId || ''),
    String(meta?.parentCommentId || ''),
    polarity === 1 ? 'ADD' : 'REMOVE'
  ].join(':');

  return recordEvent({
    company,
    companyId,
    userId,
    actorUserId,
    action,
    points: pts,
    eventKey: ek,
    targetType,
    targetId,
    meta
  });
}

module.exports = {
  award,
  pointsForAction,
};
