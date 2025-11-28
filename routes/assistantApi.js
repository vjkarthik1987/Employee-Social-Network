// routes/assistantApi.js
// Jaango Assistant – Q&A + in-app actions

const express = require('express');
const router = express.Router({ mergeParams: true });

const fetch = require('node-fetch'); // v2, for Node 16

const tenantGuard = require('../middleware/tenant');
const { ensureAuth } = require('../middleware/auth');

const Post = require('../models/Post');
const Group = require('../models/Group');
const Report = require('../models/Report');
const AssistantMoodEvent = require('../models/AssistantMoodEvent');
const AssistantMessage = require('../models/AssistantMessage');
const ragService = require('../services/assistantRagService');

// ---------- helpers ----------

const OPENAI_CHAT_MODEL = 'gpt-3.5-turbo';

async function callOpenAIChat(messages) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      temperature: 0,
      messages,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message || 'OpenAI error';
    throw new Error(msg);
  }
  return json.choices[0].message.content;
}

// tiny helpers
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------- intent classification ----------
//
// We keep this simple: model must return STRICT JSON:
//
// {
//   "mode": "qa" | "action",
//   "action": null | "create_post" | "search_groups" | "show_moderation" | "send_feedback",
//   "params": { ... }
// }

async function classifyMessage(message) {
  const sys = {
    role: 'system',
    content:
      'You are an intent classifier for the Jaango Assistant. ' +
      'Your job is to decide if the user wants NORMAL_QA or an ACTION. ' +
      'Supported actions: create_post, search_groups, show_moderation, send_feedback. ' +
      'Return STRICT JSON with keys: mode, action, params. ' +
      'mode is either "qa" or "action". ' +
      'If mode is "qa", action MUST be null and params {}. ' +
      'If mode is "action", action MUST be one of the supported names. ' +
      'For create_post, params: { "postText": "...", "groupName": optional string }. ' +
      'For search_groups, params: { "topic": "..." }. ' +
      'For show_moderation, params: {}. ' +
      'For send_feedback, params: { "feedback": "..." }. ' +
      'Respond ONLY with minified JSON. No explanations.',
  };

  const user = {
    role: 'user',
    content: message,
  };

  let raw;
  try {
    raw = await callOpenAIChat([sys, user]);
  } catch (e) {
    console.warn('[assistantIntent] OpenAI failed, defaulting to qa', e.message);
    return { mode: 'qa', action: null, params: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || (parsed.mode !== 'qa' && parsed.mode !== 'action')) {
      throw new Error('bad shape');
    }
    return {
      mode: parsed.mode,
      action: parsed.action || null,
      params: parsed.params || {},
    };
  } catch (e) {
    console.warn('[assistantIntent] JSON parse failed, got:', raw);
    return { mode: 'qa', action: null, params: {} };
  }
}

// ---------- action handlers ----------

// create_post: create a simple TEXT post in company feed or a specific group
async function handleCreatePost(req, params) {
  const company = req.company;
  const user = req.user;

  const text =
    (params && (params.postText || params.content || params.message)) ||
    req.body.message ||
    '';

  if (!text.trim()) {
    return {
      ok: true,
      answer: "I wasn't sure what to post. Try again with a clearer sentence.",
      sources: [],
    };
  }

  let group = null;
  if (params && params.groupName) {
    const rx = new RegExp('^' + escapeRegExp(params.groupName) + '$', 'i');
    group = await Group.findOne({ companyId: company._id, name: rx }).lean();
  }

  const richText = `<p>${escapeHtml(text.trim())}</p>`;

  const post = await Post.create({
    companyId: company._id,
    authorId: user._id,
    groupId: group ? group._id : null,
    type: 'TEXT',
    status: 'PUBLISHED',
    visibility: group ? 'GROUP' : 'COMPANY',
    richText,
  });

  const where = group ? `in the "${group.name}" group` : 'to the company feed';
  const answer = `Done. I created a post ${where}.`;

  return { ok: true, answer, sources: [{ label: 'post', docId: post._id }] };
}

// search_groups: find groups whose name matches topic
async function handleSearchGroups(req, params) {
  const company = req.company;
  const topic =
    (params && (params.topic || params.query || params.keyword)) ||
    req.body.message ||
    '';

  if (!topic.trim()) {
    return {
      ok: true,
      answer: 'Tell me what kind of groups you are looking for.',
      sources: [],
    };
  }

  const rx = new RegExp(escapeRegExp(topic.trim()), 'i');

  const groups = await Group.find({
    companyId: company._id,
    name: rx,
  })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  if (!groups.length) {
    return {
      ok: true,
      answer: `I couldn’t find any groups related to “${topic.trim()}”.`,
      sources: [],
    };
  }

  const list = groups.map(g => `• ${g.name}`).join('\n');
  const answer = `Here are some groups related to “${topic.trim()}”:\n\n${list}`;

  return { ok: true, answer, sources: [] };
}

// show_moderation: show open reports for this company
async function handleShowModeration(req) {
  const company = req.company;

  const reports = await Report.find({
    companyId: company._id,
    status: { $in: ['open', 'in-review'] },
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  if (!reports.length) {
    return {
      ok: true,
      answer: 'You have no open moderation reports right now.',
      sources: [],
    };
  }

  const summary = reports
    .map(r => `• ${r.targetType} reported as ${r.reasonCode.toLowerCase()} (status: ${r.status})`)
    .join('\n');

  const answer =
    'Here are the most recent open moderation reports:\n\n' + summary;

  return { ok: true, answer, sources: [] };
}

// send_feedback: log feedback anonymously (simple version – no new model)
async function handleSendFeedback(req, params) {
  // v1: just create an anonymised TEXT post to a special “HR Feedback” group if it exists,
  // otherwise log and acknowledge.
  const company = req.company;
  const feedback =
    (params && (params.feedback || params.message || params.text)) ||
    req.body.message ||
    '';

  if (!feedback.trim()) {
    return {
      ok: true,
      answer: 'Please type the feedback you want me to send to HR.',
      sources: [],
    };
  }

  // Try to find an HR Feedback group
  const rx = new RegExp('HR Feedback', 'i');
  const hrGroup = await Group.findOne({ companyId: company._id, name: rx }).lean();

  if (hrGroup) {
    const richText = `<p>${escapeHtml(
      '[Anonymous via Jaango Assistant] ' + feedback.trim()
    )}</p>`;
    await Post.create({
      companyId: company._id,
      authorId: req.user._id, // could be swapped to a system user later
      groupId: hrGroup._id,
      type: 'TEXT',
      status: 'PUBLISHED',
      visibility: 'GROUP',
      richText,
    });

    return {
      ok: true,
      answer:
        'Got it. I’ve posted your feedback anonymously into the HR Feedback group.',
      sources: [],
    };
  }

  // Fallback if no special group is configured
  console.log('[AssistantFeedback]', {
    companyId: company._id.toString(),
    userId: req.user._id.toString(),
    feedback,
  });

  return {
    ok: true,
    answer:
      'Got it. I’ve recorded your feedback for HR. (Ask your admin to create a group called “HR Feedback” to route these into a group.)',
    sources: [],
  };
}

async function classifyMood(message) {
  const sys = {
    role: 'system',
    content:
      'You are a mood classifier for an employee assistant. ' +
      'Given a user message, you output JSON with keys: mood, sentimentScore, flags. ' +
      'mood in ["STRESSED","TIRED","FRUSTRATED","SAD","OKAY","CALM","HAPPY","EXCITED"]. ' +
      'sentimentScore is an integer from -2 to 2. ' +
      'flags is an array of short lowercase tags like ["workload","manager","personal","health"]. ' +
      'Respond ONLY with minified JSON.',
  };
  const user = { role: 'user', content: message };

  try {
    const raw = await callOpenAIChat([sys, user]); // you already have callOpenAIChat
    const parsed = JSON.parse(raw);
    if (!parsed.mood) throw new Error('no mood');
    return {
      mood: parsed.mood,
      sentimentScore: parsed.sentimentScore ?? 0,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch (e) {
    console.warn('[assistantMood] failed to classify mood:', e.message);
    return { mood: 'OKAY', sentimentScore: 0, flags: [] };
  }
}

//Saves each chat
async function saveExchange({ companyId, userId, question, answer, mode, action, tags }) {
  try {
    await AssistantMessage.create({
      companyId,
      userId,
      question,
      answer,
      mode: mode || 'qa',
      action: action || null,
      tags: tags || [],
    });
  } catch (e) {
    console.warn('[AssistantMessage] failed to save exchange:', e.message);
  }
}


// ---------- routing ----------

router.use(tenantGuard);
router.use(ensureAuth);

// POST /:org/api/assistant/chat
router.post('/chat', async (req, res, next) => {
  try {
    const message = (req.body && req.body.message ? String(req.body.message) : '').trim();

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Empty message' });
    }

    const company = req.company;
    if (!company) {
      return res.status(500).json({ ok: false, error: 'Company not resolved' });
    }

    // 1) classify into QA vs action
    const { mode, action, params } = await classifyMessage(message);

    // 2) if action...
    if (mode === 'action' && action) {
      let payload;
      if (action === 'create_post') {
        payload = await handleCreatePost(req, params);
      } else if (action === 'search_groups') {
        payload = await handleSearchGroups(req, params);
      } else if (action === 'show_moderation') {
        payload = await handleShowModeration(req, params);
      } else if (action === 'send_feedback') {
        payload = await handleSendFeedback(req, params);
      } else {
        payload = null;
      }

      if (payload) {
        // 👉 Save action exchange
        await saveExchange({
          companyId: company._id,
          userId: req.user._id,
          question: message,
          answer: payload.answer || '',
          mode: 'action',
          action,
        });

        return res.json(Object.assign({ ok: true }, payload));
      }
    }

    // 3) default: RAG Q&A
    const { answer, sources } = await ragService.answerQuestion({
      companyId: company._id,
      question: message,
      maxSources: 6,
    });

    // 👉 Save QA exchange
    await saveExchange({
      companyId: company._id,
      userId: req.user._id,
      question: message,
      answer: answer || '',
      mode: 'qa',
      action: null,
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


// GET /:org/api/assistant/history?limit=10
router.get('/history', async (req, res) => {
  try {
    const company = req.company;
    const user = req.user;
    if (!company || !user) {
      return res.status(401).json({ ok: false, error: 'Not authorized' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    const docs = await AssistantMessage.find({
      companyId: company._id,
      userId: user._id,
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    // Return in chronological order (oldest → newest)
    const history = docs
      .slice()
      .reverse()
      .map((d) => ({
        id: d._id,
        question: d.question,
        answer: d.answer,
        mode: d.mode,
        action: d.action,
        createdAt: d.createdAt,
      }));

    return res.json({ ok: true, history });
  } catch (err) {
    console.error('[assistantApi] history error', err);
    return res.status(500).json({
      ok: false,
      error: 'Failed to load history.',
    });
  }
});


module.exports = router;
