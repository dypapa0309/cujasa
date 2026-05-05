import { dbList, dbUpdate, logActivity } from './supabaseService.js';
import { normalizeQueueClassification } from './queueErrorService.js';

const CUSTOMER_VISIBLE_PROBLEM_STATUSES = new Set(['failed', 'retry', 'manual_required']);
const CUSTOMER_DISMISSIBLE_STATUSES = new Set(['failed', 'retry', 'manual_required', 'skipped']);
const PAST_TOKEN_CATEGORIES = new Set(['threads_reconnect_required', 'retry_available', 'recheck_required']);
const DEFAULT_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function queueTime(row = {}) {
  return new Date(row.updated_at || row.created_at || row.scheduled_at || 0).getTime() || 0;
}

function isRecent(row = {}, recentWindowMs = DEFAULT_RECENT_WINDOW_MS) {
  return Date.now() - queueTime(row) < recentWindowMs;
}

export function isCustomerVisibleQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  if (row.status === 'skipped') return false;
  return true;
}

export function isCustomerDismissibleQueue(row = {}) {
  return CUSTOMER_DISMISSIBLE_STATUSES.has(row.status);
}

export function isCustomerVisibleProblemQueue(row = {}) {
  return isCustomerVisibleQueue(row) && CUSTOMER_VISIBLE_PROBLEM_STATUSES.has(row.status);
}

export function shouldAutoHidePastTokenFailure(row = {}, options = {}) {
  if (row.customer_hidden_at) return false;
  if (!CUSTOMER_DISMISSIBLE_STATUSES.has(row.status)) return false;
  const classified = normalizeQueueClassification(row, { currentThreadsOk: true });
  if (!PAST_TOKEN_CATEGORIES.has(classified.category)) return false;
  if (!options.includeRecent && isRecent(row, options.recentWindowMs || DEFAULT_RECENT_WINDOW_MS)) return false;
  return true;
}

export async function dismissQueueForCustomer(queue, reason = 'customer_dismissed') {
  if (!queue) {
    const error = new Error('Queue item not found');
    error.status = 404;
    throw error;
  }
  if (!isCustomerDismissibleQueue(queue)) {
    const error = new Error(`Cannot dismiss status: ${queue.status}`);
    error.status = 409;
    throw error;
  }
  const [updated] = await dbUpdate('post_queue', { id: queue.id }, {
    customer_hidden_at: new Date().toISOString(),
    customer_hidden_reason: reason
  });
  await logActivity({
    account_id: queue.account_id,
    project_id: queue.project_id,
    post_id: queue.post_id,
    queue_id: queue.id,
    action: 'queue_customer_hidden',
    level: 'info',
    message: reason
  }).catch(() => null);
  return updated;
}

export async function autoHidePastTokenFailures(accountId, options = {}) {
  const rows = await dbList('post_queue', { account_id: accountId });
  const targets = rows.filter((row) => shouldAutoHidePastTokenFailure(row, options));
  const hidden = [];
  for (const row of targets) {
    const [updated] = await dbUpdate('post_queue', { id: row.id }, {
      customer_hidden_at: new Date().toISOString(),
      customer_hidden_reason: options.reason || 'past_threads_token_failure_auto_hidden',
      error_category: row.error_category || normalizeQueueClassification(row, { currentThreadsOk: true }).category
    });
    hidden.push(updated || row);
  }
  if (hidden.length > 0) {
    await logActivity({
      account_id: accountId,
      action: 'past_queue_errors_auto_hidden',
      level: 'info',
      message: `${hidden.length}개의 과거 Threads 실패 항목을 고객 화면에서 숨겼습니다.`,
      payload: { count: hidden.length, reason: options.reason || 'past_threads_token_failure_auto_hidden' }
    }).catch(() => null);
  }
  return hidden;
}
