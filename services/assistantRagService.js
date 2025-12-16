// services/assistantRagService.js
// RAG pipeline for Jaango Assistant – Node 16 compatible

const AssistantChunk = require('../models/AssistantChunk');
const AssistantDoc = require('../models/AssistantDoc');

const fetch = require('node-fetch'); // v2, works with Node 16

// Optional: PDF / DOCX extractors
let pdfParse = null;
let mammoth = null;

try {
  pdfParse = require('pdf-parse');
} catch (e) {
  console.warn('[assistantRag] pdf-parse failed to load, PDF extraction disabled:', e.message);
}

try {
  mammoth = require('mammoth');
} catch (e) {
  console.warn('[assistantRag] mammoth failed to load, DOCX extraction disabled:', e.message);
}

// ---- OpenAI REST via node-fetch (no SDK) ----

const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const OPENAI_CHAT_MODEL = 'gpt-4o-mini';

async function callOpenAI(path, body) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const res = await fetch('https://api.openai.com/v1/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (!res.ok) {
    const msg =
      json && json.error && json.error.message
        ? json.error.message
        : 'OpenAI API error';
    throw new Error(msg);
  }
  return json;
}

// ---- Utilities ----

// very rough: ~4 chars per token
function approxTokenCount(str) {
  return Math.ceil((str || '').length / 4);
}

// Smart-ish chunking with paragraph awareness + overlap
function chunkTextSmart(text, opts = {}) {
  const maxTokens = opts.maxTokens || 600;
  const overlapTokens = opts.overlapTokens || 120;

  if (!text || !text.trim()) return [];

  const paragraphs = text
    .split(/\n\s*\n+/g)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';
  let currentTokens = 0;

  const pushChunk = chunk => {
    if (!chunk || !chunk.trim()) return;
    chunks.push(chunk.trim());
  };

  for (const para of paragraphs) {
    const paraTokens = approxTokenCount(para);

    // para itself > max → hard split
    if (paraTokens > maxTokens) {
      const charsPerToken = 4;
      const maxChars = maxTokens * charsPerToken;
      let start = 0;
      while (start < para.length) {
        pushChunk(para.slice(start, start + maxChars));
        start += maxChars;
      }
      current = '';
      currentTokens = 0;
      continue;
    }

    if (currentTokens + paraTokens <= maxTokens) {
      // append
      current = current ? current + '\n\n' + para : para;
      currentTokens += paraTokens;
    } else {
      // flush current
      pushChunk(current);

      if (overlapTokens > 0 && current) {
        const charsPerToken = 4;
        const overlapChars = overlapTokens * charsPerToken;
        const tail = current.slice(-overlapChars);
        current = tail + '\n\n' + para;
        currentTokens = approxTokenCount(current);
      } else {
        current = para;
        currentTokens = paraTokens;
      }
    }
  }

  pushChunk(current);
  return chunks;
}

// Cosine similarity
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---- Embedding + Chat using REST ----

async function embedTexts(texts) {
  if (!texts || !texts.length) return [];
  const input = texts.map(t => t || '');

  const json = await callOpenAI('embeddings', {
    model: OPENAI_EMBED_MODEL,
    input,
  });

  return json.data.map(d => d.embedding);
}

async function chatWithContext(question, contextText) {
  const messages = [
    {
      role: 'system',
      content:
        'You are Jaango Assistant, an internal employee assistant. ' +
        'Answer strictly based on the provided company documents. ' +
        'If you are not sure, say you are not sure. Be concise and clear.',
    },
    {
      role: 'user',
      content:
        `Question:\n${question}\n\n` +
        `Use ONLY this context (if relevant):\n\n${contextText}`,
    },
  ];

  const json = await callOpenAI('chat/completions', {
    model: OPENAI_CHAT_MODEL,
    messages,
    temperature: 0.2,
  });

  return json.choices[0].message.content.trim();
}

// ---- Text extraction ----

async function extractTextFromDoc(doc) {
  // Prefer uploaded file buffer
  if (doc.buffer && doc.mimeType) {
    const mime = doc.mimeType;

    // PDF
    if (pdfParse && mime === 'application/pdf') {
      try {
        const data = await pdfParse(doc.buffer);
        return data.text || '';
      } catch (e) {
        console.warn('[assistantRag] PDF parse failed:', e.message);
      }
    }

    // Word (DOCX/DOC)
    if (
      mammoth &&
      (mime ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mime === 'application/msword')
    ) {
      try {
        const result = await mammoth.extractRawText({ buffer: doc.buffer });
        return result.value || '';
      } catch (e) {
        console.warn('[assistantRag] DOCX parse failed:', e.message);
      }
    }

    // Plain text
    if (mime.startsWith('text/')) {
      try {
        return doc.buffer.toString('utf8');
      } catch (e) {
        console.warn('[assistantRag] text buffer decode failed:', e.message);
      }
    }

    // TODO: add PPTX / XLSX extraction if needed
  }

  // Fallback: URL-based extraction
  if (doc.url) {
    try {
      const resp = await fetch(doc.url);
      const html = await resp.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text;
    } catch (e) {
      console.warn('[assistantRag] Failed to fetch URL', doc.url, e.message);
    }
  }

  return '';
}

// ---- Ingestion: read + chunk + embed + store ----

async function ingestAssistantDoc(doc) {
  if (!doc || !doc._id) return;

  const companyId = doc.companyId || doc.company?._id;
  if (!companyId) return;

  const text = await extractTextFromDoc(doc);
  if (!text || !text.trim()) {
    console.warn('[assistantRag] No text extracted for doc', String(doc._id));
    await AssistantChunk.deleteMany({ companyId, docId: doc._id });
    return;
  }

  const chunks = chunkTextSmart(text, {
    maxTokens: 600,
    overlapTokens: 120,
  });

  if (!chunks.length) {
    await AssistantChunk.deleteMany({ companyId, docId: doc._id });
    return;
  }

  const embeddings = await embedTexts(chunks);

  // cleanup old chunks for this doc
  await AssistantChunk.deleteMany({ companyId, docId: doc._id });

  const docsToInsert = chunks.map((chunkText, idx) => ({
    companyId,
    docId: doc._id,
    sourceType: doc.buffer ? 'FILE' : 'URL',
    sourceName: doc.originalName || doc.title || doc.url,
    chunkIndex: idx,
    text: chunkText,
    embedding: embeddings[idx],
  }));

  await AssistantChunk.insertMany(docsToInsert);
  console.log(
    `[assistantRag] Ingested doc ${doc._id} for company ${companyId} with ${chunks.length} chunks`
  );
}

// ---- Retrieval + answer ----

async function answerQuestion({ companyId, question, maxSources = 6 }) {
  if (!companyId || !question || !question.trim()) {
    return {
      answer: "I don't have enough information to answer that yet.",
      sources: [],
    };
  }

  const [queryEmbedding] = await embedTexts([question]);

  const chunks = await AssistantChunk.find({ companyId }).lean();
  if (!chunks.length) {
    return {
      answer: 'I do not have any documents indexed yet for this company.',
      sources: [],
    };
  }

  const scored = chunks.map(ch => ({
    ...ch,
    score: cosineSimilarity(queryEmbedding, ch.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, maxSources).filter(x => x.score > 0);

  const contextText = top
    .map(
      (c, i) => `Source #${i + 1} (${c.sourceName || 'Unknown'}):\n${c.text}`
    )
    .join('\n\n---\n\n');

  const answer = await chatWithContext(question, contextText);

  const sources = top.map((c, i) => ({
    label: `Source #${i + 1}`,
    docId: c.docId,
    sourceName: c.sourceName,
    score: c.score,
  }));

  return { answer, sources };
}

module.exports = {
  ingestAssistantDoc,
  answerQuestion,
};
