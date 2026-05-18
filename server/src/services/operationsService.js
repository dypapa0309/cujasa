import { dbGet, dbList, dbUpdate } from './supabaseService.js';
import { expireStalePipelineRuns, latestPipelineRunReadOnly, pipelineStaleReason } from './pipelineRunService.js';
import { resolveCoupangCredentialsForAccount } from './coupangService.js';
import { adminActivityLabel, adminActivityMessage, normalizeQueueClassification } from './queueErrorService.js';
import { dailyPipelineStatus } from './schedulerRunService.js';
import { enforceDailyQueueLimits, processDueQueue, repairReplyLinkFailures } from './schedulerService.js';
import { cleanupOldQueueIssues } from './queueVisibilityService.js';
import { cleanupOldActivityLogs } from './activityLogCleanupService.js';

const QUEUE_PROBLEM_STATUSES = ['failed', 'retry', 'manual_required'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NON_FATAL_QUEUE_CATEGORIES = new Set([
  'reply_warning',
  'reply_repair_blocked',
  'reply_link_mode_required',
  'content_blocked',
  'retry_available',
  'recheck_required',
  'instagram_preview_only'
]);
const REPLY_ATTENTION_CATEGORIES = new Set(['reply_warning', 'reply_repair_blocked', 'reply_permission_required']);
const STALE_RUNNING_CATEGORY = 'pipeline_stuck';
const OPERATION_QUEUE_LIMIT = Math.max(100, Number(process.env.OPERATION_QUEUE_LIMIT || 2000));
const OPERATION_PRODUCT_LIMIT = Math.max(100, Number(process.env.OPERATION_PRODUCT_LIMIT || 2000));
const OPERATION_PIPELINE_RUN_LIMIT = Math.max(100, Number(process.env.OPERATION_PIPELINE_RUN_LIMIT || 300));
const OPERATION_DASHBOARD_CACHE_TTL_MS = Math.max(0, Number(process.env.OPERATION_DASHBOARD_CACHE_TTL_MS || 30000));
let operationDashboardCache = null;

export function clearOperationDashboardCache() {
  operationDashboardCache = null;
}

async function safeDbList(table, filters = {}, options = {}, fallback = [], loadErrors = null) {
  try {
    return await dbList(table, filters, options);
  } catch (error) {
    console.warn(`[operations] ${table} lookup failed`, error?.message || error);
    if (Array.isArray(loadErrors)) {
      loadErrors.push({
        table,
        message: error?.message || String(error),
        code: error?.code || null
      });
    }
    return fallback;
  }
}

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

function tokenState(account) {
  if (!account.threads_access_token) return { status: 'error', label: 'Threads 연결 필요' };
  if (account.threads_token_status === 'refresh_failed') return { status: 'error', label: '다시 연결 필요' };
  if (!account.threads_token_expires_at) return { status: 'ok', label: '연결됨' };
  const daysLeft = (new Date(account.threads_token_expires_at).getTime() - Date.now()) / ONE_DAY_MS;
  if (daysLeft <= 0) return { status: 'error', label: '다시 연결 필요' };
  if (daysLeft <= 7) return { status: 'warn', label: `만료 ${Math.ceil(daysLeft)}일 전` };
  return { status: 'ok', label: '연결됨' };
}

async function coupangState(account, { productSettings = null } = {}) {
  const creds = productSettings && typeof productSettings === 'object'
    ? {
        accessKey: account.coupang_access_key || productSettings.coupangAccessKey || process.env.COUPANG_ACCESS_KEY,
        secretKey: account.coupang_secret_key || productSettings.coupangSecretKey || process.env.COUPANG_SECRET_KEY,
        partnerId: account.coupang_partner_id || productSettings.coupangPartnerId || process.env.COUPANG_PARTNER_ID,
        trackingCode: account.coupang_tracking_code || productSettings.defaultTrackingCode || process.env.COUPANG_TRACKING_CODE
      }
    : await resolveCoupangCredentialsForAccount(account);
  const missing = [];
  if (!creds.accessKey) missing.push('Access Key');
  if (!creds.secretKey) missing.push('Secret Key');
  if (!creds.partnerId) missing.push('Partner ID');
  if (!creds.trackingCode) missing.push('Tracking Code');
  const cooldownUntil = account.coupang_search_cooldown_until || null;
  const cooldownActive = account.coupang_search_status === 'rate_limited'
    && new Date(cooldownUntil || 0).getTime() > Date.now();
  if (cooldownActive) {
    return { status: 'warn', label: '검색 제한 중', missing: [], searchStatus: 'rate_limited', cooldownUntil };
  }
  if (account.coupang_search_status === 'credentials_missing') {
    return { status: 'error', label: '키 누락', missing: missing.length ? missing : ['Access Key', 'Secret Key'], searchStatus: 'credentials_missing', cooldownUntil };
  }
  if (account.coupang_search_status === 'api_error') {
    return { status: 'warn', label: 'API 오류', missing, searchStatus: 'api_error', cooldownUntil };
  }
  return missing.length
    ? { status: 'error', label: '키 누락', missing, searchStatus: 'credentials_missing', cooldownUntil }
    : { status: 'ok', label: '설정됨', missing: [], searchStatus: 'ok', cooldownUntil };
}

function countBy(items, keyFn) {
  return items.reduce((acc, item) => {
    const key = keyFn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function displayActivityCode(value) {
  return ({
    pipeline_background_already_running: '이미 예약 작업을 확인 중입니다',
    queue_empty: '오늘 예약 가능한 링크 글이 없습니다',
    threads_reconnect: 'Threads 재연결 필요',
    threads_reconnect_required: 'Threads 재연결 필요',
    operations_safety_pause: '운영 안전 점검으로 일시정지',
    operations_link_setup_hold: '상품 링크 설정 확인 필요',
    pipeline_stuck: '예약 작업 확인 필요',
    coupang_settings: '쿠팡 API 설정 필요',
    coupon_settings: '쿠팡 API 설정 필요'
  })[value] || value;
}

function eventTime(row) {
  return row.posted_at || row.scheduled_at || row.updated_at || row.created_at || null;
}

function sortEventsByTime(events, { ascending = false } = {}) {
  return [...events].sort((a, b) => {
    const av = a.time ? new Date(a.time).getTime() : 0;
    const bv = b.time ? new Date(b.time).getTime() : 0;
    return ascending ? av - bv : bv - av;
  });
}

function queueProblemBreakdown(categorizedProblems) {
  return {
    fatal: categorizedProblems.filter((row) => !NON_FATAL_QUEUE_CATEGORIES.has(row.category)).length,
    threadsReconnect: categorizedProblems.filter((row) => row.category === 'threads_reconnect_required').length,
    replyPermissionRequired: categorizedProblems.filter((row) => row.category === 'reply_permission_required').length,
    retryAvailable: categorizedProblems.filter((row) => row.category === 'retry_available' || row.category === 'recheck_required').length,
    replyWarning: categorizedProblems.filter((row) => row.category === 'reply_warning').length,
    replyRepairBlocked: categorizedProblems.filter((row) => row.category === 'reply_repair_blocked').length,
    contentBlocked: categorizedProblems.filter((row) => row.category === 'content_blocked').length,
    coupangLinkMissing: categorizedProblems.filter((row) => row.category === 'coupang_link_missing').length,
    manualRequired: categorizedProblems.filter((row) => row.category === 'manual_required').length,
    byCategory: countBy(categorizedProblems, (row) => row.category)
  };
}

function pipelineState(pipelineRun) {
  const stale = pipelineStaleReason(pipelineRun);
  if (stale) {
    return {
      status: 'stuck',
      stale: true,
      staleCode: stale.code,
      label: stale.label || (stale.code === 'PIPELINE_LOCK_EXPIRED' ? '만료된 실행 잠금' : '진행 멈춤'),
      message: stale.message,
      lastProgressAt: stale.lastProgressAt || null,
      stage: stale.stage || null
    };
  }
  if (pipelineRun?.status === 'running') return { status: 'running', stale: false, label: '자동화 실행 중' };
  if (pipelineRun?.status === 'expired') return { status: 'expired', stale: false, label: '최근 예약 작업 만료' };
  if (pipelineRun?.status === 'failed') return { status: 'failed', stale: false, label: '최근 파이프라인 실패' };
  return { status: pipelineRun?.status || null, stale: false, label: null };
}

export async function diagnoseAccountReadOnly(account, context = {}) {
  const {
    queue = [],
    products = [],
    activityLogs = [],
    userAccounts = [],
    usersById = new Map(),
    cujasaSettingsByAccountId = new Map(),
    pipelineRunsByAccountId = null,
    start,
    end
  } = context;
  const accountQueue = queue.filter((row) => row.account_id === account.id && !row.customer_hidden_at);
  const todayQueue = accountQueue.filter((row) => inRange(row.scheduled_at, start, end));
  const todayScheduled = todayQueue.filter((row) => row.status === 'scheduled').length;
  const futureScheduledQueue = accountQueue
    .filter((row) => row.status === 'scheduled' && new Date(row.scheduled_at || 0).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0));
  const upcomingScheduled = futureScheduledQueue.length;
  const nextScheduledAt = futureScheduledQueue[0]?.scheduled_at || null;
  const todayPosted = accountQueue.filter((row) => row.status === 'posted' && inRange(row.posted_at || row.scheduled_at, start, end)).length;
  const problemQueue = accountQueue.filter((row) => QUEUE_PROBLEM_STATUSES.includes(row.status));
  const postedReplyAttentionQueue = accountQueue.filter((row) => row.status === 'posted' && REPLY_ATTENTION_CATEGORIES.has(row.error_category));
  const mockCount = accountQueue.filter((row) => String(row.post_url || '').includes('/mock/threads/')).length;
  const accountProducts = products.filter((row) => row.account_id === account.id);
  const fallbackCount = accountProducts.filter((row) => row.is_fallback).length;
  const fallbackRatio = accountProducts.length ? fallbackCount / accountProducts.length : 0;
  const recentPosted = accountQueue
    .filter((row) => row.status === 'posted' && row.posted_at)
    .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))[0];
  const lastActivity = activityLogs.find((row) => row.account_id === account.id) || null;
  const pipelineRun = pipelineRunsByAccountId?.get(account.id) || await latestPipelineRunReadOnly(account.id);
  const pipeline = pipelineState(pipelineRun);
  const threads = tokenState(account);
  const coupang = await coupangState(account, { productSettings: cujasaSettingsByAccountId.get(account.id) || null });
  const customer = await customerLabelFor(account.id, userAccounts, usersById);
  const problems = [];
  const currentThreadsOk = threads.status !== 'error';
  const issueRows = [...problemQueue, ...postedReplyAttentionQueue]
    .filter((row, index, rows) => rows.findIndex((item) => item.id === row.id) === index);
  const categorizedProblems = issueRows.map((row) => normalizeQueueClassification(row, { currentThreadsOk }));
  const queueBreakdown = queueProblemBreakdown(categorizedProblems);

  if (threads.status === 'error') pushProblem(problems, account, 'error', 'threads', threads.label);
  else if (threads.status === 'warn') pushProblem(problems, account, 'warn', 'threads', `Threads ${threads.label}`);
  if (coupang.status === 'error') pushProblem(problems, account, 'error', 'coupang', '쿠팡 API 키 누락', coupang.missing.join(', '));
  if (coupang.searchStatus === 'rate_limited') pushProblem(problems, account, 'warn', 'coupang_rate_limit', '쿠팡 검색 제한 중', coupang.cooldownUntil || '');
  if (coupang.searchStatus === 'api_error') pushProblem(problems, account, 'warn', 'coupang_api_error', '쿠팡 API 오류');
  if (account.status === 'active' && todayScheduled === 0 && upcomingScheduled === 0) {
    pushProblem(problems, account, 'warn', 'no_schedule', '예약 없음');
  }
  if (queueBreakdown.fatal > 0) {
    pushProblem(problems, account, 'error', 'queue_failed', queueBreakdown.replyPermissionRequired
      ? `댓글 권한 재연결 필요 ${queueBreakdown.replyPermissionRequired}건`
      : queueBreakdown.threadsReconnect
        ? `재연결 필요 ${queueBreakdown.threadsReconnect}건`
        : `실패/검토 ${queueBreakdown.fatal}건`);
  }
  if (queueBreakdown.retryAvailable > 0) pushProblem(problems, account, 'warn', 'retry_available', `재연결 후 재시도 가능 ${queueBreakdown.retryAvailable}건`);
  if (queueBreakdown.replyWarning > 0) pushProblem(problems, account, 'warn', 'reply_warning', `댓글/링크 답글 실패 ${queueBreakdown.replyWarning}건`);
  if (queueBreakdown.replyRepairBlocked > 0) pushProblem(problems, account, 'warn', 'reply_repair_blocked', `댓글 링크 수동확인 ${queueBreakdown.replyRepairBlocked}건`);
  if (queueBreakdown.contentBlocked > 0) pushProblem(problems, account, 'warn', 'content_blocked', `콘텐츠 후보 제외 ${queueBreakdown.contentBlocked}건`);
  if (mockCount > 0) pushProblem(problems, account, 'warn', 'mock_upload', `테스트 업로드 흔적 ${mockCount}건`);
  if (fallbackRatio >= 0.5 && accountProducts.length >= 5) pushProblem(problems, account, 'warn', 'fallback_products', `fallback 상품 ${Math.round(fallbackRatio * 100)}%`);
  if (pipeline.status === 'stuck') pushProblem(problems, account, 'warn', STALE_RUNNING_CATEGORY, pipeline.label, pipeline.message || pipeline.staleCode);
  else if ((lastActivity?.action === 'pipeline_failed' || pipeline.status === 'failed') && problems.some((p) => p.severity === 'error')) {
    pushProblem(problems, account, 'error', 'pipeline_failed', '최근 파이프라인 실패', pipelineRun?.error_message || lastActivity?.message || '');
  }
  if (pipeline.status === 'expired') {
    pushProblem(problems, account, 'warn', 'pipeline_expired', '최근 예약 작업 만료', pipelineRun.error_message || '');
  }

  const runBlockers = problems.filter((problem) => problem.severity === 'error');
  const hasStalePipeline = problems.some((problem) => problem.type === STALE_RUNNING_CATEGORY);
  const runCategory = hasStalePipeline
    ? STALE_RUNNING_CATEGORY
    : runBlockers.length === 0
      ? 'ready'
      : runBlockers.some((problem) => problem.type === 'threads') ? 'threads_reconnect'
        : runBlockers.some((problem) => problem.type === 'coupang') ? 'coupang_settings'
          : runBlockers.some((problem) => problem.type === 'queue_failed') ? 'queue_cleanup'
            : 'blocked';
  const blockingCategory = runCategory === 'threads_reconnect'
    ? 'customer_action_required'
    : runCategory === 'queue_cleanup' || runCategory === STALE_RUNNING_CATEGORY
      ? 'admin_cleanup_required'
      : upcomingScheduled > 0
        ? 'next_schedule_exists'
        : runCategory === 'ready'
          ? 'automation_possible'
          : 'blocked';

  return {
    accountId: account.id,
    accountName: account.name,
    accountHandle: account.account_handle,
    customer,
    accountStatus: account.status,
    automationStatus: account.automation_status,
    health: pipeline.status === 'running' ? 'running' : runBlockers.length ? 'error' : problems.length ? 'warn' : 'ok',
    runCategory,
    blockingCategory,
    canRunNow: runCategory === 'ready' || runCategory === STALE_RUNNING_CATEGORY,
    threads,
    coupang,
    todayScheduled,
    upcomingScheduled,
    nextScheduledAt,
    todayPosted,
    failedCount: queueBreakdown.fatal,
    replyWarningCount: queueBreakdown.replyWarning,
    replyRepairBlockedCount: queueBreakdown.replyRepairBlocked,
    retryAvailableCount: queueBreakdown.retryAvailable,
    contentBlockedCount: queueBreakdown.contentBlocked,
    queueBreakdown,
    mockCount,
    fallbackRatio,
    lastPostedAt: recentPosted?.posted_at || null,
    lastActivity: lastActivity ? {
      action: lastActivity.action,
      level: lastActivity.level,
      label: adminActivityLabel(lastActivity.action, lastActivity.message) || null,
      message: adminActivityMessage(lastActivity.action, lastActivity.message) || lastActivity.message,
      rawMessage: lastActivity.message,
      createdAt: lastActivity.created_at
    } : null,
    pipelineRun: pipelineRun ? {
      id: pipelineRun.id,
      status: pipeline.status,
      rawStatus: pipelineRun.status,
      stale: pipeline.stale,
      staleCode: pipeline.staleCode,
      label: pipeline.label,
      message: pipeline.message || null,
      stage: pipeline.stage || pipelineRun.result?.stage || null,
      percent: pipelineRun.result?.percent ?? null,
      lastProgressAt: pipeline.lastProgressAt || pipelineRun.result?.updatedAt || pipelineRun.updated_at || null,
      startedAt: pipelineRun.started_at,
      finishedAt: pipelineRun.finished_at,
      expiresAt: pipelineRun.expires_at,
      errorMessage: pipelineRun.error_message
    } : null,
    problems
  };
}

function pushProblem(problems, account, severity, type, label, detail = '') {
  problems.push({
    accountId: account.id,
    accountName: account.name,
    accountHandle: account.account_handle,
    severity,
    type,
    label,
    detail
  });
}

async function customerLabelFor(accountId, userAccounts, usersById) {
  const links = userAccounts.filter((ua) => ua.account_id === accountId);
  const labels = links.map((link) => {
    const user = usersById.get(link.user_id);
    const primary = user?.buyer_name || user?.username || user?.email;
    return [primary, user?.username && primary !== user.username ? `ID ${user.username}` : ''].filter(Boolean).join(' · ');
  }).filter(Boolean);
  return labels.join(', ');
}

function latestPipelineRunsByAccount(runs = []) {
  const map = new Map();
  for (const run of runs) {
    if (!run.account_id || map.has(run.account_id)) continue;
    map.set(run.account_id, run);
  }
  return map;
}

function buildCujasaSettingsByAccount(userAccounts = [], userProducts = []) {
  const settingsByUserId = new Map();
  for (const grant of userProducts) {
    if (grant.product_id !== 'cujasa') continue;
    if (!grant.settings || typeof grant.settings !== 'object') continue;
    settingsByUserId.set(grant.user_id, grant.settings);
  }
  const settingsByAccountId = new Map();
  for (const link of userAccounts) {
    if (!link.account_id || settingsByAccountId.has(link.account_id)) continue;
    const settings = settingsByUserId.get(link.user_id);
    if (settings) settingsByAccountId.set(link.account_id, settings);
  }
  return settingsByAccountId;
}

async function loadOperationContext() {
  const range = kstDayRange();
  const loadErrors = [];
  const [accounts, queue, products, activityLogs, users, userAccounts, userProducts, pipelineRuns] = await Promise.all([
    safeDbList('accounts', {}, { limit: 500 }, [], loadErrors),
    safeDbList('post_queue', {}, {
      order: 'updated_at',
      ascending: false,
      limit: OPERATION_QUEUE_LIMIT
    }, [], loadErrors),
    safeDbList('coupang_products', {}, {
      select: 'id,account_id,is_fallback,created_at',
      order: 'created_at',
      ascending: false,
      limit: OPERATION_PRODUCT_LIMIT
    }, [], loadErrors),
    safeDbList('activity_logs', {}, { order: 'created_at', ascending: false, limit: 300 }, [], loadErrors),
    safeDbList('users', {}, { limit: 1000 }, [], loadErrors),
    safeDbList('user_accounts', {}, { limit: 2000 }, [], loadErrors),
    safeDbList('user_products', {}, { select: 'user_id,product_id,settings', limit: 5000 }, [], loadErrors),
    safeDbList('pipeline_runs', {}, { order: 'started_at', ascending: false, limit: OPERATION_PIPELINE_RUN_LIMIT }, [], loadErrors)
  ]);
  return { ...range, accounts, queue, products, activityLogs, users, userAccounts, userProducts, pipelineRuns, loadErrors };
}

async function buildOperationAccountRows(context) {
  const { accounts, queue, products, activityLogs, users, userAccounts, userProducts, pipelineRuns, start, end } = context;
  const usersById = new Map(users.map((user) => [user.id, user]));
  const cujasaSettingsByAccountId = buildCujasaSettingsByAccount(userAccounts, userProducts);
  const pipelineRunsByAccountId = latestPipelineRunsByAccount(pipelineRuns);
  const activeAccounts = accounts.filter((account) => account.status === 'active');

  const rows = [];
  for (const account of activeAccounts) {
    try {
      rows.push(await diagnoseAccountReadOnly(account, {
        queue,
        products,
        activityLogs,
        usersById,
        userAccounts,
        cujasaSettingsByAccountId,
        pipelineRunsByAccountId,
        start,
        end
      }));
    } catch (error) {
      console.warn('[operations] account diagnosis failed', account.id, error?.message || error);
      rows.push({
        accountId: account.id,
        accountName: account.name,
        accountHandle: account.account_handle,
        customer: '',
        accountStatus: account.status,
        automationStatus: account.automation_status,
        health: 'error',
        runCategory: 'blocked',
        blockingCategory: 'admin_cleanup_required',
        canRunNow: false,
        threads: tokenState(account),
        coupang: { status: 'warn', label: '상태 확인 실패', missing: [], searchStatus: null, cooldownUntil: null },
        todayScheduled: 0,
        upcomingScheduled: 0,
        nextScheduledAt: null,
        todayPosted: 0,
        failedCount: 1,
        replyWarningCount: 0,
        replyRepairBlockedCount: 0,
        retryAvailableCount: 0,
        contentBlockedCount: 0,
        queueBreakdown: { fatal: 1, byCategory: { dashboard_diagnosis_failed: 1 } },
        mockCount: 0,
        fallbackRatio: 0,
        lastPostedAt: null,
        lastActivity: null,
        pipelineRun: null,
        problems: [{
          accountId: account.id,
          accountName: account.name,
          accountHandle: account.account_handle,
          severity: 'error',
          type: 'dashboard_diagnosis_failed',
          label: '계정 진단 실패',
          detail: error?.message || '운영 대시보드 진단 중 오류가 발생했습니다.'
        }]
      });
    }
  }
  return rows;
}

export async function operationAccountRows() {
  return buildOperationAccountRows(await loadOperationContext());
}

async function buildOperationSummary({ accounts = [], queue = [], rows = [], start, end, loadErrors = [] }) {
  const range = start && end ? { start, end } : kstDayRange();
  start = range.start;
  end = range.end;
  const activeAccountIds = new Set(accounts.filter((account) => account.status === 'active').map((account) => account.id));
  const activeQueue = queue.filter((row) => activeAccountIds.has(row.account_id) && !row.customer_hidden_at);
  const todayQueue = activeQueue.filter((row) => inRange(row.scheduled_at, start, end));
  const threadsOkByAccountId = new Map(rows.map((row) => [row.accountId, row.threads.status !== 'error']));
  const problemAccounts = rows.flatMap((row) => row.problems).sort((a, b) => {
    const rank = { error: 0, warn: 1, ok: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  const dailyPipeline = await dailyPipelineStatus().catch((error) => {
    console.warn('[operations] daily pipeline status failed', error?.message || error);
    return null;
  });
  return {
    degraded: loadErrors.length > 0,
    loadErrors,
    cards: {
      accountsTotal: accounts.length,
      accountsActive: accounts.filter((account) => account.status === 'active').length,
      scheduledToday: todayQueue.filter((row) => row.status === 'scheduled').length,
      postedToday: activeQueue.filter((row) => row.status === 'posted' && inRange(row.posted_at || row.scheduled_at, start, end)).length,
      queueProblems: activeQueue.filter((row) => {
        if (!QUEUE_PROBLEM_STATUSES.includes(row.status)) return false;
        const account = accounts.find((item) => item.id === row.account_id);
        const currentThreadsOk = threadsOkByAccountId.has(row.account_id)
          ? threadsOkByAccountId.get(row.account_id)
          : tokenState(account || {}).status !== 'error';
        const category = normalizeQueueClassification(row, { currentThreadsOk }).category;
        return !NON_FATAL_QUEUE_CATEGORIES.has(category);
      }).length,
      mockUploads: activeQueue.filter((row) => String(row.post_url || '').includes('/mock/threads/')).length,
      threadsProblems: rows.filter((row) => row.threads.status !== 'ok').length
    },
    issueBreakdown: {
      threadsReconnect: rows.filter((row) => row.runCategory === 'threads_reconnect').length,
      coupangSettings: rows.filter((row) => row.runCategory === 'coupang_settings').length,
      queueCleanup: rows.filter((row) => row.runCategory === 'queue_cleanup').length,
      pipelineStuck: rows.filter((row) => row.problems?.some((problem) => problem.type === STALE_RUNNING_CATEGORY)).length,
      mockUploads: activeQueue.filter((row) => String(row.post_url || '').includes('/mock/threads/')).length,
      byProblemType: countBy(problemAccounts, (problem) => problem.type)
    },
    runReadiness: {
      ready: rows.filter((row) => row.canRunNow).length,
      skipped: rows.filter((row) => !row.canRunNow).length,
      threadsReconnect: rows.filter((row) => row.runCategory === 'threads_reconnect').length,
      coupangSettings: rows.filter((row) => row.runCategory === 'coupang_settings').length,
      queueCleanup: rows.filter((row) => row.runCategory === 'queue_cleanup').length,
      pipelineStuck: rows.filter((row) => row.problems?.some((problem) => problem.type === STALE_RUNNING_CATEGORY)).length
    },
    problemAccounts,
    dailyPipeline
  };
}

export async function operationSummary() {
  const context = await loadOperationContext();
  const rows = await buildOperationAccountRows(context);
  return buildOperationSummary({ accounts: context.accounts, queue: context.queue, rows, start: context.start, end: context.end, loadErrors: context.loadErrors });
}

async function buildOperationDashboardPayload() {
  const context = await loadOperationContext();
  const rows = await buildOperationAccountRows(context);
  const summary = await buildOperationSummary({
    accounts: context.accounts,
    queue: context.queue,
    rows,
    start: context.start,
    end: context.end,
    loadErrors: context.loadErrors
  });
  const dailyResultsByAccountId = new Map((summary.dailyPipeline?.run?.summary?.results || [])
    .filter((result) => result.accountId)
    .map((result) => [result.accountId, result]));
  return {
    summary,
    rows: rows.map((row) => ({
      ...row,
      dailyPipelineResult: dailyResultsByAccountId.get(row.accountId) || null
    }))
  };
}

export async function operationDashboard({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && operationDashboardCache && operationDashboardCache.expiresAt > now) {
    return operationDashboardCache.payload;
  }

  const startedAt = Date.now();
  const payload = await buildOperationDashboardPayload();
  const durationMs = Date.now() - startedAt;
  if (durationMs >= Number(process.env.OPERATION_DASHBOARD_SLOW_LOG_MS || 1200)) {
    console.warn('[operations] dashboard load slow', {
      durationMs,
      accounts: payload.rows?.length || 0,
      queue: payload.summary?.queue?.total || null,
      loadErrors: payload.summary?.loadErrors?.length || 0
    });
  }
  if (OPERATION_DASHBOARD_CACHE_TTL_MS > 0) {
    operationDashboardCache = {
      payload,
      expiresAt: Date.now() + OPERATION_DASHBOARD_CACHE_TTL_MS
    };
  }
  return payload;
}

export async function operationEvents({ type = 'queue_problems', limit = 200 } = {}) {
  const { start, end } = kstDayRange();
  const loadErrors = [];
  const [accounts, queue, rows, users, userAccounts] = await Promise.all([
    safeDbList('accounts', {}, { limit: 500 }, [], loadErrors),
    safeDbList('post_queue', {}, {
      order: 'updated_at',
      ascending: false,
      limit: OPERATION_QUEUE_LIMIT
    }, [], loadErrors),
    operationAccountRows(),
    safeDbList('users', {}, { limit: 1000 }, [], loadErrors),
    safeDbList('user_accounts', {}, { limit: 2000 }, [], loadErrors)
  ]);
  const activeAccountIds = new Set(accounts.filter((account) => account.status === 'active').map((account) => account.id));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const rowsByAccountId = new Map(rows.map((row) => [row.accountId, row]));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const accountCustomer = new Map();

  for (const account of accounts) {
    accountCustomer.set(account.id, await customerLabelFor(account.id, userAccounts, usersById));
  }

  const baseEvent = (accountId) => {
    const account = accountsById.get(accountId) || {};
    const row = rowsByAccountId.get(accountId) || {};
    return {
      accountId,
      accountName: row.accountName || account.name || '계정 없음',
      accountHandle: row.accountHandle || account.account_handle || '',
      customer: row.customer || accountCustomer.get(accountId) || ''
    };
  };

  const visibleQueue = queue.filter((row) => activeAccountIds.has(row.account_id) && !row.customer_hidden_at);
  let events = [];

  if (type === 'scheduled_today') {
    events = visibleQueue
      .filter((row) => ['scheduled', 'posted'].includes(row.status) && inRange(row.posted_at || row.scheduled_at, start, end))
      .map((row) => ({
        id: row.id,
        kind: 'queue',
        severity: row.status === 'posted' ? 'ok' : 'running',
        status: row.status,
        title: row.status === 'posted' ? '오늘 업로드 완료' : '오늘 예약됨',
        message: row.post_url ? `업로드 링크: ${row.post_url}` : '예약된 시간에 자동 업로드됩니다.',
        time: eventTime(row),
        actionTarget: 'queue',
        ...baseEvent(row.account_id)
      }));
    events = sortEventsByTime(events, { ascending: true });
  } else if (type === 'connection_problems') {
    events = rows.flatMap((row) => {
      const items = [];
      if (row.threads?.status !== 'ok') {
        items.push({
          id: `${row.accountId}:threads`,
          kind: 'connection',
          severity: row.threads?.status === 'error' ? 'error' : 'warn',
          status: row.threads?.status || 'warn',
          title: row.threads?.label || 'Threads 연결 확인 필요',
          message: row.threads?.status === 'error' ? 'Threads 계정을 다시 연결해야 자동화가 가능합니다.' : '토큰 만료일이 가까워졌습니다.',
          time: row.lastActivity?.createdAt || row.pipelineRun?.startedAt || null,
          actionTarget: 'settings',
          ...baseEvent(row.accountId)
        });
      }
      if (row.coupang?.status !== 'ok' || ['rate_limited', 'api_error'].includes(row.coupang?.searchStatus)) {
        items.push({
          id: `${row.accountId}:coupang`,
          kind: 'connection',
          severity: row.coupang?.status === 'error' ? 'error' : 'warn',
          status: row.coupang?.searchStatus || row.coupang?.status || 'warn',
          title: row.coupang?.label || '쿠팡 API 확인 필요',
          message: row.coupang?.missing?.length
            ? `누락된 설정: ${row.coupang.missing.join(', ')}`
            : (row.coupang?.cooldownUntil ? `검색 제한 해제 예정: ${row.coupang.cooldownUntil}` : '쿠팡 API 상태를 확인해주세요.'),
          time: row.lastActivity?.createdAt || row.pipelineRun?.startedAt || null,
          actionTarget: 'settings',
          ...baseEvent(row.accountId)
        });
      }
      return items;
    });
    events = sortEventsByTime(events);
  } else if (type === 'account_issues') {
    events = rows.flatMap((row) => row.problems.map((problem, index) => ({
      id: `${row.accountId}:${problem.type}:${index}`,
      kind: 'account_issue',
      severity: problem.severity,
      status: problem.type,
      title: displayActivityCode(problem.label),
      message: displayActivityCode(problem.detail) || runCategoryLabelForEvent(row.runCategory),
      time: row.lastActivity?.createdAt || row.pipelineRun?.startedAt || null,
      actionTarget: problem.type === 'no_schedule' || problem.type === 'queue_failed' ? 'queue' : 'settings',
      ...baseEvent(row.accountId)
    })));
    events = sortEventsByTime(events);
  } else {
    const threadsOkByAccountId = new Map(rows.map((row) => [row.accountId, row.threads.status !== 'error']));
    const queueEvents = visibleQueue
      .filter((row) => QUEUE_PROBLEM_STATUSES.includes(row.status) || (row.status === 'posted' && REPLY_ATTENTION_CATEGORIES.has(row.error_category)))
      .map((row) => {
        const classification = normalizeQueueClassification(row, {
          currentThreadsOk: threadsOkByAccountId.get(row.account_id) ?? true
        });
        return {
          id: row.id,
          kind: 'queue_problem',
          severity: NON_FATAL_QUEUE_CATEGORIES.has(classification.category) ? 'warn' : 'error',
          status: classification.category,
          title: displayActivityCode(classification.title),
          message: displayActivityCode(classification.message || row.error_message || '확인이 필요합니다.'),
          time: eventTime(row),
          actionTarget: 'queue',
          ...baseEvent(row.account_id)
        };
      });
    const pipelineEvents = rows
      .filter((row) => ['stuck', 'failed', 'expired'].includes(row.pipelineRun?.status))
      .map((row) => ({
        id: row.pipelineRun?.id || `${row.accountId}:pipeline`,
        kind: 'pipeline_problem',
        severity: row.pipelineRun?.status === 'stuck' ? 'error' : 'warn',
        status: row.pipelineRun?.status,
        title: row.pipelineRun?.label || '예약 작업 확인 필요',
        message: displayActivityCode(row.pipelineRun?.errorMessage || row.pipelineRun?.staleCode || '최근 예약 작업 상태를 확인해주세요.'),
        time: row.pipelineRun?.finishedAt || row.pipelineRun?.startedAt || row.lastActivity?.createdAt || null,
        actionTarget: 'queue',
        ...baseEvent(row.accountId)
      }));
    events = [...queueEvents, ...pipelineEvents];
    events = sortEventsByTime(events);
  }

  const cappedLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  return {
    type,
    degraded: loadErrors.length > 0,
    loadErrors,
    count: events.length,
    events: events.slice(0, cappedLimit)
  };
}

function runCategoryLabelForEvent(category) {
  return ({
    ready: '실행 가능',
    threads_reconnect: 'Threads 재연결 필요',
    coupang_settings: '쿠팡 API 설정 필요',
    queue_cleanup: '실패 큐 확인 필요',
    pipeline_stuck: '멈춘 예약 작업 확인 필요',
    blocked: '실행 전 확인 필요'
  })[category] || '상태 확인 필요';
}

export async function cleanupQueueErrors({ mode = 'dry-run', limit = 500 } = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
  const rows = await dbList('post_queue', {}, {
    order: 'updated_at',
    ascending: false,
    limit: cappedLimit,
    in: { status: QUEUE_PROBLEM_STATUSES }
  });
  const targets = rows
    .filter((row) => QUEUE_PROBLEM_STATUSES.includes(row.status))
    .map((row) => ({
      ...row,
      classification: normalizeQueueClassification(row)
    }));
  if (mode === 'apply') {
    for (const row of targets) {
      try {
        await dbUpdate('post_queue', { id: row.id }, {
          error_category: row.classification.category,
          status: row.classification.category === 'reply_warning' ? 'manual_required' : row.status
        });
      } catch (error) {
        if (!/error_category|schema cache|column/i.test(error.message || '')) throw error;
        await dbUpdate('post_queue', { id: row.id }, {
          status: row.classification.category === 'reply_warning' ? 'manual_required' : row.status
        });
      }
    }
  }
  const counts = targets.reduce((acc, row) => {
    acc[row.classification.category] = (acc[row.classification.category] || 0) + 1;
    return acc;
  }, {});
  return {
    mode,
    updated: mode === 'apply' ? targets.length : 0,
    counts,
    targets: targets.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      status: row.status,
      errorCategory: row.classification.category,
      title: row.classification.title,
      message: row.classification.message
    }))
  };
}

export async function normalizeOperations({ accountId = null } = {}) {
  const expired = await expireStalePipelineRuns(accountId || null);
  const repairedReplies = await repairReplyLinkFailures({ accountId, dryRun: true, limit: 50 });
  const oldIssues = await cleanupOldQueueIssues({
    mode: 'apply',
    accountId,
    hideAfterDays: 1,
    deleteAfterHiddenDays: 1
  });
  const oldActivityLogs = accountId ? null : await cleanupOldActivityLogs({ mode: 'apply' });
  const dailyQueueLimits = await enforceDailyQueueLimits({ accountId: accountId || null });
  const processedQueue = await processDueQueue();
  const dashboard = await operationDashboard();
  return {
    ok: true,
    accountId,
    expiredPipelineCount: expired.length,
    repairedReplyCount: repairedReplies.repairedCount || 0,
    repairableReplyCount: repairedReplies.wouldRepairCount || 0,
    failedReplyRepairCount: repairedReplies.failedCount || 0,
    skippedReplyRepairCount: repairedReplies.skippedCount || 0,
    oldIssues,
    oldActivityLogs,
    dailyQueueLimits,
    processedQueue,
    remainingQueueProblems: dashboard.summary?.cards?.queueProblems ?? 0,
    remainingPipelineStuck: dashboard.summary?.issueBreakdown?.pipelineStuck ?? 0,
    replyRepair: repairedReplies
  };
}

export async function operationAccountDetail(accountId) {
  return dbGet('accounts', { id: accountId });
}
