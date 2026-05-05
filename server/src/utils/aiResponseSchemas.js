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
    if (!isNonEmptyString(post.body)) return result(false, `posts[${index}].body is required`);
    if (post.riskLevel != null && !['low', 'medium', 'high'].includes(post.riskLevel)) return result(false, `posts[${index}].riskLevel is invalid`);
  }
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
