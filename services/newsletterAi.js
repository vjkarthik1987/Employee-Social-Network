// services/newsletterAi.js
const fetch = require('node-fetch');     // Node 16-compatible fetch
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// If you're on Node <18, install node-fetch and uncomment:
// const fetch = global.fetch || require('node-fetch');

function stripTags(html = '') {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, '')
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

async function summarizeExternalArticle(url, htmlRaw) {
  const host = extractHost(url);
  const titleFromHtml = extractTitle(htmlRaw);
  const text = stripTags(htmlRaw).replace(/\s+/g, ' ');
  const snippet = text.slice(0, 8000); // keep tokens manageable

  // Fallback if no key: basic snippet
  if (!OPENAI_API_KEY) {
    const safe = snippet.slice(0, 400);
    return {
      title: titleFromHtml || host || 'External article',
      source: host,
      summaryHtml: `<p>${safe}…</p>`
    };
  }

  const body = {
    model: 'gpt-3.5-turbo',
    temperature: 0.4,
    messages: [
      {
        role: 'system',
        content: 'You write short, clear HTML summaries for internal employee newsletters.'
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
          snippet
        ].join('\n')
      }
    ]
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json();
  const summaryHtml = data.choices?.[0]?.message?.content?.trim() || '';

  return {
    title: titleFromHtml || host || 'External article',
    source: host,
    summaryHtml
  };
}

module.exports = {
  summarizeExternalArticle,
};
