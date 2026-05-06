import { dbGet, dbList, dbUpdate } from './supabaseService.js';
import { latestPipelineRun } from './pipelineRunService.js';
import { resolveCoupangCredentialsForAccount } from './coupangService.js';
import { adminActivityLabel, adminActivityMessage, normalizeQueueClassification } from './queueErrorService.js';
import { preflightAccount } from './accountPreflightService.js';

const QUEUE_PROBLEM_STATUSES = ['failed', 'retry', 'manual_required'];
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const NON_FATAL_QUEUE_CATEGORIES = new Set(['reply_warning', 'content_blocked', 'retry_available', 'recheck_required']);

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

function tokenStateFromPreflight(account, preflight) {
  if (!preflight) return tokenState(account);
  const tokenCheck = preflight.checks.find((check) => check.key === 'threads_token');
  const handleCheck = preflight.checks.find((check) => check.key === 'threads_handle');
  const expiryCheck = preflight.checks.find((check) => check.key === 'threads_expiry');
  const fatal = handleCheck?.status === 'error' ? handleCheck : (tokenCheck?.status === 'error' ? tokenCheck : (expiryCheck?.status === 'error' ? expiryCheck : null));
  if (fatal) return { status: 'error', label: fatal.action === 'reconnect_threads' ? '다시 연결 필요' : fatal.title };
  if (tokenCheck?.status === 'ok') {
    if (expiryCheck?.status === 'warn') return { status: 'warn', label: expiryCheck.title };
    return { status: 'ok', label: '연결됨' };
  }
  if (expiryCheck?.status === 'warn') return { status: 'warn', label: expiryCheck.title };
  return tokenState(account);
}

async function coupangState(account) {
  const creds = await resolveCoupangCredentialsForAccount(account);
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
    return user?.buyer_name || user?.email;
  }).filter(Boolean);
  return labels.join(', ');
}

export async function operationAccountRows() {
  const { start, end } = kstDayRange();
  const [
    accounts,
    queue,
    products,
    activityLogs,
    users,
    userAccounts
  ] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue'),
    dbList('coupang_products'),
    dbList('activity_logs', {}, { order: 'created_at', ascending: false, limit: 300 }),
    dbList('users'),
    dbList('user_accounts')
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeAccounts = accounts.filter((account) => account.status === 'active');

  return Promise.all(activeAccounts.map(async (account) => {
    const accountQueue = queue.filter((row) => row.account_id === account.id);
    const todayQueue = accountQueue.filter((row) => inRange(row.scheduled_at, start, end));
    const todayScheduled = todayQueue.filter((row) => row.status === 'scheduled').length;
    const todayPosted = accountQueue.filter((row) => row.status === 'posted' && inRange(row.posted_at || row.scheduled_at, start, end)).length;
    const problemQueue = accountQueue.filter((row) => QUEUE_PROBLEM_STATUSES.includes(row.status));
    const mockCount = accountQueue.filter((row) => String(row.post_url || '').includes('/mock/threads/')).length;
    const accountProducts = products.filter((row) => row.account_id === account.id);
    const fallbackCount = accountProducts.filter((row) => row.is_fallback).length;
    const fallbackRatio = accountProducts.length ? fallbackCount / accountProducts.length : 0;
    const recentPosted = accountQueue
      .filter((row) => row.status === 'posted' && row.posted_at)
      .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))[0];
    const lastActivity = activityLogs.find((row) => row.account_id === account.id) || null;
    const pipelineRun = await latestPipelineRun(account.id);
    const tokenPreflight = await preflightAccount(account.id, { includeQueue: false }).catch(() => null);
    const threads = tokenStateFromPreflight(account, tokenPreflight);
    const coupang = await coupangState(account);
    const customer = await customerLabelFor(account.id, userAccounts, usersById);
    const problems = [];
    const currentThreadsOk = threads.status !== 'error';
    const categorizedProblems = problemQueue.map((row) => normalizeQueueClassification(row, { currentThreadsOk }));
    const failedCount = categorizedProblems.filter((row) => !NON_FATAL_QUEUE_CATEGORIES.has(row.category)).length;
    const replyWarningCount = categorizedProblems.filter((row) => row.category === 'reply_warning').length;
    const retryAvailableCount = categorizedProblems.filter((row) => row.category === 'retry_available' || row.category === 'recheck_required').length;
    const contentBlockedCount = categorizedProblems.filter((row) => row.category === 'content_blocked').length;

    if (threads.status === 'error') pushProblem(problems, account, 'error', 'threads', threads.label);
    else if (threads.status === 'warn') pushProblem(problems, account, 'warn', 'threads', `Threads ${threads.label}`);
    if (coupang.status === 'error') pushProblem(problems, account, 'error', 'coupang', '쿠팡 API 키 누락', coupang.missing.join(', '));
    if (coupang.searchStatus === 'rate_limited') pushProblem(problems, account, 'warn', 'coupang_rate_limit', '쿠팡 검색 제한 중', coupang.cooldownUntil || '');
    if (coupang.searchStatus === 'api_error') pushProblem(problems, account, 'warn', 'coupang_api_error', '쿠팡 API 오류');
    if (account.status === 'active' && todayScheduled === 0) pushProblem(problems, account, 'warn', 'no_schedule', '오늘 예약 없음');
    if (failedCount > 0) {
      const reconnectCount = categorizedProblems.filter((row) => row.category === 'threads_reconnect_required').length;
      pushProblem(problems, account, 'error', 'queue_failed', reconnectCount ? `재연결 필요 ${reconnectCount}건` : `실패/검토 ${failedCount}건`);
    }
    if (retryAvailableCount > 0) pushProblem(problems, account, 'warn', 'retry_available', `재연결 후 재시도 가능 ${retryAvailableCount}건`);
    if (replyWarningCount > 0) pushProblem(problems, account, 'warn', 'reply_warning', `댓글/링크 답글 실패 ${replyWarningCount}건`);
    if (contentBlockedCount > 0) pushProblem(problems, account, 'warn', 'content_blocked', `콘텐츠 후보 제외 ${contentBlockedCount}건`);
    if (mockCount > 0) pushProblem(problems, account, 'warn', 'mock_upload', `테스트 업로드 흔적 ${mockCount}건`);
    if (fallbackRatio >= 0.5 && accountProducts.length >= 5) pushProblem(problems, account, 'warn', 'fallback_products', `fallback 상품 ${Math.round(fallbackRatio * 100)}%`);
    if ((lastActivity?.action === 'pipeline_failed' || pipelineRun?.status === 'failed') && problems.some((p) => p.severity === 'error')) {
      pushProblem(problems, account, 'error', 'pipeline_failed', '최근 파이프라인 실패', pipelineRun?.error_message || lastActivity?.message || '');
    }
    if (pipelineRun?.status === 'expired') {
      pushProblem(problems, account, 'warn', 'pipeline_expired', '최근 예약 작업 만료', pipelineRun.error_message || '');
    }

    return {
      accountId: account.id,
      accountName: account.name,
      accountHandle: account.account_handle,
      customer,
      accountStatus: account.status,
      health: pipelineRun?.status === 'running' ? 'running' : problems.some((p) => p.severity === 'error') ? 'error' : problems.length ? 'warn' : 'ok',
      threads,
      coupang,
      todayScheduled,
      todayPosted,
      failedCount,
      replyWarningCount,
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
        status: pipelineRun.status,
        startedAt: pipelineRun.started_at,
        finishedAt: pipelineRun.finished_at,
        errorMessage: pipelineRun.error_message
      } : null,
      problems
    };
  }));
}

export async function operationSummary() {
  const { start, end } = kstDayRange();
  const [accounts, queue, rows] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue'),
    operationAccountRows()
  ]);
  const activeAccountIds = new Set(accounts.filter((account) => account.status === 'active').map((account) => account.id));
  const activeQueue = queue.filter((row) => activeAccountIds.has(row.account_id));
  const todayQueue = activeQueue.filter((row) => inRange(row.scheduled_at, start, end));
  const threadsOkByAccountId = new Map(rows.map((row) => [row.accountId, row.threads.status !== 'error']));
  const problemAccounts = rows.flatMap((row) => row.problems).sort((a, b) => {
    const rank = { error: 0, warn: 1, ok: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  return {
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
    problemAccounts
  };
}

export async function cleanupQueueErrors({ mode = 'dry-run' } = {}) {
  const rows = await dbList('post_queue');
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

export async function operationAccountDetail(accountId) {
  return dbGet('accounts', { id: accountId });
}
