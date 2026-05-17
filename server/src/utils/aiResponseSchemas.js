function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value, { min = 0 } = {}) {
  return Array.isArray(value) && value.length >= min && value.every(isNonEmptyString);
}

function result(ok, reason = null) {
  return ok ? { ok: true } : { ok: false, reason };
}

const CONTENT_FORMATS = new Set([
  'plain_observation',
  'daily_one_liner',
  'two_line_empathy',
  'random_life_complaint',
  'fake_chat',
  'before_after',
  'meme_caption',
  'anti_buy',
  'checklist_card',
  'mini_story',
  'choice_question',
  'soft_question',
  'collection_bridge',
  'direct_product',
  'seasonal_life',
  'trend_reaction',
  'send_to_friend',
  'tiny_confession',
  'wrong_purchase',
  'before_buy_check',
  'room_reality',
  'lazy_person_tip',
  'anti_aesthetic',
  'mini_poll',
  'micro_story',
  'visual_card_caption',
  'pov_scene',
  'myth_reality',
  'ranked_list',
  'imaginary_reply',
  'series_note',
  'photo_dump_caption'
]);

const CONTENT_GOALS = new Set([
  'reach_only',
  'reply',
  'save',
  'conversion',
  'trust',
  'experiment',
  'share',
  'meme',
  'rant',
  'confession',
  'anti_buy',
  'seasonal_spike',
  'curiosity',
  'community'
]);

export function validateTopicsResponse(value) {
  if (!isObject(value)) return result(false, 'topics response must be an object');
  if (!Array.isArray(value.topics) || value.topics.length === 0) return result(false, 'topics must be a non-empty array');
  for (const [index, topic] of value.topics.entries()) {
    if (!isObject(topic)) return result(false, `topics[${index}] must be an object`);
    if (!isNonEmptyString(topic.title)) return result(false, `topics[${index}].title is required`);
    if (!isNonEmptyString(topic.angle)) return result(false, `topics[${index}].angle is required`);
    if (!isNonEmptyString(topic.targetUser)) return result(false, `topics[${index}].targetUser is required`);
    if (!isNonEmptyString(topic.reason)) return result(false, `topics[${index}].reason is required`);
    if (!['low', 'medium', 'high'].includes(topic.expectedIntent)) return result(false, `topics[${index}].expectedIntent is invalid`);
    if (!isStringArray(topic.searchKeywords, { min: 1 })) return result(false, `topics[${index}].searchKeywords must contain strings`);
  }
  return result(true);
}

export function validateProductSelectionResponse(value) {
  if (!isObject(value)) return result(false, 'product selection response must be an object');
  if (!Array.isArray(value.selectedProducts)) return result(false, 'selectedProducts must be an array');
  for (const [index, item] of value.selectedProducts.entries()) {
    if (!isObject(item)) return result(false, `selectedProducts[${index}] must be an object`);
    if (!isNonEmptyString(item.productId)) return result(false, `selectedProducts[${index}].productId is required`);
    const fitScore = Number(item.fitScore);
    if (!Number.isFinite(fitScore) || fitScore < 0 || fitScore > 100) return result(false, `selectedProducts[${index}].fitScore must be 0-100`);
    if (!isNonEmptyString(item.reason)) return result(false, `selectedProducts[${index}].reason is required`);
  }
  return result(true);
}

export function validatePostsResponse(value) {
  if (!isObject(value)) return result(false, 'posts response must be an object');
  if (!Array.isArray(value.posts) || value.posts.length === 0) return result(false, 'posts must be a non-empty array');
  for (const [index, post] of value.posts.entries()) {
    if (!isObject(post)) return result(false, `posts[${index}] must be an object`);
    if (!isNonEmptyString(post.contentType)) return result(false, `posts[${index}].contentType is required`);
    if (post.contentFormat != null && !CONTENT_FORMATS.has(post.contentFormat)) return result(false, `posts[${index}].contentFormat is invalid`);
    if (post.contentGoal != null && !CONTENT_GOALS.has(post.contentGoal)) return result(false, `posts[${index}].contentGoal is invalid`);
    if (!isNonEmptyString(post.body)) return result(false, `posts[${index}].body is required`);
    if (post.riskLevel != null && !['low', 'medium', 'high'].includes(post.riskLevel)) return result(false, `posts[${index}].riskLevel is invalid`);
  }
  return result(true);
}

export function validatePostRewriteResponse(value) {
  if (!isObject(value)) return result(false, 'post rewrite response must be an object');
  if (!isNonEmptyString(value.body)) return result(false, 'body is required');
  if (!isNonEmptyString(value.contentType)) return result(false, 'contentType is required');
  if (value.changeSummary != null && typeof value.changeSummary !== 'string') return result(false, 'changeSummary must be a string');
  if (value.riskLevel != null && !['low', 'medium', 'high'].includes(value.riskLevel)) return result(false, 'riskLevel is invalid');
  return result(true);
}

export function validateCtasResponse(value) {
  if (!isObject(value)) return result(false, 'ctas response must be an object');
  if (!Array.isArray(value.ctas) || value.ctas.length === 0) return result(false, 'ctas must be a non-empty array');
  for (const [index, cta] of value.ctas.entries()) {
    if (!isObject(cta)) return result(false, `ctas[${index}] must be an object`);
    if (!isNonEmptyString(cta.variantKey)) return result(false, `ctas[${index}].variantKey is required`);
    if (!isNonEmptyString(cta.ctaText)) return result(false, `ctas[${index}].ctaText is required`);
  }
  return result(true);
}
