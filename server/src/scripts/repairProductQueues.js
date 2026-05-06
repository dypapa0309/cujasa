import 'dotenv/config';
import { dbGet, dbList, dbUpdate } from '../services/supabaseService.js';
import { isAutomationRunning } from '../services/accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const apply = process.argv.includes('--apply');

async function topicHasRealProduct(topicId) {
  if (!topicId) return false;
  const rows = await dbList('post_products', { topic_id: topicId });
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    if (isRealCoupangProduct(product)) return true;
  }
  return false;
}

async function main() {
  const accounts = await dbList('accounts');
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const queues = await dbList('post_queue');
  const accountsWithScheduledQueue = new Set(queues.filter((queue) => queue.status === 'scheduled').map((queue) => queue.account_id));
  const impacted = new Map();

  for (const queue of queues) {
    const account = accountById.get(queue.account_id);
    if (!account || !isAutomationRunning(account)) continue;
    if (queue.post_mode === 'no_link') continue;
    const alreadySkippedForRepair = queue.status === 'skipped'
      && queue.error_message === '실상품 연결이 없는 과거 예약이라 자동 복구를 위해 취소됨';
    if (queue.status !== 'scheduled' && !alreadySkippedForRepair) continue;
    if (alreadySkippedForRepair && accountsWithScheduledQueue.has(account.id)) continue;

    const hasReal = await topicHasRealProduct(queue.topic_id);
    if (queue.post_mode === 'link' && hasReal) continue;
    if (queue.post_mode === 'auto' && hasReal) continue;

    if (!impacted.has(account.id)) {
      impacted.set(account.id, {
        account,
        downgradedQueues: [],
        recreatedQueues: [],
        errors: []
      });
    }
    impacted.get(account.id).downgradedQueues.push(queue);
  }

  if (apply) {
    for (const item of impacted.values()) {
      for (const queue of item.downgradedQueues) {
        try {
          await dbUpdate('post_queue', { id: queue.id }, {
            status: 'skipped',
            error_message: '실상품 연결이 없어 링크 전용 정책에 따라 업로드하지 않음'
          });
          if (queue.post_id) await dbUpdate('posts', { id: queue.post_id }, { status: 'draft' });
          item.recreatedQueues.push({
            id: queue.id,
            postMode: queue.post_mode,
            scheduledAt: queue.scheduled_at
          });
        } catch (error) {
          item.errors.push(error.message);
        }
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    impactedAccounts: [...impacted.values()].map((item) => ({
      accountId: item.account.id,
      accountName: item.account.name,
      downgradedQueueCount: item.downgradedQueues.length,
      downgradedQueues: item.downgradedQueues.map((queue) => ({
        id: queue.id,
        postMode: queue.post_mode,
        scheduledAt: queue.scheduled_at,
        postId: queue.post_id
      })),
      recreatedQueues: item.recreatedQueues,
      diagnostics: item.diagnostics,
      errors: item.errors
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
