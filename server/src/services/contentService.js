import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';
import { checkAndRewriteRisk } from './riskService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { buildFallbackPostBody, validatePostStyleFit } from '../utils/accountStyle.js';

export async function generatePosts(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await getAccount(topic.account_id);
  const selectedRows = await dbList('post_products', { topic_id: topicId });
  const selected = (await Promise.all(selectedRows.map(async (row) => {
    const product = await dbGet('coupang_products', { id: row.product_id });
    return product ? { ...product, recommendation_reason: row.recommendation_reason, fit_score: row.fit_score, rank: row.rank } : null;
  }))).filter(Boolean);
  const fallback = {
    posts: [{
      contentType: '공감형',
      body: buildFallbackPostBody(topic, account),
      riskLevel: 'low'
    }]
  };
  const result = await getJson(generatePostsPrompt(topic, selected, account), fallback);
  const posts = [];
  for (const item of result.posts || []) {
    const risk = checkAndRewriteRisk(item.body);
    const guardrail = validatePostCandidate(risk.body, account, topic);
    if (!guardrail.allowed) {
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_guardrail_blocked',
        level: 'warn',
        message: guardrail.reasons.join('; '),
        payload: { contentType: item.contentType, body: risk.body, context: guardrail.context }
      });
      continue;
    }
    const styleFit = validatePostStyleFit(risk.body, account);
    if (!styleFit.allowed) {
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_style_blocked',
        level: 'warn',
        message: styleFit.reasons.join('; '),
        payload: { contentType: item.contentType, body: risk.body, tone: styleFit.profile.tone }
      });
      continue;
    }
    posts.push(await dbInsert('posts', {
      project_id: topic.project_id,
      account_id: topic.account_id,
      topic_id: topic.id,
      content_type: item.contentType,
      body: risk.body,
      risk_level: risk.riskLevel === 'high' ? 'high' : item.riskLevel || risk.riskLevel,
      status: risk.riskLevel === 'high' ? 'manual_required' : 'draft'
    }));
  }
  return posts;
}

export const listPosts = (accountId) => dbList('posts', { account_id: accountId }, { order: 'created_at' });
