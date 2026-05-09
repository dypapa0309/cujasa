import { getJson } from './openaiService.js';
import { assertAccountActive, getAccount } from './accountService.js';
import { dbInsert, dbList, logActivity } from './supabaseService.js';
import { generateTopicsPrompt } from '../prompts/generateTopicsPrompt.js';
import { isDuplicateTopic } from './similarityService.js';
import { validateTopicCandidate } from '../utils/contentGuardrails.js';
import { validateTopicsResponse } from '../utils/aiResponseSchemas.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';
import { sanitizeContentTitle } from '../utils/contentText.js';

const sampleTopics = (account) => ({
  topics: [
    {
      title: `${sanitizeContentTitle(account.content_scope || '생활용품', account)} 냄새 줄이는 법`,
      angle: '생활 속 원인부터 잡기',
      targetUser: account.target_audience || '일상 사용자',
      reason: '불편이 명확하고 상품 연결성이 높음',
      expectedIntent: 'high',
      searchKeywords: ['탈취제', '냄새 차단 용품', '방향제']
    },
    {
      title: `${sanitizeContentTitle(account.content_scope || '생활용품', account)} 정리 쉽게 하는 법`,
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
  const performanceSignals = await buildAccountPerformanceSignals(accountId);
  const generated = await getJson(generateTopicsPrompt(account, recent, performanceSignals), () => sampleTopics(account), {
    schemaName: 'generate_topics',
    validate: validateTopicsResponse,
    logContext: {
      account_id: accountId,
      project_id: account.project_id
    }
  });
  const rows = [];
  for (const topic of generated.topics || []) {
    const sanitizedTopic = {
      ...topic,
      title: sanitizeContentTitle(topic.title, account)
    };
    const guardrail = validateTopicCandidate(sanitizedTopic, account);
    if (!guardrail.allowed) {
      await logActivity({
        account_id: accountId,
        project_id: account.project_id,
        action: 'topic_guardrail_blocked',
        level: 'warn',
        message: sanitizedTopic.title,
        payload: { reasons: guardrail.reasons, context: guardrail.context }
      });
      continue;
    }
    const duplicate = isDuplicateTopic(sanitizedTopic, recent.concat(rows));
    if (duplicate.duplicate) {
      await logActivity({ account_id: accountId, project_id: account.project_id, action: 'topic_duplicate_skipped', message: sanitizedTopic.title });
      continue;
    }
    rows.push(await dbInsert('topics', {
      account_id: accountId,
      project_id: account.project_id,
      title: sanitizedTopic.title,
      angle: sanitizedTopic.angle,
      target_user: sanitizedTopic.targetUser,
      reason: sanitizedTopic.reason,
      expected_intent: sanitizedTopic.expectedIntent,
      search_keywords: sanitizedTopic.searchKeywords || [],
      status: 'new'
    }));
  }
  return rows;
}

export const listTopics = (accountId) => dbList('topics', { account_id: accountId }, { order: 'created_at' });

export async function createManualTopic(accountId, { title, angle }) {
  const account = await getAccount(accountId);
  assertAccountActive(account, 'create manual topic');
  const sanitizedTitle = sanitizeContentTitle(title, account);
  const guardrail = validateTopicCandidate({ title: sanitizedTitle, angle, searchKeywords: [] }, account);
  if (!guardrail.allowed) {
    await logActivity({
      account_id: accountId,
      project_id: account.project_id,
      action: 'manual_topic_guardrail_blocked',
      level: 'warn',
      message: sanitizedTitle,
      payload: { reasons: guardrail.reasons, context: guardrail.context }
    });
    const error = new Error(`Topic blocked by content guardrails: ${guardrail.reasons.join(', ')}`);
    error.status = 422;
    throw error;
  }
  return dbInsert('topics', {
    account_id: accountId,
    project_id: account.project_id,
    title: sanitizedTitle,
    angle: angle || null,
    search_keywords: [],
    status: 'new'
  });
}
