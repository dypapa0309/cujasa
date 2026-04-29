import { getJson } from './openaiService.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { selectProductsPrompt } from '../prompts/selectProductsPrompt.js';
import { getAccount } from './accountService.js';
import { validateProductCandidate } from '../utils/contentGuardrails.js';

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
  const fallback = {
    selectedProducts: products.slice(0, 3).map((p, i) => ({
      productId: p.product_id,
      fitScore: 90 - i * 5,
      reason: `${topic.angle}와 자연스럽게 연결됨`,
      recommendedUse: '댓글 링크용'
    }))
  };
  if (products.length === 0) return [];
  const result = await getJson(selectProductsPrompt(topic, products, account), fallback);
  const selected = [];
  for (const [index, item] of (result.selectedProducts || []).slice(0, 3).entries()) {
    const product = products.find((p) => p.product_id === String(item.productId));
    if (!product) continue;
    selected.push(await dbInsert('post_products', {
      post_id: postId,
      topic_id: topicId,
      product_id: product.id,
      fit_score: item.fitScore,
      recommendation_reason: item.reason,
      rank: index + 1
    }));
  }
  return selected;
}
