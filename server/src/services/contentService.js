import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';
import { checkAndRewriteRisk } from './riskService.js';

export async function generatePosts(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await getAccount(topic.account_id);
  const selected = await dbList('post_products', { topic_id: topicId });
  const fallback = {
    posts: [{
      contentType: '공감형',
      body: `${topic.title}, 생각보다 은근 스트레스다.\n\n${topic.angle}만 잘 잡아도 하루가 조금 편해진다.\n\n청소를 더 열심히 하기보다 원인을 줄이는 쪽으로 보면 좋다.`,
      riskLevel: 'low'
    }]
  };
  const result = await getJson(generatePostsPrompt(topic, selected, account), fallback);
  const posts = [];
  for (const item of result.posts || []) {
    const risk = checkAndRewriteRisk(item.body);
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
