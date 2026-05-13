import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { createDailySchedulePlan } from '../utils/randomSchedule.js';
import { buildReplyText, uploadPost as uploadThreads, uploadReplyOnly } from '../platformAdapters/threadsAdapter.js';
import { createMetricJobs } from './metricsJobService.js';
import { listCtas } from './ctaService.js';
import { createTrackingLink } from './trackingService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { classifyQueueError, normalizeQueueClassification } from './queueErrorService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';
import { assertAccountCanUpload, recordSuccessfulUpload } from './trialEntitlementService.js';
import { assertAutomationRunning, isAutomationRunning } from './accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';
import { createCoupangCooldownError, isCoupangCooldownActive, isCoupangSearchLockAvailable } from './coupangService.js';
import { sendOpsAlert } from './notificationService.js';
import { isReplyLinkModeEnabled } from '../utils/replyLinkMode.js';
import { maybeGenerateBlogPostForQueue } from './blogService.js';
import { canUseSponsoredComment, getSponsorCommentText, sponsoredCommentAlreadyQueuedToday } from './sponsorService.js';
import { evaluateProductTopicMatch } from '../utils/productMatching.js';

const QUEUE_POSTING_STALE_MINUTES = Math.max(1, Number(process.env.QUEUE_POSTING_STALE_MINUTES || 15));
const QUEUE_POSTING_STALE_MS = QUEUE_POSTING_STALE_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REPLY_REPAIR_MAX_ATTEMPTS = 3;
const REPLY_LINK_FAILURE_BLOCK_WINDOW_MS = Math.max(60 * 1000, Number(process.env.REPLY_LINK_FAILURE_BLOCK_WINDOW_MS || 6 * 60 * 60 * 1000));
const REPLY_LINK_FAILURE_BLOCK_THRESHOLD = Math.max(0, Number(process.env.REPLY_LINK_FAILURE_BLOCK_THRESHOLD || 3));

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

function calculateQueueModeCounts(total, account = {}, { allowLink = true } = {}) {
  if (total <= 0) return { linkCount: 0, noLinkCount: 0 };
  const rawLink = Number(account.link_post_ratio ?? 0.67);
  const rawNoLink = Number(account.no_link_post_ratio ?? 0.33);
  const linkRatio = Number.isFinite(rawLink) && rawLink > 0 ? rawLink : 0;
  const noLinkRatio = Number.isFinite(rawNoLink) && rawNoLink > 0 ? rawNoLink : 0;
  if (!allowLink) return { linkCount: 0, noLinkCount: total };
  const ratioTotal = linkRatio + noLinkRatio;
  if (ratioTotal <= 0) return { linkCount: total, noLinkCount: 0 };
  let linkCount = Math.round((total * linkRatio) / ratioTotal);
  if (linkRatio > 0 && linkCount === 0) linkCount = 1;
  if (noLinkRatio > 0 && total > 1 && linkCount >= total) linkCount = total - 1;
  linkCount = Math.max(0, Math.min(total, linkCount));
  return { linkCount, noLinkCount: total - linkCount };
}

function isReplyLinkModeRequiredQueue(row = {}) {
  const value = `${row.error_category || ''} ${row.error_message || ''}`;
  return /REPLY_LINK_MODE_REQUIRED/i.test(value);
}

function isReplyFailureQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  const classified = normalizeQueueClassification(row);
  const replyCategories = new Set([
    'reply_warning',
    'reply_permission_required',
    'threads_reply_target_invalid',
    'reply_repair_blocked'
  ]);
  if (!replyCategories.has(classified.category)) return false;
  if (row.status === 'posted') return Boolean(row.error_message || row.error_category);
  return ['failed', 'retry', 'manual_required'].includes(row.status);
}

function queueFailureTime(row = {}) {
  return new Date(row.updated_at || row.posted_at || row.created_at || 0).getTime() || 0;
}

function accountReconnectTime(account = {}) {
  return new Date(account.threads_connected_at || account.last_threads_refresh_at || 0).getTime() || 0;
}

function replyPermissionSupersededByReconnect(row = {}, account = {}) {
  const classified = normalizeQueueClassification(row);
  if (classified.category !== 'reply_permission_required') return false;
  if (!account?.threads_access_token || account?.threads_token_status === 'refresh_failed') return false;
  const reconnectAt = accountReconnectTime(account);
  const failedAt = queueFailureTime(row);
  return Boolean(reconnectAt && failedAt && reconnectAt > failedAt);
}

function isRepairableReplyWarningQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  if (!['failed', 'retry', 'manual_required', 'posted'].includes(row.status)) return false;
  const category = normalizeQueueClassification(row).category;
  if (category === 'retry_available') return Boolean(row.post_url);
  if (row.status === 'posted') {
    return ['reply_warning', 'reply_permission_required'].includes(category);
  }
  return isReplyFailureQueue(row);
}

function canRepairReplyFailureQueue(row = {}, account = null) {
  const classified = normalizeQueueClassification(row);
  const repairableCategory = classified.category === 'reply_warning'
    || classified.category === 'retry_available'
    || (account && replyPermissionSupersededByReconnect(row, account));
  return repairableCategory
    && isRepairableReplyWarningQueue(row)
    && ((row.post_mode || 'auto') === 'link' || Boolean(row.tracking_link_id))
    && Boolean(row.post_url)
    && Number(row.retry_count || 0) < REPLY_REPAIR_MAX_ATTEMPTS;
}

function replyBlockReason(blocked = []) {
  const categories = blocked.map((row) => normalizeQueueClassification(row).category);
  if (categories.includes('reply_permission_required')) {
    return {
      code: 'REPLY_PERMISSION_REQUIRED',
      message: 'Threads 댓글 권한 재연결 필요: 권한 확인 전까지 링크 글 예약을 막습니다.'
    };
  }
  if (categories.includes('threads_reply_target_invalid')) {
    return {
      code: 'THREADS_REPLY_TARGET_INVALID',
      message: '댓글 복구 불가 / 게시글 ID 문제: 기존 실패 큐를 수동 정리해야 링크 글 예약을 재개할 수 있습니다.'
    };
  }
  if (categories.includes('reply_repair_blocked')) {
    return {
      code: 'REPLY_REPAIR_BLOCKED',
      message: '댓글 링크 복구 불가 항목이 있습니다. 수동 확인 후 다시 실행해주세요.'
    };
  }
  return {
    code: 'REPLY_LINK_FAILURE_UNRESOLVED',
    message: '댓글 링크 실패 항목이 복구 불가 상태입니다. 수동 확인 후 다시 실행해주세요.'
  };
}

function isActiveReplyPermissionBlocker(row = {}, account = {}) {
  return normalizeQueueClassification(row).category === 'reply_permission_required'
    && !replyPermissionSupersededByReconnect(row, account);
}

function isRecentReplyFailureSpikeCandidate(row = {}) {
  const category = normalizeQueueClassification(row).category;
  if (!['reply_warning', 'reply_repair_blocked', 'threads_reply_target_invalid'].includes(category)) return false;
  const failedAt = queueFailureTime(row);
  return Boolean(failedAt && Date.now() - failedAt <= REPLY_LINK_FAILURE_BLOCK_WINDOW_MS);
}

async function markReplyRepairBlocked(queue, reason, detail = '') {
  const message = `REPLY_REPAIR_BLOCKED: 댓글 링크 복구 불가 - ${reason}${detail ? ` (${detail})` : ''}`;
  const patch = {
    status: queue.status === 'posted' ? 'posted' : 'manual_required',
    error_message: message,
    error_category: 'reply_repair_blocked',
    retry_count: Math.max(Number(queue.retry_count || 0), REPLY_REPAIR_MAX_ATTEMPTS)
  };
  const [updated] = await dbUpdate('post_queue', { id: queue.id }, patch);
  await logActivity({
    account_id: queue.account_id,
    project_id: queue.project_id,
    topic_id: queue.topic_id,
    post_id: queue.post_id,
    queue_id: queue.id,
    action: 'reply_link_repair_blocked',
    level: 'warn',
    message,
    payload: { reason, detail, previousStatus: queue.status }
  }).catch(() => null);
  return updated || { ...queue, ...patch };
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
  const failures = queues.filter(isReplyFailureQueue);
  const permissionBlockers = failures.filter((row) => isActiveReplyPermissionBlocker(row, account));
  if (permissionBlockers.length > 0) {
    const reason = replyBlockReason(permissionBlockers);
    return {
      ok: false,
      code: reason.code,
      message: reason.message,
      unresolvedCount: permissionBlockers.length
    };
  }
  const repairable = failures.filter((row) => canRepairReplyFailureQueue(row, account));
  const recentHardFailures = failures
    .filter((row) => !canRepairReplyFailureQueue(row, account))
    .filter(isRecentReplyFailureSpikeCandidate);
  if (REPLY_LINK_FAILURE_BLOCK_THRESHOLD > 0 && recentHardFailures.length >= REPLY_LINK_FAILURE_BLOCK_THRESHOLD) {
    return {
      ok: false,
      code: 'REPLY_LINK_FAILURE_SPIKE',
      message: '최근 댓글 링크 실패가 반복되어 잠시 링크 글 업로드를 보류합니다. 복구/정리 후 다시 실행해주세요.',
      unresolvedCount: recentHardFailures.length
    };
  }
  if (repairable.length > 0) {
    return {
      ok: true,
      code: 'REPLY_LINK_REPAIR_PENDING',
      message: '이전 댓글 링크 실패 항목은 자동 복구 대상입니다.',
      unresolvedCount: repairable.length
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

function isAutomationStudioPost(post = {}) {
  return post?.metadata?.source === 'automation_studio'
    || String(post?.content_type || '').startsWith('automation_studio_');
}

async function getAutomationStudioQueueLink(queueId) {
  if (!queueId) return null;
  const [link] = await dbList('automation_studio_queue_links', { queue_id: queueId }).catch(() => []);
  return link || null;
}

async function syncAutomationStudioQueueLink(queueId, status) {
  const link = await getAutomationStudioQueueLink(queueId);
  if (!link) return null;
  const linkStatus = status === 'posted'
    ? 'posted'
    : status === 'skipped'
      ? 'stopped'
      : status;
  return dbUpdate('automation_studio_queue_links', { id: link.id }, { status: linkStatus }).catch(() => null);
}

function canSkipMonetizationPreflight({ queue = {}, post = {}, automationLink = null } = {}) {
  return Boolean(automationLink || isAutomationStudioPost(post))
    && (queue.post_mode || 'auto') === 'no_link';
}

function fallbackThreadsPostUrl(account = {}, postId = '') {
  const id = String(postId || '').trim();
  if (!id) return '';
  const handle = String(account.account_handle || account.name || 'unknown').replace(/^@/, '').trim() || 'unknown';
  return `https://www.threads.net/@${handle}/post/${id}`;
}

async function getFirstLinkableProductForTopic(topicId) {
  if (!topicId) return { postProduct: null, product: null };
  const topic = await dbGet('topics', { id: topicId });
  const account = topic?.account_id ? await dbGet('accounts', { id: topic.account_id }) : null;
  const rows = await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true });
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    const match = product && topic && account ? evaluateProductTopicMatch(product, topic, account) : { linkable: isLinkableCoupangProduct(product) };
    if (isLinkableCoupangProduct(product) && match.linkable) return { postProduct: row, product, match };
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
  if (post.metadata?.qualityGate?.passed === false) {
    await logActivity({
      account_id: post.account_id,
      project_id: post.project_id,
      topic_id: post.topic_id,
      post_id: post.id,
      action: 'queue_quality_gate_skipped',
      level: 'warn',
      message: (post.metadata.qualityGate.reasons || ['품질 기준 미달']).join('; '),
      payload: { qualityGate: post.metadata.qualityGate }
    });
    await dbUpdate('posts', { id: post.id }, { status: 'manual_required' });
    return false;
  }
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
  const requestedPostMode = ['link', 'no_link', 'sponsored_comment'].includes(options.postMode)
    ? options.postMode
    : null;
  const linkCandidate = ['no_link', 'sponsored_comment'].includes(requestedPostMode)
    ? { postProduct: null, product: null }
    : await assertRealLinkCandidateForPost(post, account, 'add post to queue');
  const postMode = requestedPostMode || (linkCandidate.product ? 'link' : 'no_link');
  if (postMode === 'link' && !linkCandidate.product) {
    throw createNoRealCoupangLinksError('링크 글로 큐에 추가하려면 실제 쿠팡 상품 선택이 필요합니다.');
  }
  if (postMode === 'link' && !options.skipReplyReadiness) {
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
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_link_posts_blocked_reply_link_mode',
      level: 'warn',
      message: reply.message,
      payload: {
        reasonCode: reply.code,
        message: reply.message,
        unresolvedReplyFailures: reply.unresolvedCount || 0
      }
    }).catch(() => null);
  }
  const allDrafts = [];
  for (const post of (await dbList('posts', { account_id: accountId })).filter((p) => ['draft', 'ready'].includes(p.status))) {
    if (await isPostAllowedForQueue(post, account)) allDrafts.push(post);
  }
  const topicIds = [...new Set(allDrafts.map((p) => p.topic_id))];
  const productsPerTopic = new Set();
  for (const tid of topicIds) {
    const topic = await dbGet('topics', { id: tid });
    const pp = await dbList('post_products', { topic_id: tid });
    for (const row of pp) {
      const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
      const match = product && topic ? evaluateProductTopicMatch(product, topic, account) : { linkable: false };
      if (isRealCoupangProduct(product) && match.linkable) {
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
  const repairOutcomes = [];
  const withLink = allDrafts.filter((p) => productsPerTopic.has(p.topic_id));
  const withoutLink = allDrafts.filter((p) => !productsPerTopic.has(p.topic_id));

  const candidateWithLink = withLink.slice(0, total);
  const primaryWithLink = reply.ok ? candidateWithLink : [];
  const selectedIds = new Set(primaryWithLink.map((post) => post.id));
  const remainingSlots = Math.max(0, total - primaryWithLink.length);
  const primaryNoLink = withoutLink
    .filter((post, index, list) => list.findIndex((row) => row.id === post.id) === index)
    .filter((post) => !selectedIds.has(post.id))
    .slice(0, remainingSlots);
  const linkCount = candidateWithLink.length;
  const noLinkCount = remainingSlots;
  const linkShortage = 0;
  const noLinkShortage = Math.max(0, remainingSlots - primaryNoLink.length);
  const linkOverflow = Math.max(0, withLink.length - primaryWithLink.length);
  let sponsoredSlotAvailable = !(await sponsoredCommentAlreadyQueuedToday(account.id));
  const noLinkDrafts = [];
  for (const post of primaryNoLink) {
    let postMode = 'no_link';
    if (sponsoredSlotAvailable) {
      const sponsor = await canUseSponsoredComment({ account, post });
      if (sponsor.ok) {
        postMode = 'sponsored_comment';
        sponsoredSlotAvailable = false;
      }
    }
    noLinkDrafts.push({ post, postMode });
  }
  const drafts = primaryWithLink.map((post) => ({ post, postMode: 'link' }))
    .concat(noLinkDrafts);
  const diagnostics = {
    scheduleCount: total,
    requiredLinkCount: linkCount,
    requiredNoLinkCount: noLinkCount,
    availableDraftPosts: allDrafts.length,
    availableLinkPosts: withLink.length,
    availableNoLinkPosts: allDrafts.length - withLink.length,
    selectedLinkPosts: primaryWithLink.length,
    selectedNoLinkPosts: primaryNoLink.length,
    linkShortage,
    linkOverflow,
    noLinkShortage,
    linkPostsBlocked: !reply.ok,
    replyLinkReadinessCode: reply.code,
    replyLinkReadinessMessage: reply.message,
    unresolvedReplyFailures: reply.unresolvedCount || 0,
    trialPlan: trialStatus?.plan || null,
    trialRemaining: trialStatus?.remaining ?? null,
    uncappedScheduleCount: scheduleTimes.length,
    blockedScheduleCount: spacingQueues.length,
    schedulePlan: visibleSchedulePlan,
    productRepairAttempts: repairOutcomes.length,
    productRepairFallbacks: repairOutcomes.filter((row) => row.finalMode === 'no_link').length,
    sponsoredCommentCount: drafts.filter((row) => row.postMode === 'sponsored_comment').length,
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
  const blockedLinkPosts = reply.ok ? 0 : candidateWithLink.length;

  diagnostics.blockedLinkPosts = blockedLinkPosts;

  if (total === 0) diagnostics.reasonCode = 'NO_SCHEDULE_TIMES';
  else if (allDrafts.length === 0) diagnostics.reasonCode = 'NO_DRAFT_POSTS';
  else if (repairOutcomes.some((row) => row.reasonCode === 'COUPANG_RATE_LIMIT')) diagnostics.reasonCode = 'COUPANG_RATE_LIMIT';
  else if (diagnostics.productRepairFallbacks > 0) diagnostics.reasonCode = 'PRODUCT_REPAIR_FALLBACK_TO_NO_LINK';
  else if (!reply.ok && candidateWithLink.length > 0 && drafts.length === 0) diagnostics.reasonCode = reply.code || 'REPLY_LINK_BLOCKED';
  else if (!reply.ok && candidateWithLink.length > 0) diagnostics.reasonCode = 'LINK_POSTS_BLOCKED_REPLY_REVIEW_NEEDED';
  else if (drafts.length === 0 && linkCount > 0) diagnostics.reasonCode = 'NO_REAL_COUPANG_LINKS';
  else if (drafts.length === 0) diagnostics.reasonCode = 'NO_QUEUEABLE_DRAFTS';
  else if (linkShortage > 0) diagnostics.reasonCode = 'PARTIAL_LINK_CANDIDATES';
  else if (noLinkShortage > 0) diagnostics.reasonCode = 'PARTIAL_NO_LINK_CANDIDATES';

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
    queued.push(await addPostToQueue(item.post.id, times[index], {
      postMode: item.postMode,
      skipReplyReadiness: true
    }));
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
    await syncAutomationStudioQueueLink(row.id, updated.status);
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
    return canRepairReplyFailureQueue(queue, accountsById.get(queue.account_id));
  });
  const repaired = [];
  const failed = [];
  const skipped = [];

  for (const queue of targets) {
    const account = accountsById.get(queue.account_id);
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    const automationLink = await getAutomationStudioQueueLink(queue.id);
    const threadsPostId = extractThreadsPostId(queue.post_url);
    let repairStage = 'preflight';

    if (!account || account.status !== 'active' || !isAutomationRunning(account)) {
      skipped.push({ queueId: queue.id, reason: 'account_not_active_or_automation_paused' });
      continue;
    }
    if (!post || !threadsPostId) {
      const reason = !post ? 'post_missing' : 'threads_post_id_missing';
      skipped.push({ queueId: queue.id, reason });
      await markReplyRepairBlocked(queue, reason);
      continue;
    }

    try {
      const skipMonetizationChecks = canSkipMonetizationPreflight({ queue, post, automationLink });
      assertPreflightCanPublish(await preflightAccount(account.id, {
        includeQueue: false,
        allowInitialLinkDiscovery: true,
        skipMonetizationChecks
      }));
      repairStage = 'tracking_link';
      let trackingLink = queue.tracking_link_id
        ? await dbGet('tracking_links', { id: queue.tracking_link_id }).catch(() => null)
        : null;
      if (!trackingLink) {
        repairStage = 'product_lookup';
        const { product } = await getFirstLinkableProductForTopic(post.topic_id);
        if (!product || !isLinkableCoupangProduct(product)) {
          skipped.push({ queueId: queue.id, reason: 'linkable_product_missing' });
          await markReplyRepairBlocked(queue, 'linkable_product_missing');
          continue;
        }
        repairStage = 'tracking_link';
        trackingLink = await resolveTrackingLinkForQueue(queue, post, product);
      }
      if (!trackingLink) {
        skipped.push({ queueId: queue.id, reason: 'tracking_link_missing' });
        await markReplyRepairBlocked(queue, 'tracking_link_missing');
        continue;
      }
      const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const linkMode = String(process.env.THREADS_COUPANG_LINK_MODE || 'direct').toLowerCase();
      const linkUrl = linkMode === 'tracking' ? `${baseUrl}/r/${trackingLink.code}` : trackingLink.destination_url;
      repairStage = 'reply_upload';
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
      await syncAutomationStudioQueueLink(queue.id, updated.status);
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
      if (repairStage !== 'reply_upload') {
        skipped.push({ queueId: queue.id, reason: `${repairStage}_failed`, message: error.message });
        await markReplyRepairBlocked(queue, `${repairStage}_failed`, error.message);
        continue;
      }
      const retry = Number(queue.retry_count || 0) + 1;
      const status = retry >= REPLY_REPAIR_MAX_ATTEMPTS ? 'manual_required' : 'retry';
      const classified = classifyQueueError(error.message || 'THREADS_REPLY_FAILED');
      let failedRows;
      try {
        failedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          error_category: classified.category,
          post_url: queue.post_url || error.postUrl || null
        });
      } catch (updateError) {
        if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
        failedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          post_url: queue.post_url || error.postUrl || null
        });
      }
      const [updated] = failedRows || [];
      await syncAutomationStudioQueueLink(queue.id, updated?.status || status);
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
  const rows = [...scheduled, ...retrying].filter((row) => (row.platform || 'threads') === 'threads');
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
      assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false, allowInitialLinkDiscovery: true }));
      const { product } = await getFirstLinkableProductForTopic(post.topic_id);
      if (!product || !isLinkableCoupangProduct(product)) {
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
  if ((queue.platform || 'threads') !== 'threads') {
    const error = new Error('Only Threads queue items can be uploaded automatically. Instagram preview queue is manual only.');
    error.status = 409;
    error.code = 'AUTOMATION_STUDIO_PREVIEW_ONLY';
    throw error;
  }
  const account = await dbGet('accounts', { id: queue.account_id });
  const post = await dbGet('posts', { id: queue.post_id });
  const automationLink = await getAutomationStudioQueueLink(queue.id);
  if (canRepairReplyFailureQueue(queue, account)) {
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
      const [updated] = await dbUpdate('post_queue', { id: queueId }, { status: 'skipped', error_message: `Account is ${account?.status || 'missing'}` });
      await syncAutomationStudioQueueLink(queueId, updated?.status || 'skipped');
      return updated;
    }
    const skipMonetizationChecks = canSkipMonetizationPreflight({ queue, post, automationLink });
    assertPreflightCanPublish(await preflightAccount(account.id, {
      includeQueue: false,
      skipMonetizationChecks
    }));
    const { product } = await getFirstLinkableProductForTopic(post.topic_id);
    // retry 시 기존 tracking_link 재사용 — 중복 생성 방지
    const existingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const postMode = queue.post_mode || 'auto';
    let requiresLink = postMode === 'link' || (postMode === 'auto' && isLinkableCoupangProduct(product));
    const willSendLinkReply = requiresLink || Boolean(existingLink);
    if (willSendLinkReply) {
      const reply = await replyLinkReadiness(account);
      if (!reply.ok) {
        await logActivity({
          account_id: queue.account_id,
          project_id: queue.project_id,
          topic_id: queue.topic_id,
          post_id: queue.post_id,
          queue_id: queue.id,
          action: 'link_queue_blocked_reply_readiness',
          level: 'error',
          message: reply.message || '댓글 링크 상태가 안전하지 않아 링크 글 업로드를 막았습니다.',
          payload: { reasonCode: reply.code, unresolvedReplyFailures: reply.unresolvedCount || 0 }
        }).catch(() => null);
        throw createReplyLinkRequiredError(reply.code, reply.message);
      }
    }
    const resolvedPostMode = requiresLink ? 'link' : (postMode === 'sponsored_comment' ? 'sponsored_comment' : 'no_link');
    if (postMode !== resolvedPostMode) {
      await dbUpdate('post_queue', { id: queueId }, { post_mode: resolvedPostMode }).catch(() => []);
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
    }) : null)) : existingLink;
    trackingLinkForFailure = trackingLink?.id || trackingLinkForFailure;
    if (requiresLink && !trackingLink) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글의 트래킹 링크를 만들 수 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const sponsor = resolvedPostMode === 'sponsored_comment'
      ? await getSponsorCommentText({ account, post })
      : { ok: false, commentText: '' };
    const uploaded = await uploadThreads({ account, post, cta, trackingLink, sponsoredReplyText: sponsor.commentText || '' });
    const replyClassification = uploaded.raw?.replyWarning
      ? classifyQueueError(uploaded.raw.replyWarning)
      : null;
    let postedRows;
    try {
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl || fallbackThreadsPostUrl(account, uploaded.raw?.postId),
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id || queue.tracking_link_id || null,
        error_message: uploaded.raw?.replyWarning || null,
        error_category: replyClassification?.category || null
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl || fallbackThreadsPostUrl(account, uploaded.raw?.postId),
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id || queue.tracking_link_id || null,
        error_message: uploaded.raw?.replyWarning || null
      });
    }
    const [updated] = postedRows;
    await syncAutomationStudioQueueLink(queueId, updated.status);
    await dbUpdate('posts', { id: post.id }, { status: 'posted' });
    await recordSuccessfulUpload(account.id);
    await createMetricJobs(updated);
    const blogPost = await maybeGenerateBlogPostForQueue({ account, post, queue: updated }).catch(async (blogError) => {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'blog_auto_publish_failed',
        level: 'warn',
        message: blogError.message
      });
      return null;
    });
    if (blogPost) {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'blog_auto_published',
        message: blogPost.slug,
        payload: { blogPostId: blogPost.id, slug: blogPost.slug }
      });
    }
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
    await syncAutomationStudioQueueLink(queueId, updated?.status || status);
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
