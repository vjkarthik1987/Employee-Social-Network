// routes/admin/polls.js
const express = require('express');
const router = express.Router({ mergeParams: true });
const ensureAuth = require('../middleware/auth').ensureAuth;
const { requireRole } = require('../middleware/auth');
const Post = require('../models/Post');

function cid(req){ return req.companyId || req.company?._id; }

router.get('/', ensureAuth, requireRole(['MODERATOR','ORG_ADMIN']), async (req, res, next) => {
  try {
    const companyId = cid(req);
    const polls = await Post.aggregate([
      { $match: { companyId, deletedAt: null, type: 'POLL' } },
      { $project: {
          createdAt: 1,
          authorId: 1,
          'poll.title': 1,
          'poll.totalParticipants': 1,
          'poll.isClosed': 1,
          'poll.questions': 1
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 200 } // cap for page
    ]);
    res.render('admin/polls', { company: req.company, user: req.user, polls, csrfToken: req.csrfToken?.() });
  } catch(e){ next(e); }
});

module.exports = router;
