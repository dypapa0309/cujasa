import { listAccounts } from './accountService.js';
import { generateTopics } from './topicService.js';
import { searchProductsForTopic } from './coupangService.js';
import { selectProducts } from './productSelectionService.js';
import { generatePosts } from './contentService.js';
import { createDailyQueue } from './schedulerService.js';
import { logActivity } from './supabaseService.js';

export async function runFullPipeline() {
  const accounts = (await listAccounts()).filter((a) => a.status === 'active');
  const results = [];

  for (const account of accounts) {
    const result = { accountId: account.id, accountName: account.name, steps: {} };
    try {
      // 1. 주제 생성
      const topics = await generateTopics(account.id);
      result.steps.topics = topics.length;
      await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topics_generated', message: `${topics.length}개 주제 생성` });

      // 2. 각 주제별 상품 검색 → 선택 → 콘텐츠 생성
      let totalPosts = 0;
      for (const topic of topics) {
        try {
          await searchProductsForTopic(topic.id);
          await selectProducts(topic.id);
          const posts = await generatePosts(topic.id);
          totalPosts += posts.length;
        } catch (err) {
          await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topic_failed', level: 'warn', message: `topic ${topic.id}: ${err.message}` });
        }
      }
      result.steps.posts = totalPosts;

      // 3. 일일 큐 생성 (랜덤 시간 예약)
      const queued = await createDailyQueue(account.id);
      result.steps.queued = queued.length;
      await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_queue_created', message: `${queued.length}개 예약 완료` });

      result.status = 'ok';
    } catch (err) {
      result.status = 'error';
      result.error = err.message;
      await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_failed', level: 'error', message: err.message });
    }

    results.push(result);
  }

  return results;
}
