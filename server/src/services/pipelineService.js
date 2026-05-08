import { getAccount, listAccounts } from './accountService.js';
import { generateTopics } from './topicService.js';
import { searchProductsForTopic } from './coupangService.js';
import { selectProducts } from './productSelectionService.js';
import { generatePosts } from './contentService.js';
import { createDailyQueue } from './schedulerService.js';
import { logActivity } from './supabaseService.js';
import { finishPipelineRun, getRunningPipeline, startPipelineRun, updatePipelineRunProgress } from './pipelineRunService.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';
import { assertAutomationRunning, isAutomationRunning } from './accountAutomationService.js';
import { repairProductsForTopic } from './productRepairService.js';
import { sendOpsAlert } from './notificationService.js';

const PIPELINE_COUPANG_SEARCH_WAIT_BUDGET_MS = Math.max(0, Number(process.env.COUPANG_PIPELINE_SEARCH_WAIT_BUDGET_MS || 10 * 60 * 1000));

export function hasLinkProductsForContentGeneration(selectedProducts) {
  return Array.isArray(selectedProducts) && selectedProducts.length > 0;
}

function createNoQueueMessage(diagnostics = {}) {
  if (diagnostics.reasonCode === 'COUPANG_LOCK_UNAVAILABLE') {
    return '쿠팡 검색 보호 락이 준비되지 않아 예약을 만들지 않았습니다. 운영 DB 마이그레이션 적용 후 다시 시도해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_REAL_PRODUCTS') {
    return '실제 쿠팡 상품이 매칭된 링크 글 후보가 없어 예약을 만들지 못했습니다. 상품을 다시 검색하거나 관리자 화면에서 실상품을 직접 선택해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_REAL_COUPANG_LINKS') {
    return '오늘은 수익화 가능한 상품 링크 후보가 없어 업로드하지 않았습니다. 상품 추천 결과를 다시 확인해주세요.';
  }
  if (diagnostics.reasonCode === 'REAL_PRODUCTS_INSUFFICIENT') {
    return '링크 글 목표 개수를 채울 만큼 실제 쿠팡 상품 후보가 부족합니다. 상품 추천 결과에서 실상품을 추가로 선택해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_LINK_CANDIDATES') {
    return '쿠팡 상품이 매칭된 링크 글 후보가 없어 예약을 만들지 못했습니다. 상품 후보를 다시 생성해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_DRAFT_POSTS') {
    return '예약 가능한 초안 글이 없어 예약을 만들지 못했습니다. 콘텐츠를 다시 생성해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_QUEUE_CANDIDATES') {
    return '예약 가능한 링크 콘텐츠가 부족해 예약을 만들지 못했습니다. 상품 매칭 결과를 확인해주세요.';
  }
  if (diagnostics.reasonCode === 'NO_SCHEDULE_TIMES') {
    return '오늘 예약 가능한 시간이 없어 예약을 만들지 못했습니다. 운영 시간과 예약 개수를 확인해주세요.';
  }
  if (diagnostics.reasonCode === 'COUPANG_RATE_LIMIT') {
    return '쿠팡 요청 제한 보호 중이라 예약을 만들지 않았습니다. 쿨다운 해제 후 다시 시도해주세요.';
  }
  return '예약 큐가 0개로 생성되어 자동화 실행을 완료하지 않았습니다. 설정과 생성 결과를 확인해주세요.';
}

export async function runPipelineForAccount(accountId, options = {}) {
  const account = await getAccount(accountId);
  await assertAccountOwnerCanOperate(account.id);
  assertAutomationRunning(account, 'create reservations');
  const allowInitialLinkDiscovery = Boolean(options.allowInitialLinkDiscovery || options.mode === 'start');
  const preflight = await preflightAccount(account.id, { allowInitialLinkDiscovery });
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
    const coupangWaitStartedAt = Date.now();
    const remainingCoupangWaitBudget = () => Math.max(0, PIPELINE_COUPANG_SEARCH_WAIT_BUDGET_MS - (Date.now() - coupangWaitStartedAt));
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
        const searchedProducts = await searchProductsForTopic(topic.id, {
          waitForThrottle: true,
          throttleWaitBudgetMs: remainingCoupangWaitBudget()
        });
        if (searchedProducts.some((product) => ['COUPANG_RATE_LIMIT', 'COUPANG_LOCK_UNAVAILABLE'].includes(product.raw_data?.code))) {
          const lockUnavailable = searchedProducts.some((product) => product.raw_data?.code === 'COUPANG_LOCK_UNAVAILABLE');
          const error = new Error(lockUnavailable
            ? '쿠팡 검색 보호 락이 준비되지 않아 상품 검색과 예약 생성을 중단했습니다.'
            : '쿠팡 요청 제한 보호 중이라 상품 검색과 예약 생성을 중단했습니다.');
          error.status = lockUnavailable ? 503 : 429;
          error.code = lockUnavailable ? 'COUPANG_LOCK_UNAVAILABLE' : 'COUPANG_RATE_LIMIT';
          throw error;
        }
        await progress({
          percent: Math.min(80, basePercent + 8),
          stage: 'select_products',
          label: `상품 후보를 고르고 있습니다 (${index + 1}/${topics.length})`,
          topicsTotal: topics.length,
          topicsDone: index,
          postsCreated: totalPosts
        });
        let selectedProducts = await selectProducts(topic.id);
        if (!hasLinkProductsForContentGeneration(selectedProducts)) {
          const repair = await repairProductsForTopic(topic.id, {
            account,
            waitForThrottle: true,
            throttleWaitBudgetMs: remainingCoupangWaitBudget()
          });
          if (repair.reasonCode === 'COUPANG_RATE_LIMIT') {
            const error = new Error('쿠팡 요청 제한 보호 중이라 상품 복구와 예약 생성을 중단했습니다.');
            error.status = 429;
            error.code = 'COUPANG_RATE_LIMIT';
            throw error;
          }
          if (repair.reasonCode === 'COUPANG_LOCK_UNAVAILABLE') {
            const error = new Error('쿠팡 검색 보호 락이 준비되지 않아 상품 복구와 예약 생성을 중단했습니다.');
            error.status = 503;
            error.code = 'COUPANG_LOCK_UNAVAILABLE';
            throw error;
          }
          selectedProducts = repair.selectedProducts || [];
        }
        if (!hasLinkProductsForContentGeneration(selectedProducts)) {
          await logActivity({
            account_id: account.id,
            project_id: account.project_id,
            topic_id: topic.id,
            action: 'pipeline_topic_skipped_no_link_product',
            level: 'info',
            message: '실제 쿠팡 상품 링크 후보가 없어 콘텐츠 생성을 건너뜁니다.',
            payload: {
              code: 'NO_REAL_COUPANG_LINKS',
              topicIndex: index + 1,
              topicsTotal: topics.length
            }
          });
          continue;
        }
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
      } catch (err) {
        if (err.code === 'COUPANG_RATE_LIMIT') throw err;
        await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_topic_failed', level: 'warn', message: `topic ${topic.id}: ${err.message}` });
      }
    }
    result.steps.posts = totalPosts;
    await progress({ percent: 85, stage: 'posts_done', label: `${totalPosts}개 콘텐츠를 준비했습니다`, topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts });

    await progress({ percent: 90, stage: 'queue', label: '예약 큐에 등록하고 있습니다', topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts });
    const queued = await createDailyQueue(account.id, { skipPreflight: allowInitialLinkDiscovery });
    result.steps.queued = queued.length;
    result.topicsCount = topics.length;
    result.postsCount = totalPosts;
    result.queuedCount = queued.length;
    result.queueDiagnostics = queued.diagnostics || null;
    if (queued.length === 0) {
      const message = createNoQueueMessage(queued.diagnostics);
      const noLinkCandidateDay = queued.diagnostics?.reasonCode === 'NO_REAL_COUPANG_LINKS';
      result.ok = noLinkCandidateDay;
      result.status = noLinkCandidateDay ? 'no_link_candidates' : 'error';
      result.code = queued.diagnostics?.reasonCode || 'NO_QUEUE_CREATED';
      result.message = message;
      result.error = message;
      await progress({
        percent: 100,
        stage: 'queue_empty',
        label: message,
        topicsTotal: topics.length,
        topicsDone: topics.length,
        postsCreated: totalPosts,
        queuedCount: 0,
        queueDiagnostics: result.queueDiagnostics,
        code: result.code,
        message
      });
      await finishPipelineRun(run.id, noLinkCandidateDay ? 'skipped' : 'failed', { result, error_message: noLinkCandidateDay ? null : message });
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        action: noLinkCandidateDay ? 'pipeline_skipped_no_link_candidates' : 'pipeline_queue_empty',
        level: noLinkCandidateDay ? 'info' : 'warn',
        message,
        payload: result.queueDiagnostics
      });
      if (!noLinkCandidateDay && !['COUPANG_RATE_LIMIT', 'COUPANG_LOCK_UNAVAILABLE'].includes(result.queueDiagnostics?.reasonCode)) {
        await sendOpsAlert('pipeline_queue_empty', {
          title: '파이프라인 예약 생성 0개',
          account,
          code: result.queueDiagnostics?.reasonCode || 'NO_QUEUE_CREATED',
          message,
          hint: '상품 추천/실상품 선택/예약 시간/초안 상태를 확인하세요.',
          payload: result.queueDiagnostics || {}
        });
      }
      return result;
    }
    await progress({ percent: 100, stage: 'completed', label: `${queued.length}개 예약이 완료됐습니다`, topicsTotal: topics.length, topicsDone: topics.length, postsCreated: totalPosts, queuedCount: queued.length, queueDiagnostics: result.queueDiagnostics });
    await logActivity({ account_id: account.id, project_id: account.project_id, action: 'pipeline_queue_created', message: `${queued.length}개 예약 완료`, payload: result.queueDiagnostics });

    result.ok = true;
    result.status = 'ok';
    result.message = `${queued.length}개 링크 예약이 완료됐습니다.`;
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
    await sendOpsAlert('pipeline_failed', {
      title: '파이프라인 실패',
      account,
      code: result.code,
      message: result.message,
      hint: '관리자 대시보드에서 pipeline run과 activity log를 확인하세요.',
      payload: { stage: result.stage, failedStage: result.failedStage }
    });
  }
  return result;
}

export async function runFullPipeline(options = {}) {
  const accounts = (await listAccounts()).filter(isAutomationRunning);
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
      const preflight = await preflightAccount(account.id, { allowInitialLinkDiscovery: true });
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
      results.push(await runPipelineForAccount(account.id, {
        requestedBy: options.requestedBy || 'full_pipeline',
        allowInitialLinkDiscovery: true
      }));
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
