// routes/assistantApi.js
const express = require('express');
const router = express.Router({ mergeParams: true });

const tenantGuard = require('../middleware/tenant');
const { ensureAuth } = require('../middleware/auth');
const ragService = require('../services/assistantRagService');

// Ensure we know which company + user this is
router.use(tenantGuard);
router.use(ensureAuth);

// POST /api/:org/assistant/chat
router.post('/chat', async (req, res, next) => {
  try {
    const question = (req.body && req.body.message ? String(req.body.message) : '').trim();

    if (!question) {
      return res.status(400).json({
        ok: false,
        error: 'Empty question',
      });
    }

    const company = req.company;
    if (!company) {
      return res.status(500).json({
        ok: false,
        error: 'Company not resolved',
      });
    }

    const { answer, sources } = await ragService.answerQuestion({
      companyId: company._id,
      question,
      maxSources: 6,
    });

    return res.json({
      ok: true,
      answer,
      sources,
    });
  } catch (err) {
    console.error('[assistantApi] chat error', err);
    return res.status(500).json({
      ok: false,
      error: 'Something went wrong while answering your question.',
    });
  }
});

module.exports = router;
