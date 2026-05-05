import 'dotenv/config';
import { dbList } from '../services/supabaseService.js';
import { autoHidePastTokenFailures, shouldAutoHidePastTokenFailure } from '../services/queueVisibilityService.js';

const apply = process.argv.includes('--apply');
const includeRecent = process.argv.includes('--include-recent');
const emailIndex = process.argv.indexOf('--email');
const targetEmail = emailIndex >= 0 ? String(process.argv[emailIndex + 1] || '').toLowerCase() : '';

async function accountIdsForEmail(email) {
  if (!email) return null;
  const users = await dbList('users');
  const user = users.find((row) => String(row.email || '').toLowerCase() === email);
  if (!user) return new Set();
  const links = await dbList('user_accounts', { user_id: user.id });
  return new Set(links.map((row) => row.account_id));
}

async function main() {
  const [accounts, queues] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue')
  ]);
  const allowedAccountIds = await accountIdsForEmail(targetEmail);
  const targetsByAccount = new Map();

  for (const account of accounts) {
    if (allowedAccountIds && !allowedAccountIds.has(account.id)) continue;
    const accountQueues = queues.filter((row) => row.account_id === account.id);
    const targets = accountQueues.filter((row) => shouldAutoHidePastTokenFailure(row, { includeRecent }));
    if (targets.length === 0) continue;
    targetsByAccount.set(account.id, { account, targets, hidden: [] });
  }

  if (apply) {
    for (const item of targetsByAccount.values()) {
      item.hidden = await autoHidePastTokenFailures(item.account.id, {
        includeRecent,
        reason: 'operations_past_failure_cleanup'
      });
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    includeRecent,
    email: targetEmail || null,
    accounts: [...targetsByAccount.values()].map((item) => ({
      accountId: item.account.id,
      accountName: item.account.name,
      targetCount: item.targets.length,
      hiddenCount: item.hidden.length,
      targets: item.targets.map((row) => ({
        id: row.id,
        status: row.status,
        errorCategory: row.error_category,
        scheduledAt: row.scheduled_at,
        updatedAt: row.updated_at
      }))
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
