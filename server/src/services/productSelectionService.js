import { getJson } from './openaiService.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { selectProductsPrompt } from '../prompts/selectProductsPrompt.js';
import { getAccount } from './accountService.js';
import { validateProductCandidate } from '../utils/contentGuardrails.js';
import { buildDiverseProductSelection, enrichProductsWithDiversity, getProductGroup } from '../utils/productDiversity.js';

export async function selectProducts(topicId, postId = null) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await getAccount(topic.account_id);
  const candidates = await dbList('coupang_products', { topic_id: topicId });
  const products = [];
  for (const product of candidates) {
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
  if (products.length === 0) return [];
  const diverseProducts = enrichProductsWithDiversity(products);
  const fallback = () => ({
    selectedProducts: buildDiverseProductSelection([], diverseProducts, topic, 3).selected.map(({ product, item }) => ({
      ...item,
      productId: product.product_id,
      productGroup: getProductGroup(product)
    }))
  });
  const result = await getJson(selectProductsPrompt(topic, diverseProducts, account), fallback);
  const repairedSelection = buildDiverseProductSelection(result.selectedProducts || [], diverseProducts, topic, 3);
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
  for (const [index, { product, item }] of repairedSelection.selected.entries()) {
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
