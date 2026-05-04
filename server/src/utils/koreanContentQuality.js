const DECORATIVE_EMOJIS = /[🌸🌼🌺💐✨💕💖💗💓❤️😊😍🥰]/gu;
const CTA_LIKE_LINES = /(댓글|링크|프로필|구매|최저가|특가|할인\s*링크|바로\s*가기)/i;

function collapseRepeatedDecorativeEmojis(text) {
  let count = 0;
  return text.replace(DECORATIVE_EMOJIS, (match) => {
    count += 1;
    return count <= 1 ? match : '';
  });
}

export function normalizeKoreanPostText(value) {
  const raw = String(value || '');
  const normalized = collapseRepeatedDecorativeEmojis(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/([!?]){2,}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return normalized;
}

export function inspectKoreanPostQuality(value) {
  const text = String(value || '');
  const warnings = [];
  const emojiCount = (text.match(DECORATIVE_EMOJIS) || []).length;
  const ctaLines = text.split('\n').filter((line) => CTA_LIKE_LINES.test(line));

  if (emojiCount > 1) warnings.push('decorative_emoji_overused');
  if (/[!?]{2,}/.test(text)) warnings.push('repeated_punctuation');
  if (ctaLines.length > 0) warnings.push('cta_like_body_text');
  if (text.length > 260) warnings.push('long_threads_body');

  return warnings;
}

export function prepareGeneratedPostBody(value) {
  const before = String(value || '');
  const body = normalizeKoreanPostText(before);
  const warnings = inspectKoreanPostQuality(before);
  if (body !== before.trim()) warnings.push('normalized_text');
  return { body, warnings: [...new Set(warnings)] };
}
