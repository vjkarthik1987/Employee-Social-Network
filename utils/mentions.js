// Finds @handle or @email within plain text stripped from HTML
function extractMentionsFromHtml(html) {
  const text = (html || '').replace(/<[^>]*>/g, ' ');
  const atHandles = Array.from(text.matchAll(/@([a-zA-Z0-9._-]{2,50})/g)).map(m => m[1]);
  const emails = Array.from(text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g)).map(m => m[0]);
  return { handles: [...new Set(atHandles)], emails: [...new Set(emails)] };
}

function makeSnippet(html, n = 160) {
  const t = (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g,' ').trim();
  return t.length > n ? t.slice(0,n) + '…' : t;
}

module.exports = { extractMentionsFromHtml, makeSnippet };
