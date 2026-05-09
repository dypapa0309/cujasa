import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { createDailySchedulePlan } from '../utils/randomSchedule.js';
import { buildReplyText, uploadPost as uploadThreads, uploadReplyOnly } from '../platformAdapters/threadsAdapter.js';
import { createMetricJobs } from './metricsJobService.js';
import { listCtas } from './ctaService.js';
import { createTrackingLink } from './trackingService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { classifyQueueError } from './queueErrorService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';
import { assertAccountCanUpload, recordSuccessfulUpload } from './trialEntitlementService.js';
import { assertAutomationRunning, isAutomationRunning } from './accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';
import { createCoupangCooldownError, isCoupangCooldownActive, isCoupangSearchLockAvailable } from './coupangService.js';
import { sendOpsAlert } from './notificationService.js';
import { isReplyLinkModeEnabled } from '../utils/replyLinkMode.js';

const QUEUE_POSTING_STALE_MINUTES = Math.max(1, Number(process.env.QUEUE_POSTING_STALE_MINUTES || 15));
const QUEUE_POSTING_STALE_MS = QUEUE_POSTING_STALE_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REPLY_REPAIR_MAX_ATTEMPTS = 3;

function kstDayRange(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + ONE_DAY_MS);
  return { start, end };
}

function inRange(value, start, end) {
  const time = value ? new Date(value).getTime() : 0;
  return time >= start.getTime() && time < end.getTime();
}

function isLinkableCoupangProduct(product = {}) {
  return isRealCoupangProduct(product);
}

function createQueueAlreadyClaimedError(queueId, status) {
  const error = new Error(`Queue item ${queueId} is already claimed or not uploadable: ${status || 'unknown'}`);
  error.status = 409;
  error.code = 'QUEUE_ALREADY_CLAIMED';
  return error;
}

function createNoRealCoupangLinksError(message = '수익화 가능한 실제 쿠팡 상품 링크가 없어 링크 큐를 만들 수 없습니다.') {
  const error = new Error(`NO_REAL_COUPANG_LINKS: ${message}`);
  error.status = 422;
  error.code = 'NO_REAL_COUPANG_LINKS';
  error.permanent = true;
  return error;
}

function createReplyLinkRequiredError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.status = 422;
  error.code = code;
  error.permanent = true;
  return error;
}

function isReplyLinkModeRequiredQueue(row = {}) {
  const value = `${row.error_category || ''} ${row.error_message || ''}`;
  return /REPLY_LINK_MODE_REQUIRED/i.test(value);
}

function isReplyFailureQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  if (!['failed', 'retry', 'manual_required'].includes(row.status)) return false;
  if (row.error_category === 'reply_warning') return true;
  return classifyQueueError(row.error_message || '').category === 'reply_warning';
}

function canRepairReplyFailureQueue(row = {}) {
  return isReplyFailureQueue(row)
    && (row.post_mode || 'auto') === 'link'
    && Boolean(row.post_url)
    && Number(row.retry_count || 0) < REPLY_REPAIR_MAX_ATTEMPTS;
}

async function replyLinkReadiness(account) {
  if (!isReplyLinkModeEnabled() || account?.threads_link_delivery_mode !== 'reply') {
    return {
      ok: false,
      code: 'REPLY_LINK_MODE_REQUIRED',
      message: '링크 글은 댓글 링크 모드에서만 예약/업로드할 수 있습니다.'
    };
  }
  const queues = await dbList('post_queue', { account_id: account.id });
  const unresolved = queues.filter(isReplyFailureQueue);
  const blocked = unresolved.filter((row) => !canRepairReplyFailureQueue(row));
  if (blocked.length > 0) {
    return {
      ok: false,
      code: 'REPLY_LINK_FAILURE_UNRESOLVED',
      message: '댓글 링크 실패 항목이 복구 불가 상태입니다. 수동 확인 후 다시 실행해주세요.',
      unresolvedCount: blocked.length
    };
  }
  if (unresolved.length > 0) {
    return {
      ok: true,
      code: 'REPLY_LINK_REPAIR_PENDING',
      message: '이전 댓글 링크 실패 항목은 자동 복구 대상입니다.',
      unresolvedCount: unresolved.length
    };
  }
  return { ok: true, code: null, message: null };
}

function canRecoverReplyLinkModeQueue(queue = {}, account = {}) {
  return ['manual_required', 'failed'].includes(queue.status)
    && (queue.post_mode || 'auto') === 'link'
    && account?.threads_link_delivery_mode === 'reply'
    && isReplyLinkModeRequiredQueue(queue);
}

async function getFirstLinkableProductForTopic(topicId) {
  if (!topicId) return { postProduct: null, product: null };
  const rows = await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true });
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    if (isLinkableCoupangProduct(product)) return { postProduct: row, product };
  }
  return { postProduct: null, product: null };
}

function extractThreadsPostId(postUrl = '') {
  const value = String(postUrl || '');
  const match = value.match(/\/post\/([^/?#]+)/i) || value.match(/threads\/([^/?#]+)/i);
  return match?.[1] || '';
}

async function resolveTrackingLinkForQueue(queue, post, product) {
  if (queue.tracking_link_id) {
    const existing = await dbGet('tracking_links', { id: queue.tracking_link_id }).catch(() => null);
    if (existing) return existing;
  }
  if (post?.id) {
    const existingRows = await dbList('tracking_links', { post_id: post.id }, { order: 'created_at', ascending: false, limit: 1 }).catch(() => []);
    if (existingRows[0]) return existingRows[0];
  }
  if (!product || !post) return null;
  return createTrackingLink({
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    product_id: product.id,
    destination_url: product.partner_url || product.product_url,
    link_type: 'coupang'
  });
}

async function assertRealLinkCandidateForPost(post, account, action = 'queue link post') {
  const { postProduct, product } = await getFirstLinkableProductForTopic(post.topic_id);
  if (postProduct && product) return { postProduct, product };
  await logActivity({
    account_id: post.account_id,
    project_id: post.project_id,
    topic_id: post.topic_id,
    post_id: post.id,
    action: 'link_queue_blocked_no_real_product',
    level: 'warn',
    message: '실제 쿠팡 상품 링크가 없어 링크 큐 생성을 차단했습니다.',
    payload: { code: 'NO_REAL_COUPANG_LINKS', action }
  }).catch(() => null);
  throw createNoRealCoupangLinksError('실상품 선택 후 다시 큐에 추가해주세요.');
}

async function isPostAllowedForQueue(post, account) {
  const topic = post.topic_id ? await dbGet('topics', { id: post.topic_id }) : null;
  const guardrail = validatePostCandidate(post.body, account, topic);
  if (guardrail.allowed) return true;
  await logActivity({
    account_id: post.account_id,
    project_id: post.project_id,
    topic_id: post.topic_id,
    post_id: post.id,
    action: 'queue_guardrail_skipped',
    level: 'warn',
    message: guardrail.reasons.join('; '),
    payload: { context: guardrail.context }
  });
  await dbUpdate('posts', { id: post.id }, { status: 'manual_required' });
  return false;
}

function attachQueueDiagnostics(queued, diagnostics) {
  Object.defineProperty(queued, 'diagnostics', {
    value: diagnostics,
    enumerable: false
  });
  return queued;
}

export async function addPostToQueue(postId, scheduledAt = null, options = {}) {
  const post = await dbGet('posts', { id: postId });
  if (!post) throw new Error('Post not found');
  await assertAccountOwnerCanOperate(post.account_id);
  await assertAccountCanUpload(post.account_id);
  const account = await dbGet('accounts', { id: post.account_id });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot add post to queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'add post to queue');
  if (!(await isPostAllowedForQueue(post, account))) {
    const error = new Error('Post blocked by content guardrails');
    error.status = 422;
    throw error;
  }
  const status = post.status === 'manual_required' || post.risk_level === 'high' ? 'manual_required' : 'scheduled';
  const requestedPostMode = ['link', 'no_link'].includes(options.postMode)
    ? options.postMode
    : null;
  const linkCandidate = requestedPostMode === 'no_link'
    ? { postProduct: null, product: null }
    : await assertRealLinkCandidateForPost(post, account, 'add post to queue');
  const postMode = requestedPostMode || (linkCandidate.product ? 'link' : 'no_link');
  if (postMode === 'link' && !linkCandidate.product) {
    throw createNoRealCoupangLinksError('링크 글로 큐에 추가하려면 실제 쿠팡 상품 선택이 필요합니다.');
  }
  if (postMode === 'link') {
    const reply = await replyLinkReadiness(account);
    if (!reply.ok) throw createReplyLinkRequiredError(reply.code, reply.message);
  }
  const payload = {
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: scheduledAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status,
    post_mode: postMode,
    retry_count: 0
  };
  try {
    return await dbInsert('post_queue', payload);
  } catch (error) {
    if (!/post_mode|schema cache|column/i.test(error.message || '')) throw error;
    const { post_mode, ...fallbackPayload } = payload;
    return dbInsert('post_queue', fallbackPayload);
  }
}

export async function createDailyQueue(accountId, options = {}) {
  await assertAccountOwnerCanOperate(accountId);
  const trialStatus = await assertAccountCanUpload(accountId);
  const account = await dbGet('accounts', { id: accountId });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot create daily queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'create daily queue');
  const lockHealth = await isCoupangSearchLockAvailable();
  if (!lockHealth.available) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_blocked_coupang_lock_unavailable',
      level: 'error',
      message: '쿠팡 검색 DB 락 테이블이 없어 일일 큐 생성을 차단했습니다.',
      payload: {
        reasonCode: 'COUPANG_LOCK_UNAVAILABLE',
        error: lockHealth.message
      }
    }).catch(() => null);
    await sendOpsAlert('daily_queue_blocked_coupang_lock_unavailable', {
      title: '일일 큐 생성 차단',
      account,
      code: 'COUPANG_LOCK_UNAVAILABLE',
      message: '쿠팡 검색 보호 락이 없어 링크 큐 생성을 차단했습니다.',
      hint: 'coupang_search_locks 마이그레이션과 DB 연결 상태를 확인하세요.'
    });
    const error = new Error('COUPANG_LOCK_UNAVAILABLE: 쿠팡 검색 보호 락이 준비되지 않아 링크 큐를 만들 수 없습니다.');
    error.status = 503;
    error.code = 'COUPANG_LOCK_UNAVAILABLE';
    throw error;
  }
  if (isCoupangCooldownActive(account)) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_blocked_coupang_cooldown',
      level: 'warn',
      message: '쿠팡 요청 제한 보호 중이라 일일 큐 생성을 차단했습니다.',
      payload: {
        reasonCode: 'COUPANG_RATE_LIMIT',
        cooldownUntil: account.coupang_search_cooldown_until
      }
    }).catch(() => null);
    await sendOpsAlert('daily_queue_blocked_coupang_cooldown', {
      title: '쿠팡 쿨다운으로 큐 생성 차단',
      account,
      code: 'COUPANG_RATE_LIMIT',
      message: '쿠팡 요청 제한 보호 중이라 일일 큐 생성을 차단했습니다.',
      hint: '쿨다운 해제 전까지 검색/자동화 재개를 피하세요.',
      payload: { cooldownUntil: account.coupang_search_cooldown_until }
    });
    throw createCoupangCooldownError(account);
  }
  if (!options.skipPreflight) {
    assertPreflightCanPublish(await preflightAccount(accountId, { includeQueue: false }));
  }
  const reply = await replyLinkReadiness(account);
  if (!reply.ok) {
    const diagnostics = {
      scheduleCount: 0,
      requiredLinkCount: 0,
      requiredNoLinkCount: 0,
      availableDraftPosts: 0,
      availableLinkPosts: 0,
      selectedLinkPosts: 0,
      queuedCount: 0,
      reasonCode: reply.code,
      message: reply.message,
      unresolvedReplyFailures: reply.unresolvedCount || 0
    };
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_blocked_reply_link_mode',
      level: 'warn',
      message: reply.message,
      payload: diagnostics
    }).catch(() => null);
    return attachQueueDiagnostics([], diagnostics);
  }
  const allDrafts = [];
  for (const post of (await dbList('posts', { account_id: accountId })).filter((p) => ['draft', 'ready'].includes(p.status))) {
    if (await isPostAllowedForQueue(post, account)) allDrafts.push(post);
  }
  const topicIds = [...new Set(allDrafts.map((p) => p.topic_id))];
  const productsPerTopic = new Set();
  for (const tid of topicIds) {
    const pp = await dbList('post_products', { topic_id: tid });
    for (const row of pp) {
      const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
      if (isRealCoupangProduct(product)) {
        productsPerTopic.add(tid);
        break;
      }
    }
  }

  const { start, end } = kstDayRange();
  const spacingQueues = (await dbList('post_queue', { account_id: accountId }))
    .filter((row) => ['scheduled', 'retry', 'posting', 'posted'].includes(row.status))
    .map((row) => row.posted_at || row.scheduled_at)
    .filter((value) => inRange(value, start, end));
  const schedulePlan = createDailySchedulePlan(account, new Date(), { blockedTimes: spacingQueues });
  const scheduleTimes = schedulePlan.times;
  const times = trialStatus?.plan === 'free'
    ? scheduleTimes.slice(0, Math.max(0, Number(trialStatus.remaining ?? scheduleTimes.length)))
    : scheduleTimes;
  const visibleSchedulePlan = {
    ...schedulePlan.diagnostics,
    actualTimes: times,
    generatedCount: times.length,
    trialCapped: times.length < scheduleTimes.length
  };
  const total = times.length;
  const linkCount = total;
  const repairOutcomes = [];
  const withLink = allDrafts.filter((p) => productsPerTopic.has(p.topic_id));

  const primaryWithLink = withLink.slice(0, total);
  const linkShortage = Math.max(0, linkCount - primaryWithLink.length);
  const drafts = primaryWithLink.map((post) => ({ post, postMode: 'link' }));
  const diagnostics = {
    scheduleCount: total,
    requiredLinkCount: linkCount,
    requiredNoLinkCount: 0,
    availableDraftPosts: allDrafts.length,
    availableLinkPosts: withLink.length,
    availableNoLinkPosts: allDrafts.length - withLink.length,
    selectedLinkPosts: primaryWithLink.length,
    selectedNoLinkPosts: 0,
    linkShortage,
    trialPlan: trialStatus?.plan || null,
    trialRemaining: trialStatus?.remaining ?? null,
    uncappedScheduleCount: scheduleTimes.length,
    blockedScheduleCount: spacingQueues.length,
    schedulePlan: visibleSchedulePlan,
    productRepairAttempts: repairOutcomes.length,
    productRepairFallbacks: repairOutcomes.filter((row) => row.finalMode === 'no_link').length,
    repairOutcomes: repairOutcomes.map((row) => ({
      postId: row.postId,
      topicId: row.topicId,
      status: row.status,
      finalMode: row.finalMode,
      reasonCode: row.reasonCode,
      attempts: row.attempts?.length || 0
    })),
    reasonCode: null
  };
  if (total === 0) diagnostics.reasonCode = 'NO_SCHEDULE_TIMES';
  else if (allDrafts.length === 0) diagnostics.reasonCode = 'NO_DRAFT_POSTS';
  else if (repairOutcomes.some((row) => row.reasonCode === 'COUPANG_RATE_LIMIT')) diagnostics.reasonCode = 'COUPANG_RATE_LIMIT';
  else if (diagnostics.productRepairFallbacks > 0) diagnostics.reasonCode = 'PRODUCT_REPAIR_FALLBACK_TO_NO_LINK';
  else if (drafts.length === 0) diagnostics.reasonCode = 'NO_REAL_COUPANG_LINKS';
  else if (linkShortage > 0) diagnostics.reasonCode = 'PARTIAL_LINK_CANDIDATES';

  if (total === 0 || allDrafts.length === 0 || drafts.length === 0) {
    diagnostics.queuedCount = 0;
    return attachQueueDiagnostics([], diagnostics);
  }

  if (linkShortage > 0) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'queue_link_slots_shortage_partial',
      level: 'info',
      message: `수익화 가능한 링크 후보 ${primaryWithLink.length}개만 예약합니다.`,
      payload: diagnostics
    });
  }
  const queued = [];
  for (const [index, item] of drafts.slice(0, times.length).entries()) {
    queued.push(await addPostToQueue(item.post.id, times[index], { postMode: item.postMode }));
    await dbUpdate('posts', { id: item.post.id }, { status: 'queued' });
  }
  diagnostics.queuedCount = queued.length;
  return attachQueueDiagnostics(queued, diagnostics);
}

export async function recoverStalePostingQueue() {
  const posting = await dbList('post_queue', { status: 'posting' });
  const cutoff = Date.now() - QUEUE_POSTING_STALE_MS;
  let recovered = 0;
  for (const row of posting) {
    const updatedAt = new Date(row.updated_at || row.created_at || 0).getTime();
    if (!updatedAt || updatedAt > cutoff) continue;

    const retry = (row.retry_count || 0) + 1;
    const status = retry >= 3 ? 'manual_required' : 'retry';
    const message = `posting 상태가 ${QUEUE_POSTING_STALE_MINUTES}분 이상 지속되어 ${status}로 복구했습니다.`;
    const classified = classifyQueueError(message);
    const [updated] = await dbUpdate('post_queue', { id: row.id, status: 'posting' }, {
      status,
      retry_count: retry,
      error_message: message,
      error_category: classified.category
    });
    if (!updated) continue;
    recovered += 1;
    await logActivity({
      account_id: row.account_id,
      project_id: row.project_id,
      topic_id: row.topic_id,
      post_id: row.post_id,
      queue_id: row.id,
      action: 'queue_posting_stale_recovered',
      level: 'warn',
      message,
      payload: { retryCount: retry, nextStatus: status, staleMinutes: QUEUE_POSTING_STALE_MINUTES }
    });
  }
  return recovered;
}

export async function repairReplyLinkFailures({ accountId = null } = {}) {
  const [queues, accounts] = await Promise.all([
    dbList('post_queue'),
    dbList('accounts')
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const targets = queues.filter((queue) => {
    if (accountId && queue.account_id !== accountId) return false;
    return canRepairReplyFailureQueue(queue);
  });
  const repaired = [];
  const failed = [];
  const skipped = [];

  for (const queue of targets) {
    const account = accountsById.get(queue.account_id);
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    const threadsPostId = extractThreadsPostId(queue.post_url);

    if (!account || account.status !== 'active' || !isAutomationRunning(account)) {
      skipped.push({ queueId: queue.id, reason: 'account_not_active_or_automation_paused' });
      continue;
    }
    if (!post || !threadsPostId) {
      skipped.push({ queueId: queue.id, reason: !post ? 'post_missing' : 'threads_post_id_missing' });
      continue;
    }

    try {
      assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false }));
      const { product } = await getFirstLinkableProductForTopic(post.topic_id);
      if (!isLinkableCoupangProduct(product)) {
        skipped.push({ queueId: queue.id, reason: 'linkable_product_missing' });
        continue;
      }
      const trackingLink = await resolveTrackingLinkForQueue(queue, post, product);
      if (!trackingLink) {
        skipped.push({ queueId: queue.id, reason: 'tracking_link_missing' });
        continue;
      }
      const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const linkMode = String(process.env.THREADS_COUPANG_LINK_MODE || 'tracking').toLowerCase();
      const linkUrl = linkMode === 'tracking' ? `${baseUrl}/r/${trackingLink.code}` : trackingLink.destination_url;
      await uploadReplyOnly({ account, postId: threadsPostId, text: buildReplyText(linkUrl) });
      let updatedRows;
      try {
        updatedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status: 'posted',
          tracking_link_id: trackingLink.id,
          error_message: null,
          error_category: null
        });
      } catch (updateError) {
        if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
        updatedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status: 'posted',
          tracking_link_id: trackingLink.id,
          error_message: null
        });
      }
      const [updated] = updatedRows;
      repaired.push(updated);
      await logActivity({
        account_id: queue.account_id,
        project_id: queue.project_id,
        topic_id: queue.topic_id,
        post_id: queue.post_id,
        queue_id: queue.id,
        action: 'reply_link_failure_repaired',
        level: 'info',
        message: '기존 Threads 게시글에 쿠팡 링크 댓글을 다시 등록했습니다.',
        payload: { postUrl: queue.post_url, threadsPostId, trackingLinkId: trackingLink.id, linkMode }
      }).catch(() => null);
    } catch (error) {
      const retry = Number(queue.retry_count || 0) + 1;
      const status = retry >= REPLY_REPAIR_MAX_ATTEMPTS ? 'manual_required' : 'retry';
      const classified = classifyQueueError(error.message || 'THREADS_REPLY_FAILED');
      try {
        await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          error_category: classified.category,
          post_url: queue.post_url || error.postUrl || null
        });
      } catch (updateError) {
        if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
        await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          post_url: queue.post_url || error.postUrl || null
        });
      }
      failed.push({ queueId: queue.id, status, retryCount: retry, error: error.message });
      await logActivity({
        account_id: queue.account_id,
        project_id: queue.project_id,
        topic_id: queue.topic_id,
        post_id: queue.post_id,
        queue_id: queue.id,
        action: 'reply_link_failure_repair_failed',
        level: retry >= REPLY_REPAIR_MAX_ATTEMPTS ? 'error' : 'warn',
        message: error.message,
        payload: { retryCount: retry, nextStatus: status, maxAttempts: REPLY_REPAIR_MAX_ATTEMPTS }
      }).catch(() => null);
    }
  }

  return {
    ok: failed.length === 0,
    targetCount: targets.length,
    repairedCount: repaired.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    repaired,
    failed,
    skipped
  };
}

export async function processDueQueue() {
  await recoverStalePostingQueue();
  await recoverReplyLinkModeRequiredQueues();
  await repairReplyLinkFailures();
  const [scheduled, retrying] = await Promise.all([
    dbList('post_queue', { status: 'scheduled' }),
    dbList('post_queue', { status: 'retry' })
  ]);
  const rows = [...scheduled, ...retrying];
  const activeAccounts = await dbList('accounts', { status: 'active' });
  const activeAccountIds = new Set(activeAccounts.filter(isAutomationRunning).map((account) => account.id));
  const due = rows.filter((row) => activeAccountIds.has(row.account_id) && new Date(row.scheduled_at) <= new Date());
  for (const row of due) {
    try {
      await uploadQueueItem(row.id);
    } catch (error) {
      if (error.code !== 'QUEUE_ALREADY_CLAIMED') {
        console.error('[processDueQueue] queue item failed', { queueId: row.id, error: error.message });
      }
    }
  }
  return due.length;
}

export async function rescheduleTodayQueue({ accountId = null } = {}) {
  const { start, end } = kstDayRange();
  const [accounts, queue] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue')
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const todayRows = queue.filter((row) => {
    if (accountId && row.account_id !== accountId) return false;
    return inRange(row.scheduled_at || row.posted_at, start, end);
  });
  const targetsByAccount = new Map();
  for (const row of todayRows.filter((item) => item.status === 'scheduled')) {
    targetsByAccount.set(row.account_id, [...(targetsByAccount.get(row.account_id) || []), row]);
  }

  const results = [];
  for (const [targetAccountId, targets] of targetsByAccount.entries()) {
    const account = accountsById.get(targetAccountId);
    if (!account) continue;
    const targetIds = new Set(targets.map((row) => row.id));
    const blockedTimes = todayRows
      .filter((row) => row.account_id === targetAccountId && !targetIds.has(row.id))
      .filter((row) => ['posted', 'posting', 'retry'].includes(row.status))
      .map((row) => row.posted_at || row.scheduled_at)
      .filter(Boolean);
    const plan = createDailySchedulePlan({
      ...account,
      daily_post_max: targets.length
    }, new Date(), {
      blockedTimes,
      rollPastToNextDay: false
    });
    const sortedTargets = targets.slice().sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const updated = [];
    for (const [index, row] of sortedTargets.entries()) {
      const scheduledAt = plan.times[index];
      if (!scheduledAt) break;
      const [next] = await dbUpdate('post_queue', { id: row.id, status: 'scheduled' }, { scheduled_at: scheduledAt });
      if (next) updated.push(next);
    }
    await logActivity({
      account_id: targetAccountId,
      project_id: account.project_id,
      action: 'today_queue_rescheduled',
      level: 'info',
      message: `오늘 예약 ${updated.length}건을 09-23시 랜덤 분산으로 재배치했습니다.`,
      payload: { diagnostics: plan.diagnostics, targetCount: targets.length, updatedCount: updated.length }
    }).catch(() => null);
    results.push({
      accountId: targetAccountId,
      accountName: account.name,
      targetCount: targets.length,
      updatedCount: updated.length,
      diagnostics: plan.diagnostics,
      times: updated.map((row) => row.scheduled_at)
    });
  }

  return {
    ok: true,
    accountCount: results.length,
    updatedCount: results.reduce((sum, row) => sum + row.updatedCount, 0),
    results
  };
}

export async function recoverReplyLinkModeRequiredQueues({ accountId = null } = {}) {
  const [queues, accounts] = await Promise.all([
    dbList('post_queue'),
    dbList('accounts')
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const nowIso = new Date().toISOString();
  const recovered = [];
  const skipped = [];

  for (const queue of queues) {
    if (accountId && queue.account_id !== accountId) continue;
    const account = accountsById.get(queue.account_id);
    if (!canRecoverReplyLinkModeQueue(queue, account)) continue;
    if (account?.status !== 'active' || !isAutomationRunning(account)) {
      skipped.push({ queueId: queue.id, reason: 'account_not_active_or_automation_paused' });
      continue;
    }
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    if (!post) {
      skipped.push({ queueId: queue.id, reason: 'post_missing' });
      continue;
    }
    try {
      assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false }));
      const { product } = await getFirstLinkableProductForTopic(post.topic_id);
      if (!isLinkableCoupangProduct(product)) {
        skipped.push({ queueId: queue.id, reason: 'linkable_product_missing' });
        continue;
      }
    } catch (error) {
      skipped.push({ queueId: queue.id, reason: 'preflight_failed', message: error.message });
      continue;
    }

    const scheduledAt = new Date(queue.scheduled_at || 0).getTime() <= Date.now()
      ? nowIso
      : queue.scheduled_at;
    const [updated] = await dbUpdate('post_queue', { id: queue.id }, {
      status: 'retry',
      scheduled_at: scheduledAt,
      error_message: null,
      error_category: null
    });
    if (!updated) continue;
    recovered.push(updated);
    await logActivity({
      account_id: queue.account_id,
      project_id: queue.project_id,
      topic_id: queue.topic_id,
      post_id: queue.post_id,
      queue_id: queue.id,
      action: 'reply_link_mode_queue_recovered',
      level: 'info',
      message: '댓글 링크 모드 설정 누락으로 막힌 큐를 재시도 가능 상태로 복구했습니다.',
      payload: { previousStatus: queue.status, scheduledAt }
    }).catch(() => null);
  }

  return {
    ok: true,
    recoveredCount: recovered.length,
    skippedCount: skipped.length,
    recovered,
    skipped
  };
}

export async function uploadQueueItem(queueId) {
  const queue = await dbGet('post_queue', { id: queueId });
  if (!queue) {
    const error = new Error('Queue item not found');
    error.status = 404;
    throw error;
  }
  const account = await dbGet('accounts', { id: queue.account_id });
  const post = await dbGet('posts', { id: queue.post_id });
  if (canRepairReplyFailureQueue(queue)) {
    await repairReplyLinkFailures({ accountId: queue.account_id });
    return dbGet('post_queue', { id: queueId });
  }
  if (!isAutomationRunning(account)) {
    const error = new Error('자동화가 중지되어 업로드를 보류했습니다.');
    error.status = 409;
    error.code = 'AUTOMATION_PAUSED';
    throw error;
  }
  const recoverableManualRequired = canRecoverReplyLinkModeQueue(queue, account);
  if (!['scheduled', 'retry'].includes(queue.status) && !recoverableManualRequired) {
    throw createQueueAlreadyClaimedError(queueId, queue.status);
  }
  const [claimed] = await dbUpdate('post_queue', { id: queueId, status: queue.status }, {
    status: 'posting',
    error_message: recoverableManualRequired ? null : queue.error_message,
    error_category: recoverableManualRequired ? null : queue.error_category
  });
  if (!claimed) {
    throw createQueueAlreadyClaimedError(queueId, queue.status);
  }
  let trackingLinkForFailure = queue.tracking_link_id || null;
  try {
    await assertAccountOwnerCanOperate(queue.account_id);
    await assertAccountCanUpload(queue.account_id);
    if (!post) {
      const error = new Error('Post not found for queue item');
      error.permanent = true;
      throw error;
    }
    if (account?.status !== 'active') {
      await logActivity({ account_id: queue.account_id, project_id: queue.project_id, post_id: queue.post_id, action: 'upload_skipped_inactive_account', level: 'warn', message: account?.status || 'missing' });
      return (await dbUpdate('post_queue', { id: queueId }, { status: 'skipped', error_message: `Account is ${account?.status || 'missing'}` }))[0];
    }
    assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false }));
    const { product } = await getFirstLinkableProductForTopic(post.topic_id);
    // retry 시 기존 tracking_link 재사용 — 중복 생성 방지
    const existingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const postMode = queue.post_mode || 'auto';
    let requiresLink = postMode === 'link' || (postMode === 'auto' && isLinkableCoupangProduct(product));
    const resolvedPostMode = requiresLink ? 'link' : 'no_link';
    if (postMode !== resolvedPostMode) {
      await dbUpdate('post_queue', { id: queueId }, { post_mode: resolvedPostMode }).catch(() => []);
    }
    if (requiresLink) {
      const reply = await replyLinkReadiness(account);
      if (!reply.ok) throw createReplyLinkRequiredError(reply.code, reply.message);
    }
    const ctas = requiresLink ? await listCtas(post.id) : [];
    const cta = requiresLink ? (ctas[Math.floor(Math.random() * Math.max(1, ctas.length))] || null) : null;
    if (requiresLink && !isLinkableCoupangProduct(product)) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글로 예약됐지만 연결 가능한 쿠팡 상품이 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const trackingLink = requiresLink ? (existingLink || (product ? await createTrackingLink({
      project_id: post.project_id,
      account_id: post.account_id,
      topic_id: post.topic_id,
      post_id: post.id,
      product_id: product.id,
      destination_url: product.partner_url || product.product_url,
      link_type: 'coupang'
    }) : null)) : null;
    trackingLinkForFailure = trackingLink?.id || trackingLinkForFailure;
    if (requiresLink && !trackingLink) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글의 트래킹 링크를 만들 수 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const uploaded = await uploadThreads({ account, post, cta, trackingLink });
    let postedRows;
    try {
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl,
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id,
        error_message: null,
        error_category: null
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl,
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id,
        error_message: null
      });
    }
    const [updated] = postedRows;
    await dbUpdate('posts', { id: post.id }, { status: 'posted' });
    await recordSuccessfulUpload(account.id);
    await createMetricJobs(updated);
    await logActivity({ account_id: account.id, project_id: account.project_id, post_id: post.id, action: 'upload_completed', message: uploaded.postUrl });
    if (uploaded.raw?.replyWarning) {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'upload_reply_failed',
        level: 'warn',
        message: uploaded.raw.replyWarning,
        payload: { postUrl: uploaded.postUrl }
      });
    }
    return updated;
  } catch (error) {
    const retry = (queue.retry_count || 0) + 1;
    const status = error.permanent || retry >= 3 ? 'manual_required' : 'retry';
    const classified = classifyQueueError(error.message);
    if (error.code === 'THREADS_TOKEN_INVALID' || error.code === 'THREADS_TOKEN_MISSING') {
      await dbUpdate('accounts', { id: queue.account_id }, { threads_token_status: 'refresh_failed' });
    }
    let updatedRows;
    try {
      updatedRows = await dbUpdate('post_queue', { id: queueId }, {
        status,
        retry_count: retry,
        error_message: error.message,
        error_category: classified.category,
        post_url: error.postUrl || queue.post_url || null,
        tracking_link_id: trackingLinkForFailure
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      updatedRows = await dbUpdate('post_queue', { id: queueId }, { status, retry_count: retry, error_message: error.message });
    }
    const [updated] = updatedRows;
    await logActivity({ account_id: queue.account_id, project_id: queue.project_id, action: 'upload_failed', level: 'error', message: error.message });
    await sendOpsAlert(status === 'manual_required' ? 'queue_manual_required' : 'queue_upload_failed', {
      title: status === 'manual_required' ? '큐 수동 검토 전환' : '큐 업로드 실패',
      account,
      code: error.code || classified.category || 'UPLOAD_FAILED',
      message: error.message,
      hint: status === 'manual_required' ? '관리자 큐에서 상세 오류와 링크/토큰 상태를 확인하세요.' : '재시도 예정입니다. 반복되면 수동 검토로 전환됩니다.',
      payload: {
        queueId,
        postId: queue.post_id,
        nextStatus: status,
        retryCount: retry,
        errorCategory: classified.category
      }
    });
    return updated;
  }
}
