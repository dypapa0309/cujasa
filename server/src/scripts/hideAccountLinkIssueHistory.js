import 'dotenv/config';
import { dbList, dbUpdate, logActivity } from '../services/supabaseService.js';

const apply = process.argv.includes('--apply');
const emailIndex = process.argv.indexOf('--email');
const handleIndex = process.argv.indexOf('--handle');
const accountIndex = process.argv.indexOf('--account');
const targetEmail = emailIndex >= 0 ? String(process.argv[emailIndex + 1] || '').toLowerCase() : '';
const targetHandle = handleIndex >= 0 ? String(process.argv[handleIndex + 1] || '').replace(/^@/, '').toLowerCase() : '';
const targetAccountName = accountIndex >= 0 ? String(process.argv[accountIndex + 1] || '').toLowerCase() : '';

async function resolveAccountIds() {
  const [users, userAccounts, accounts] = await Promise.all([
    dbList('users'),
    dbList('user_accounts'),
    dbList('accounts')
  ]);
  const ids = new Set();
  if (targetEmail) {
    const user = users.find((row) => String(row.email || '').toLowerCase() === targetEmail);
    if (user) {
      userAccounts.filter((row) => row.user_id === user.id).forEach((row) => ids.add(row.account_id));
    }
  }
  for (const account of accounts) {
    const handle = String(account.account_handle || '').replace(/^@/, '').toLowerCase();
    const name = String(account.name || '').toLowerCase();
    if (targetHandle && handle === targetHandle) ids.add(account.id);
    if (targetAccountName && name === targetAccountName) ids.add(account.id);
  }
  return { ids, accounts };
}

function isLinkIssueHistory(row = {}) {
  if (row.customer_hidden_at) return false;
  if (['failed', 'retry', 'manual_required', 'skipped'].includes(row.status)) return true;
  if (row.status === 'posted' && (!row.tracking_link_id || String(row.post_url || '').includes('/mock/threads/'))) return true;
  return false;
}

async function main() {
  const { ids, accounts } = await resolveAccountIds();
  const queues = await dbList('post_queue');
  const targetsByAccount = new Map();

  for (const queue of queues) {
    if (!ids.has(queue.account_id) || !isLinkIssueHistory(queue)) continue;
    const account = accounts.find((row) => row.id === queue.account_id);
    if (!targetsByAccount.has(queue.account_id)) {
      targetsByAccount.set(queue.account_id, { account, targets: [], hidden: [] });
    }
    targetsByAccount.get(queue.account_id).targets.push(queue);
  }

  if (apply) {
    for (const item of targetsByAccount.values()) {
      for (const queue of item.targets) {
        const [updated] = await dbUpdate('post_queue', { id: queue.id }, {
          customer_hidden_at: new Date().toISOString(),
          customer_hidden_reason: 'link_issue_history_cleanup',
          error_category: queue.status === 'posted' ? 'link_missing_published' : queue.error_category
        });
        item.hidden.push(updated || queue);
      }
      await logActivity({
        account_id: item.account?.id,
        project_id: item.account?.project_id,
        action: 'account_link_issue_history_hidden',
        level: 'info',
        message: `${item.hidden.length}개의 과거 링크/업로드 문제 기록을 고객 화면에서 숨겼습니다.`,
        payload: { count: item.hidden.length }
      }).catch(() => null);
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    email: targetEmail || null,
    handle: targetHandle || null,
    account: targetAccountName || null,
    accounts: [...targetsByAccount.values()].map((item) => ({
      accountId: item.account?.id,
      accountName: item.account?.name,
      targetCount: item.targets.length,
      hiddenCount: item.hidden.length,
      targets: item.targets.map((row) => ({
        id: row.id,
        status: row.status,
        postMode: row.post_mode,
        scheduledAt: row.scheduled_at,
        postedAt: row.posted_at,
        postUrl: row.post_url,
        trackingLinkId: row.tracking_link_id,
        errorCategory: row.error_category
      }))
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
