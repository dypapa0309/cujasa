// Minimal RSS 2.0 item parser (no external deps).
// Built for headline-only ingestion: we intentionally keep title/link/publisher/
// pubDate and never store article bodies (copyright posture).

const ENTITY_MAP = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
};

export function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITY_MAP[entity] || entity);
}

function stripCdata(value = '') {
  return String(value).replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeXmlEntities(stripCdata(match[1].trim())).trim();
}

function normalizeDate(value = '') {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Google News titles look like "제목 - 언론사". Split the publisher suffix out.
export function splitPublisherSuffix(title = '', fallbackPublisher = '') {
  const match = String(title).match(/^(.*)\s-\s([^-]{1,40})$/);
  if (!match) return { title: String(title).trim(), publisher: fallbackPublisher };
  return { title: match[1].trim(), publisher: match[2].trim() || fallbackPublisher };
}

export function parseRssItems(xml = '') {
  const items = [];
  const blocks = String(xml).match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const rawTitle = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    if (!rawTitle || !link) continue;
    const sourcePublisher = extractTag(block, 'source');
    const { title, publisher } = splitPublisherSuffix(rawTitle, sourcePublisher);
    items.push({
      title,
      link,
      publisher: publisher || sourcePublisher || null,
      publishedAt: normalizeDate(extractTag(block, 'pubDate')),
      description: extractTag(block, 'description').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    });
  }
  return items;
}
