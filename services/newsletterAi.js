// services/newsletterAi.js
const fetch = require('node-fetch');     // Node 16-compatible fetch
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function stripTags(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

function extractTitle(html = '') {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractHost(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Summarise a single external article into HTML (for EXTERNAL items).
 * Callers are responsible for fetching the article HTML and passing it as `htmlRaw`.
 */
async function summarizeExternalArticle(url, htmlRaw) {
  const host = extractHost(url);
  const titleFromHtml = extractTitle(htmlRaw || '');
  const text = stripTags(htmlRaw || '').replace(/\s+/g, ' ');
  const snippet = text.slice(0, 8000); // keep tokens manageable

  // Fallback if no key: basic snippet
  if (!OPENAI_API_KEY) {
    const safe = snippet.slice(0, 400);
    return {
      title: titleFromHtml || host || 'External article',
      source: host,
      summaryHtml: `<p>${safe}…</p>`,
    };
  }

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: 'You write short, clear HTML summaries for internal employee newsletters.',
      },
      {
        role: 'user',
        content: [
          `Summarize the following article for an internal company newsletter.`,
          `Use 120–180 words in 1–2 short paragraphs of HTML.`,
          `Do not include a title in the summary; we will show the article title separately.`,
          '',
          `URL: ${url}`,
          '',
          `CONTENT:`,
          snippet,
        ].join('\n'),
      },
    ],
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const summaryHtml = data.choices?.[0]?.message?.content?.trim() || '';

  return {
    title: titleFromHtml || host || 'External article',
    source: host,
    summaryHtml,
  };
}

/**
 * Generate a whole edition structure (editor note + items) from internal posts and external articles.
 *
 * posts: [
 *   { id, title, url, snippet }
 * ]
 * externals: [
 *   { url, title, source, summaryHtml, snippet }
 * ]
 */
async function generateEditionFromPostsAndLinks({ topic, posts = [], externals = [] }) {
  const postBlocks = posts.map((p, idx) => {
    return [
      `Internal #${idx + 1}`,
      `Title: ${p.title || '(no title)'}`,
      `URL: ${p.url || '(internal post)'}`,
      `Snippet: ${p.snippet || '(none)'}`,
    ].join('\n');
  });

  const externalBlocks = externals.map((e, idx) => {
    return [
      `External #${idx + 1}`,
      `Title: ${e.title || '(no title)'}`,
      `Source: ${e.source || '(unknown)'}`,
      `URL: ${e.url}`,
      `Summary: ${e.snippet || '(none)'}`,
    ].join('\n');
  });

  // If no API key, do a simple fallback that just wraps posts as items.
  if (!OPENAI_API_KEY) {
    const fallbackItems = posts.slice(0, 10).map((p, i) => ({
      kind: 'POST',
      title: p.title || `Item #${i + 1}`,
      highlight: p.snippet || '',
      postId: p.id || null,
      position: i + 1,
    }));
    return {
      editorNoteHtml: `<p>${topic || 'This edition'} highlights key internal updates and external reads.</p>`,
      items: fallbackItems,
    };
  }

  const systemPrompt = `
You are an editor for an internal company newsletter.
You will receive:
- A topic for this edition
- A set of internal posts
- A set of external articles (summarised)

You must respond STRICTLY as JSON with this structure:

{
  "editorNoteHtml": "<p>...</p>",
  "items": [
    {
      "kind": "POST",
      "title": "string",
      "highlight": "string",
      "postId": "ID_OR_NULL"
    },
    {
      "kind": "EXTERNAL",
      "title": "string",
      "source": "string",
      "url": "string",
      "summaryHtml": "<p>...</p>"
    }
  ]
}

Rules:
- "editorNoteHtml" is 2–4 short paragraphs of HTML, friendly but concise.
- Pick at most 10 items total (internal + external).
- For internal posts, "postId" must match the "id" field you see in the data (string).
- For "highlight", write 1–2 lines in simple language about why this item matters.
- Do NOT include markdown, only plain JSON with double-quoted keys.
`.trim();

  const userPrompt = `
Topic: ${topic || '(no specific topic)'}

INTERNAL POSTS:
${postBlocks.join('\n\n') || '(none)'}

EXTERNAL ARTICLES:
${externalBlocks.join('\n\n') || '(none)'}
`.trim();

  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.5,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error (edition): ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Fallback minimal structure if JSON parsing fails
    const fallbackItems = posts.slice(0, 10).map((p, i) => ({
      kind: 'POST',
      title: p.title || `Item #${i + 1}`,
      highlight: p.snippet || '',
      postId: p.id || null,
      position: i + 1,
    }));
    return {
      editorNoteHtml: `<p>${topic || 'This edition'} highlights key updates and resources.</p>`,
      items: fallbackItems,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI response malformed for newsletter edition.');
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];

  const safeItems = items.slice(0, 10).map((it, idx) => {
    if (it.kind === 'EXTERNAL') {
      return {
        kind: 'EXTERNAL',
        title: String(it.title || `External item #${idx + 1}`),
        source: String(it.source || ''),
        url: String(it.url || ''),
        summaryHtml: String(it.summaryHtml || ''),
        position: idx + 1,
      };
    }
    // default: POST
    return {
      kind: 'POST',
      title: String(it.title || `Item #${idx + 1}`),
      highlight: String(it.highlight || ''),
      postId: it.postId || null,
      position: idx + 1,
    };
  });

  return {
    editorNoteHtml: String(parsed.editorNoteHtml || ''),
    items: safeItems,
  };
}

module.exports = {
  summarizeExternalArticle,
  generateEditionFromPostsAndLinks,
};
