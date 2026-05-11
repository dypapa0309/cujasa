import { getProductGroup, scoreProductTopicRelevance } from './productDiversity.js';
import { isRealCoupangProduct, realProductIssues } from './productQuality.js';

const BROAD_TERMS = new Set(['선택', '기준', '관리', '있는', '고를', '처음엔', '제품', '상품', '추천']);
const FALSE_CHILD_PARTIALS = /(아이트랩|아이템|아이스|아이폰|아이패드|아이보리)/i;
const CHILD_CONTEXT = /(아이|아기|유아|육아|어린이|키즈|자녀|아동)/i;
const GIFT_CONTEXT = /(선물|기프트|포장|카드|세트|패키지|답례|부모님|가정의\s*달)/i;

function normalize(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(value = '') {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !BROAD_TERMS.has(token));
}

function productText(product = {}) {
  return normalize([
    product.product_name,
    product.category_name,
    product.keyword,
    product.product_group,
    getProductGroup(product)
  ].filter(Boolean).join(' '));
}

function topicText(topic = {}, account = {}, extra = '') {
  return [
    topic.title,
    topic.angle,
    topic.keyword,
    topic.search_keyword,
    account.target_audience,
    account.content_scope,
    extra
  ].filter(Boolean).join(' ');
}

function hasTokenMatch(productTextValue, token) {
  if (!token || !productTextValue.includes(token)) return false;
  if (token === '아이' && FALSE_CHILD_PARTIALS.test(productTextValue) && !CHILD_CONTEXT.test(productTextValue.replace(FALSE_CHILD_PARTIALS, ''))) {
    return false;
  }
  return true;
}

export function evaluateProductTopicMatch(product = {}, topic = {}, account = {}, options = {}) {
  const text = productText(product);
  const contextText = topicText(topic, account, options.body || '');
  const tokens = [...new Set(tokenize(contextText))];
  const matched = tokens.filter((token) => hasTokenMatch(text, token));
  const relevance = scoreProductTopicRelevance(product, {
    ...topic,
    search_keyword: tokens.join(' ')
  }, account);
  const qualityIssues = realProductIssues(product);
  const riskReasons = [...qualityIssues];
  let score = Math.max(0, relevance.score) + matched.length * 8;

  if (matched.length === 0) riskReasons.push('주제 핵심어 매칭 없음');
  if (qualityIssues.length === 0) score += 20;
  else score -= 40;

  const sourceText = normalize(contextText);
  if (sourceText.includes('아이') && FALSE_CHILD_PARTIALS.test(text) && !CHILD_CONTEXT.test(text.replace(FALSE_CHILD_PARTIALS, ''))) {
    score -= 35;
    riskReasons.push('아이/아이트랩 부분 문자열 오매칭');
  }
  if (sourceText.includes('선물') || sourceText.includes('가정의 달')) {
    const group = getProductGroup(product);
    const giftLike = GIFT_CONTEXT.test(text) || ['꽃/화병', '카드/포장', '앨범/DIY', '무드등/조명', '식품/간식'].includes(group);
    if (!giftLike) {
      score -= 20;
      riskReasons.push('선물 맥락 약함');
    }
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const minScore = Number(options.minScore || 35);
  const linkable = isRealCoupangProduct(product) && finalScore >= minScore && !riskReasons.some((reason) => /오매칭|선물 맥락 약함|주제 핵심어 매칭 없음/.test(reason));

  return {
    score: finalScore,
    matchedKeywords: matched,
    matchReasons: matched.length
      ? matched.slice(0, 4).map((keyword) => `키워드 "${keyword}" 일치`)
      : ['주제 핵심어 매칭 없음'],
    riskReasons,
    linkable,
    group: getProductGroup(product)
  };
}
