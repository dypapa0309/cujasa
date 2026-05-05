import 'dotenv/config';
import { dbList, dbUpdate, logActivity } from '../services/supabaseService.js';
import { normalizeQueueClassification } from '../services/queueErrorService.js';

const apply = process.argv.includes('--apply');
const includeRecent = process.argv.includes('--include-recent');
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function queueTime(row = {}) {
  return new Date(row.updated_at || row.created_at || row.scheduled_at || 0).getTime() || 0;
}

function isRecent(row = {}) {
  return Date.now() - queueTime(row) < RECENT_WINDOW_MS;
}

function isCurrentThreadsOk(account = {}) {
  return Boolean(account.threads_access_token)
    && account.threads_token_status !== 'refresh_failed'
    && (!account.threads_token_expires_at || new Date(account.threads_token_expires_at).getTime() > Date.now());
}

function isVisible(row = {}) {
  return !row.customer_hidden_at && row.status !== 'skipped';
}

function isProblem(row = {}) {
  return ['failed', 'retry', 'manual_required'].includes(row.status);
}

function isRealProduct(product = {}) {
  return Boolean(product && product.is_fallback !== true && product.product_price != null && product.product_image && (product.partner_url || product.product_url));
}

function isReplyFailure(row = {}) {
  const value = `${row.error_category || ''} ${row.error_message || ''}`;
  return /reply_warning|reply container failed|reply publish failed|permission for this action|code"?\s*:\s*10/i.test(value);
}

function isPastTokenFailure(row = {}, currentThreadsOk) {
  if (!currentThreadsOk || row.customer_hidden_at || !isProblem(row)) return false;
  if (!includeRecent && isRecent(row)) return false;
  const category = normalizeQueueClassification(row, { currentThreadsOk }).category;
  return ['threads_reconnect_required', 'retry_available', 'recheck_required'].includes(category);
}

function isLinkMissingHistory(row = {}) {
  if (row.customer_hidden_at || row.status !== 'posted') return false;
  if (String(row.post_url || '').includes('/mock/threads/')) return true;
  if (row.error_category === 'link_missing_published') return true;
  return row.post_mode === 'link' && !row.tracking_link_id;
}

async function main() {
  const [accounts, queues, users, userAccounts, products] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue'),
    dbList('users'),
    dbList('user_accounts'),
    dbList('coupang_products')
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const emailsByAccount = new Map();
  for (const link of userAccounts) {
    const email = usersById.get(link.user_id)?.email;
    if (!email) continue;
    if (!emailsByAccount.has(link.account_id)) emailsByAccount.set(link.account_id, []);
    emailsByAccount.get(link.account_id).push(email);
  }

  const summaries = [];
  for (const account of accounts.filter((row) => row.status === 'active' || row.automation_status === 'running')) {
    const accountQueues = queues.filter((row) => row.account_id === account.id);
    const accountProducts = products.filter((row) => row.account_id === account.id);
    const visible = accountQueues.filter(isVisible);
    const problems = visible.filter(isProblem);
    const currentThreadsOk = isCurrentThreadsOk(account);
    const tokenTargets = accountQueues.filter((row) => isPastTokenFailure(row, currentThreadsOk));
    const replyTargets = problems.filter(isReplyFailure);
    const linkHistoryTargets = accountQueues.filter(isLinkMissingHistory);
    const shouldEnableBodyFallback = replyTargets.length > 0 && account.threads_link_delivery_mode !== 'body_fallback';
    const hidden = [];
    let bodyFallbackEnabled = false;

    if (apply) {
      if (shouldEnableBodyFallback) {
        await dbUpdate('accounts', { id: account.id }, { threads_link_delivery_mode: 'body_fallback' });
        bodyFallbackEnabled = true;
        await logActivity({
          account_id: account.id,
          project_id: account.project_id,
          action: 'threads_link_delivery_body_fallback_enabled',
          level: 'warn',
          message: '댓글 권한 실패 이력으로 이후 링크 글은 본문 하단 링크 백업 방식으로 발행합니다.',
          payload: { code: 'THREADS_BODY_FALLBACK_ENABLED' }
        }).catch(() => null);
      }
      for (const row of [...tokenTargets, ...replyTargets, ...linkHistoryTargets]) {
        if (hidden.includes(row.id)) continue;
        const [updated] = await dbUpdate('post_queue', { id: row.id }, {
          customer_hidden_at: new Date().toISOString(),
          customer_hidden_reason: isReplyFailure(row)
            ? 'reply_failure_body_fallback_enabled'
            : isLinkMissingHistory(row)
              ? 'link_issue_history_cleanup'
              : 'past_threads_token_failure_auto_hidden',
          error_category: isLinkMissingHistory(row) ? 'link_missing_published' : row.error_category
        });
        hidden.push(updated?.id || row.id);
      }
      if (hidden.length > 0) {
        await logActivity({
          account_id: account.id,
          project_id: account.project_id,
          action: 'account_stabilization_cleanup',
          level: 'info',
          message: `${hidden.length}개의 과거 실패/링크 문제 기록을 고객 화면에서 숨겼습니다.`,
          payload: { count: hidden.length, code: 'PAST_FAILURE_HIDDEN' }
        }).catch(() => null);
      }
    }

    summaries.push({
      accountId: account.id,
      accountName: account.name,
      accountHandle: account.account_handle,
      emails: emailsByAccount.get(account.id) || [],
      status: account.status,
      automationStatus: account.automation_status,
      threadsTokenStatus: account.threads_token_status,
      threadsLinkDeliveryMode: bodyFallbackEnabled ? 'body_fallback' : (account.threads_link_delivery_mode || 'reply'),
      coupangSearchStatus: account.coupang_search_status || 'ok',
      coupangCooldownUntil: account.coupang_search_cooldown_until || null,
      visible: {
        scheduled: visible.filter((row) => row.status === 'scheduled').length,
        posted: visible.filter((row) => row.status === 'posted').length,
        problems: problems.length,
        skipped: visible.filter((row) => row.status === 'skipped').length,
        hidden: accountQueues.filter((row) => row.customer_hidden_at).length
      },
      products: {
        total: accountProducts.length,
        real: accountProducts.filter(isRealProduct).length,
        fallback: accountProducts.filter((row) => row.is_fallback).length
      },
      actions: {
        tokenFailuresToHide: tokenTargets.length,
        replyFailuresToHide: replyTargets.length,
        linkHistoryToHide: linkHistoryTargets.length,
        bodyFallbackToEnable: shouldEnableBodyFallback,
        hiddenCount: hidden.length
      }
    });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    includeRecent,
    generatedAt: new Date().toISOString(),
    accounts: summaries.sort((a, b) => (
      b.actions.tokenFailuresToHide + b.actions.replyFailuresToHide + b.actions.linkHistoryToHide + Number(b.actions.bodyFallbackToEnable)
    ) - (
      a.actions.tokenFailuresToHide + a.actions.replyFailuresToHide + a.actions.linkHistoryToHide + Number(a.actions.bodyFallbackToEnable)
    ))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
