import { getJson } from './openaiService.js';
import { assertAccountActive, getAccount } from './accountService.js';
import { dbInsert, dbList, logActivity } from './supabaseService.js';
import { generateTopicsPrompt } from '../prompts/generateTopicsPrompt.js';
import { isDuplicateTopic } from './similarityService.js';

const sampleTopics = (account) => ({
  topics: [
    {
      title: `${account.name.replace(' 꿀템', '')} 냄새 줄이는 법`,
      angle: '생활 속 원인부터 잡기',
      targetUser: account.target_audience || '일상 사용자',
      reason: '불편이 명확하고 상품 연결성이 높음',
      expectedIntent: 'high',
      searchKeywords: ['탈취제', '냄새 차단', `${account.name.replace(' 꿀템', '')} 정리용품`]
    },
    {
      title: `${account.name.replace(' 꿀템', '')} 정리 쉽게 하는 법`,
      angle: '작은 공간 수납',
      targetUser: account.target_audience || '일상 사용자',
      reason: '반복 수요가 있고 구매 의도가 높음',
      expectedIntent: 'medium',
      searchKeywords: ['수납함', '정리함', '생활용품']
    }
  ]
});

export async function generateTopics(accountId) {
  const account = await getAccount(accountId);
  assertAccountActive(account, 'generate topics');
  const recent = await dbList('topics', { account_id: accountId }, { order: 'created_at', limit: 100 });
  const generated = await getJson(generateTopicsPrompt(account), () => sampleTopics(account));
  const rows = [];
  for (const topic of generated.topics || []) {
    const duplicate = isDuplicateTopic(topic, recent.concat(rows));
    if (duplicate.duplicate) {
      await logActivity({ account_id: accountId, project_id: account.project_id, action: 'topic_duplicate_skipped', message: topic.title });
      continue;
    }
    rows.push(await dbInsert('topics', {
      account_id: accountId,
      project_id: account.project_id,
      title: topic.title,
      angle: topic.angle,
      target_user: topic.targetUser,
      reason: topic.reason,
      expected_intent: topic.expectedIntent,
      search_keywords: topic.searchKeywords || [],
      status: 'new'
    }));
  }
  return rows;
}

export const listTopics = (accountId) => dbList('topics', { account_id: accountId }, { order: 'created_at' });

export async function createManualTopic(accountId, { title, angle }) {
  const account = await getAccount(accountId);
  assertAccountActive(account, 'create manual topic');
  return dbInsert('topics', {
    account_id: accountId,
    project_id: account.project_id,
    title,
    angle: angle || null,
    search_keywords: [],
    status: 'new'
  });
}
