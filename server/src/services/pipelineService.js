import { getAccount, listAccounts } from './accountService.js';
import { generateTopics } from './topicService.js';
import { searchProductsForTopic } from './coupangService.js';
import { selectProducts } from './productSelectionService.js';
import { generatePosts } from './contentService.js';
import { createDailyQueue } from './schedulerService.js';
import { generateBlogPost } from './blogService.js';
import { logActivity } from './supabaseService.js';
import { finishPipelineRun, getRunningPipeline, startPipelineRun } from './pipelineRunService.js';

export async function runPipelineForAccount(accountId, options = {}) {
  const account = await getAccount(accountId);
  const run = await startPipelineRun(account, options.requestedBy || 'manual');
  const result = { accountId: account.id, accountName: account.name, steps: {} };
  try {
    const topics = await generateTopics(account.id);
    result.steps.topics = topics.length;
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topics_generated', message: `${topics.length}개 주제 생성` });

    let totalPosts = 0;
    for (const topic of topics) {
      try {
        await searchProductsForTopic(topic.id);
        await selectProducts(topic.id);
        const posts = await generatePosts(topic.id);
        totalPosts += posts.length;
        try { await generateBlogPost(topic.id); } catch {}
      } catch (err) {
        await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topic_failed', level: 'warn', message: `topic ${topic.id}: ${err.message}` });
      }
    }
    result.steps.posts = totalPosts;

    const queued = await createDailyQueue(account.id);
    result.steps.queued = queued.length;
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_queue_created', message: `${queued.length}개 예약 완료` });

    result.status = 'ok';
    await finishPipelineRun(run.id, 'completed', { result });
  } catch (err) {
    result.status = 'error';
    result.error = err.message;
    await finishPipelineRun(run.id, 'failed', { result, error_message: err.message });
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_failed', level: 'error', message: err.message });
  }
  return result;
}

export async function runFullPipeline(options = {}) {
  const accounts = (await listAccounts()).filter((a) => a.status === 'active');
  const results = [];
  for (const account of accounts) {
    const running = await getRunningPipeline(account.id);
    if (running) {
      results.push({
        accountId: account.id,
        accountName: account.name,
        status: 'skipped',
        reason: 'already_running',
        pipelineRunId: running.id
      });
      continue;
    }
    try {
      results.push(await runPipelineForAccount(account.id, { requestedBy: options.requestedBy || 'full_pipeline' }));
    } catch (err) {
      if (err.status === 409) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          status: 'skipped',
          reason: 'already_running',
          error: err.message
        });
        continue;
      }
      throw err;
    }
  }
  return results;
}
