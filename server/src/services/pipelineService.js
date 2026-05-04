import { getAccount, listAccounts } from './accountService.js';
import { generateTopics } from './topicService.js';
import { searchProductsForTopic } from './coupangService.js';
import { selectProducts } from './productSelectionService.js';
import { generatePosts } from './contentService.js';
import { createDailyQueue } from './schedulerService.js';
import { generateBlogPost } from './blogService.js';
import { logActivity } from './supabaseService.js';
import { finishPipelineRun, getRunningPipeline, startPipelineRun, updatePipelineRunProgress } from './pipelineRunService.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';

export async function runPipelineForAccount(accountId, options = {}) {
  const account = await getAccount(accountId);
  await assertAccountOwnerCanOperate(account.id);
  const preflight = await preflightAccount(account.id);
  assertPreflightCanPublish(preflight);
  const run = await startPipelineRun(account, options.requestedBy || 'manual');
  const preflightWarnings = (preflight.checks || [])
    .filter((check) => check.status === 'warn')
    .map((check) => ({
      key: check.key,
      title: check.title,
      message: check.message,
      action: check.action || null
    }));
  const result = {
    ok: null,
    accountId: account.id,
    accountName: account.name,
    steps: {},
    warnings: preflightWarnings,
    percent: 0,
    stage: 'starting',
    label: '예약 작업을 준비하고 있습니다'
  };
  const progress = async (patch) => {
    Object.assign(result, patch);
    await updatePipelineRunProgress(run.id, {
      accountId: account.id,
      accountName: account.name,
      steps: result.steps,
      ...patch
    });
  };
  try {
    await progress({ percent: 5, stage: 'starting', label: '예약 작업을 준비하고 있습니다' });
    await progress({ percent: 7, stage: 'preflight', label: '계정 연결 상태를 점검하고 있습니다' });

    await progress({ percent: 10, stage: 'topics', label: '주제를 생성하고 있습니다' });
    const topics = await generateTopics(account.id);
    result.steps.topics = topics.length;
    await progress({ percent: 20, stage: 'topics_done', label: `${topics.length}개 주제를 생성했습니다`, topicsTotal: topics.length, topicsDone: 0 });
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topics_generated', message: `${topics.length}개 주제 생성` });

    let totalPosts = 0;
    const totalTopics = Math.max(topics.length, 1);
    for (const [index, topic] of topics.entries()) {
      const basePercent = 25 + Math.round((index / totalTopics) * 55);
      try {
        await progress({
          percent: basePercent,
          stage: 'products',
          label: `상품을 검색하고 있습니다 (${index + 1}/${topics.length})`,
          topicsTotal: topics.length,
          topicsDone: index,
          postsCreated: totalPosts
        });
        await searchProductsForTopic(topic.id);
        await progress({
          percent: Math.min(80, basePercent + 8),
          stage: 'select_products',
          label: `상품 후보를 고르고 있습니다 (${index + 1}/${topics.length})`,
          topicsTotal: topics.length,
          topicsDone: index,
          postsCreated: totalPosts
        });
        await selectProducts(topic.id);
        await progress({
          percent: Math.min(80, basePercent + 14),
          stage: 'posts',
          label: `콘텐츠를 작성하고 있습니다 (${index + 1}/${topics.length})`,
          topicsTotal: topics.length,
          topicsDone: index,
          postsCreated: totalPosts
        });
        const posts = await generatePosts(topic.id);
        totalPosts += posts.length;
        await progress({
          percent: Math.min(80, basePercent + 18),
          stage: 'topic_done',
          label: `콘텐츠 ${totalPosts}개 생성 중`,
          topicsTotal: topics.length,
          topicsDone: index + 1,
          postsCreated: totalPosts
        });
        try { await generateBlogPost(topic.id); } catch {}
      } catch (err) {
        await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topic_failed', level: 'warn', message: `topic ${topic.id}: ${err.message}` });
      }
    }
    result.steps.posts = totalPosts;
    await progress({ percent: 85, stage: 'posts_done', label: `${totalPosts}개 콘텐츠를 준비했습니다`, topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts });

    await progress({ percent: 90, stage: 'queue', label: '예약 큐에 등록하고 있습니다', topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts });
    const queued = await createDailyQueue(account.id);
    result.steps.queued = queued.length;
    result.topicsCount = topics.length;
    result.postsCount = totalPosts;
    result.queuedCount = queued.length;
    await progress({ percent: 100, stage: 'completed', label: `${queued.length}개 예약이 완료됐습니다`, topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts, queuedCount: queued.length });
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_queue_created', message: `${queued.length}개 예약 완료` });

    result.ok = true;
    result.status = 'ok';
    await finishPipelineRun(run.id, 'completed', { result });
  } catch (err) {
    const failedStage = result.stage || 'pipeline';
    result.ok = false;
    result.status = 'error';
    result.code = err.code || err.error || 'PIPELINE_FAILED';
    result.error = err.message;
    result.message = err.message || '예약 작업 중 오류가 발생했습니다.';
    result.percent = Math.max(Number(result.percent || 0), 1);
    result.stage = failedStage;
    result.failedStage = failedStage;
    result.label = '예약 작업 중 오류가 발생했습니다';
    result.blocking = err.preflight?.checks?.filter((check) => check.status === 'error') || [];
    await finishPipelineRun(run.id, 'failed', { result, error_message: result.message });
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_failed', level: 'error', message: result.message });
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
      const preflight = await preflightAccount(account.id);
      if (!preflight.canPublish) {
        const first = preflight.checks.find((check) => check.status === 'error');
        results.push({
          accountId: account.id,
          accountName: account.name,
          status: 'skipped',
          reason: first?.message || 'preflight_failed',
          preflight
        });
        continue;
      }
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
