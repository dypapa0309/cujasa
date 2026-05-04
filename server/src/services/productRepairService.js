import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { ensureFallbackProductForTopic, searchProductsForTopic } from './coupangService.js';
import { selectProducts } from './productSelectionService.js';
import { dbGet, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const DEFAULT_ATTEMPT_LIMIT = 3;

function normalizeKeyword(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueKeywords(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(normalizeKeyword).filter((item) => item.length >= 2)) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.slice(0, 5);
}

function extractUsefulTerms(...values) {
  return uniqueKeywords(values.join(' ').split(/\s+/).filter((term) => term.length >= 2 && term.length <= 12));
}

function fallbackKeywords(topic = {}, account = {}, attempt = 1) {
  const base = [
    ...(Array.isArray(topic.search_keywords) ? topic.search_keywords : []),
    topic.title,
    topic.angle
  ];
  const terms = extractUsefulTerms(topic.title, topic.angle, account.content_scope, account.target_audience)
    .filter((term) => !/추천|아이템|제품|상품|실용|효율|생활|방법|루틴|소개|도움/.test(term));
  const suffixes = attempt === 1
    ? ['', ' 추천', ' 쿠팡']
    : attempt === 2
      ? [' 정리함', ' 수납함', ' 청소용품', ' 주방용품', ' 인테리어 소품']
      : [' 선물세트', ' 다용도', ' 소형', ' 자취 필수템', ' 생활용품'];
  const expanded = [];
  for (const term of terms.slice(0, 5)) {
    for (const suffix of suffixes) expanded.push(`${term}${suffix}`);
  }
  return uniqueKeywords([...base, ...expanded]);
}

async function generateRepairKeywords(topic, account, attempt, options = {}) {
  const fallback = () => ({ keywords: fallbackKeywords(topic, account, attempt) });
  if (options.useAiKeywords === false) return fallback().keywords;
  const result = await getJson([
    {
      role: 'system',
      content: 'Return strict JSON only. Generate concrete Korean Coupang product search keywords. Prefer purchasable nouns over broad concepts.'
    },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Generate product-search keywords for an affiliate post that failed to find real products.',
        attempt,
        account: {
          name: account.name,
          targetAudience: account.target_audience,
          contentScope: account.content_scope
        },
        topic: {
          title: topic.title,
          angle: topic.angle,
          searchKeywords: topic.search_keywords || []
        },
        rules: [
          'Return 5-8 concrete purchasable product keywords in Korean.',
          'Do not return broad concepts such as 생활용품, 실용적인 아이템, 가전 제품, 꿀템, 루틴, 방법.',
          'Prefer nouns a customer can buy directly on Coupang.',
          'Keep keywords inside the account content scope and target audience.'
        ],
        schema: { keywords: ['string'] }
      })
    }
  ], fallback);
  return uniqueKeywords([...(result.keywords || []), ...fallbackKeywords(topic, account, attempt)]);
}

async function listRealSelectedProducts(topicId) {
  const rows = await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true });
  const real = [];
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    if (isRealCoupangProduct(product)) real.push({ row, product });
  }
  return real;
}

export async function repairProductsForTopic(topicId, options = {}) {
  const topic = await dbGet('topics', { id: topicId });
  if (!topic) {
    return { status: 'failed', finalMode: 'no_link', attempts: [], selectedProducts: [], reasonCode: 'TOPIC_NOT_FOUND' };
  }
  const account = options.account || await getAccount(topic.account_id);
  const attemptLimit = Number(options.attemptLimit || DEFAULT_ATTEMPT_LIMIT);
  const attempts = [];

  const existing = await listRealSelectedProducts(topicId);
  if (existing.length > 0) {
    return { status: 'linked', finalMode: 'link', attempts, selectedProducts: existing.map((item) => item.row), reasonCode: null };
  }

  for (let attempt = 1; attempt <= attemptLimit; attempt += 1) {
    const keywords = await generateRepairKeywords(topic, account, attempt, options);
    const products = await searchProductsForTopic(topicId, { keywords, saveFallback: true, stopAfterRealCount: 10 });
    const selected = await selectProducts(topicId, options.postId || null);
    const realSelected = await listRealSelectedProducts(topicId);
    attempts.push({
      attempt,
      keywords,
      productsFound: products.filter((product) => !product.is_fallback).length,
      selectedCount: realSelected.length
    });

    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      topic_id: topicId,
      action: 'product_repair_attempt',
      level: realSelected.length > 0 ? 'info' : 'warn',
      message: realSelected.length > 0 ? '실상품 자동 복구 성공' : '실상품 자동 복구 재시도',
      payload: attempts[attempts.length - 1]
    });

    if (selected.length > 0 || realSelected.length > 0) {
      return {
        status: 'repaired',
        finalMode: 'link',
        attempts,
        selectedProducts: realSelected.map((item) => item.row),
        reasonCode: null
      };
    }
  }

  const fallbackProduct = await ensureFallbackProductForTopic(topicId, 'repair_failed');
  await logActivity({
    account_id: account.id,
    project_id: account.project_id,
    topic_id: topicId,
    action: 'product_repair_fallback_to_no_link',
    level: 'warn',
    message: '실상품 자동 복구 실패로 fallback 카드를 남기고 링크 없는 업로드로 전환합니다.',
    payload: {
      attempts,
      fallbackProductId: fallbackProduct?.id,
      reasonCode: 'PRODUCT_REPAIR_FALLBACK_TO_NO_LINK'
    }
  });

  return {
    status: 'fallback_to_no_link',
    finalMode: 'no_link',
    attempts,
    selectedProducts: [],
    reasonCode: 'PRODUCT_REPAIR_FALLBACK_TO_NO_LINK'
  };
}

export async function restorePostDraft(postId) {
  if (!postId) return null;
  const [updated] = await dbUpdate('posts', { id: postId }, { status: 'draft' });
  return updated || null;
}
