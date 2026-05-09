import { getJson } from './openaiService.js';
import { dbDelete, dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { selectProductsPrompt } from '../prompts/selectProductsPrompt.js';
import { getAccount } from './accountService.js';
import { validateProductCandidate } from '../utils/contentGuardrails.js';
import {
  buildDiverseProductSelection,
  enrichProductsWithDiversity,
  getProductGroup,
  scoreProductTopicRelevance
} from '../utils/productDiversity.js';
import { isRealCoupangProduct, realProductIssues } from '../utils/productQuality.js';
import { validateProductSelectionResponse } from '../utils/aiResponseSchemas.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';

function isSelectableProduct(product, topic, account, item = {}) {
  if (!isRealCoupangProduct(product)) return false;
  const relevance = scoreProductTopicRelevance(product, topic, account);
  const fitScore = Number(item.fitScore || 0);
  return fitScore >= 60 || relevance.score >= 20;
}

export async function selectProducts(topicId, postId = null) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await getAccount(topic.account_id);
  const candidates = await dbList('coupang_products', { topic_id: topicId });
  const products = [];
  for (const product of candidates) {
    if (!isRealCoupangProduct(product)) {
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'product_quality_blocked',
        level: 'warn',
        message: product.product_name || product.keyword || 'fallback product',
        payload: { productId: product.product_id, reasons: realProductIssues(product), code: 'NO_REAL_PRODUCTS' }
      });
      continue;
    }
    const guardrail = validateProductCandidate(product, account);
    if (guardrail.allowed) {
      products.push(product);
    } else {
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'product_guardrail_blocked',
        level: 'warn',
        message: product.product_name,
        payload: { reasons: guardrail.reasons, productId: product.product_id }
      });
    }
  }
  if (products.length === 0) {
    await logActivity({
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id,
      action: 'product_selection_no_real_products',
      level: 'warn',
      message: '실제 쿠팡 상품 후보가 없어 상품을 선택하지 않았습니다.',
      payload: { candidateCount: candidates.length, code: 'NO_REAL_PRODUCTS' }
    });
    return [];
  }
  const diverseProducts = enrichProductsWithDiversity(products);
  const performanceSignals = await buildAccountPerformanceSignals(topic.account_id);
  const fallback = () => ({
    selectedProducts: buildDiverseProductSelection([], diverseProducts, topic, 3, account).selected.map(({ product, item }) => ({
      ...item,
      productId: product.product_id,
      productGroup: getProductGroup(product)
    }))
  });
  const result = await getJson(selectProductsPrompt(topic, diverseProducts, account, performanceSignals), fallback, {
    schemaName: 'select_products',
    validate: validateProductSelectionResponse,
    logContext: {
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id
    }
  });
  const repairedSelection = buildDiverseProductSelection(result.selectedProducts || [], diverseProducts, topic, 3, account);
  const relevantSelection = repairedSelection.selected.filter(({ product, item }) => isSelectableProduct(product, topic, account, item));
  const finalSelection = relevantSelection;
  if (relevantSelection.length < repairedSelection.selected.length) {
    await logActivity({
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id,
      action: 'product_relevance_limited',
      level: 'info',
      message: '주제와 연결이 약한 상품 후보를 제외했습니다.',
      payload: {
        selectedCount: relevantSelection.length,
        rejectedCount: repairedSelection.selected.length - relevantSelection.length
      }
    });
  }
  if (relevantSelection.length === 0 && repairedSelection.selected.length > 0) {
    await logActivity({
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id,
      action: 'product_relevance_selection_empty',
      level: 'warn',
      message: '관련성 기준을 통과한 실상품이 없어 상품을 선택하지 않았습니다.',
      payload: { candidateCount: repairedSelection.selected.length }
    });
  }
  if (repairedSelection.diversityLimited) {
    await logActivity({
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id,
      action: 'product_diversity_limited',
      level: 'info',
      message: '상품 후보군이 좁아 일부 상품군이 중복 선택되었습니다.',
      payload: {
        selectedGroups: repairedSelection.selected.map(({ product }) => getProductGroup(product)),
        candidateCount: diverseProducts.length
      }
    });
  }
  const selected = [];
  const existing = await dbList('post_products', { topic_id: topicId });
  const existingProductIds = new Set(existing.map((row) => row.product_id));
  for (const [index, { product, item }] of finalSelection.entries()) {
    if (existingProductIds.has(product.id)) continue;
    selected.push(await dbInsert('post_products', {
      post_id: postId,
      topic_id: topicId,
      product_id: product.id,
      fit_score: item.fitScore || 75,
      recommendation_reason: item.reason || `${topic.angle || topic.title}와 자연스럽게 연결됨`,
      rank: index + 1
    }));
  }
  return selected;
}

export async function manuallySelectProduct(topicId, productId, options = {}) {
  const topic = await dbGet('topics', { id: topicId });
  if (!topic) {
    const error = new Error('Topic not found');
    error.status = 404;
    throw error;
  }
  const account = await getAccount(topic.account_id);
  const product = await dbGet('coupang_products', { id: productId });
  if (!product || product.topic_id !== topicId) {
    const error = new Error('Product not found for topic');
    error.status = 404;
    throw error;
  }
  if (!isRealCoupangProduct(product)) {
    const error = new Error('NO_REAL_PRODUCTS: 검색 링크 또는 품질 정보가 부족한 상품은 링크 글에 연결할 수 없습니다.');
    error.status = 422;
    error.code = 'NO_REAL_PRODUCTS';
    error.qualityIssues = realProductIssues(product);
    throw error;
  }

  const guardrail = validateProductCandidate(product, account);
  if (!guardrail.allowed) {
    const error = new Error(`Product blocked by guardrails: ${guardrail.reasons.join(', ')}`);
    error.status = 422;
    error.code = 'PRODUCT_GUARDRAIL_BLOCKED';
    throw error;
  }

  const existing = await dbList('post_products', { topic_id: topicId });
  const duplicate = existing.find((row) => row.product_id === product.id);
  if (duplicate) return duplicate;

  const relevance = scoreProductTopicRelevance(product, topic, account);
  return dbInsert('post_products', {
    post_id: options.postId || null,
    topic_id: topicId,
    product_id: product.id,
    fit_score: Math.max(60, Math.min(95, Number(options.fitScore || relevance.score + 55))),
    recommendation_reason: options.reason || `${topic.angle || topic.title}와 직접 연결되는 실제 쿠팡 상품`,
    rank: Number(options.rank || existing.length + 1)
  });
}

export async function unselectProduct(topicId, productId) {
  const topic = await dbGet('topics', { id: topicId });
  if (!topic) {
    const error = new Error('Topic not found');
    error.status = 404;
    throw error;
  }
  const selected = await dbList('post_products', { topic_id: topicId });
  const target = selected.find((row) => row.product_id === productId);
  if (!target) {
    const error = new Error('Product selection not found');
    error.status = 404;
    throw error;
  }
  const posts = await dbList('posts', { topic_id: topicId });
  const postIds = new Set(posts.map((post) => post.id));
  const queue = await dbList('post_queue', { topic_id: topicId });
  const linkedQueue = [
    ...queue,
    ...(await Promise.all([...postIds].map((postId) => dbList('post_queue', { post_id: postId })))).flat()
  ];
  const inUse = linkedQueue.some((row) => ['scheduled', 'posting', 'posted'].includes(row.status));
  if (inUse) {
    const error = new Error('이미 예약에 사용된 상품 연결은 해제할 수 없습니다.');
    error.status = 409;
    error.code = 'PRODUCT_SELECTION_IN_USE';
    throw error;
  }
  await dbDelete('post_products', { id: target.id });
  await logActivity({
    account_id: topic.account_id,
    project_id: topic.project_id,
    topic_id: topicId,
    action: 'product_selection_removed',
    level: 'info',
    message: '예약 전 상품 연결을 해제했습니다.',
    payload: { productId }
  }).catch(() => null);
  return { ok: true, removedId: target.id, topicId, productId };
}
