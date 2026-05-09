import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGet, dbInsert } from './supabaseService.js';
import {
  dismissPastQueueIssuesForAccount,
  dismissQueueForCustomer,
  isCustomerDismissibleQueue,
  isCustomerVisibleProblemQueue
} from './queueVisibilityService.js';

async function createPostedReplyIssue(errorCategory = 'reply_repair_blocked', createdAt = '2026-05-08T00:00:00.000Z') {
  const project = await dbInsert('projects', {
    name: 'queue visibility project',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'queue visibility account',
    platform: 'threads',
    status: 'active'
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    platform: 'threads',
    status: 'posted',
    posted_at: createdAt,
    scheduled_at: createdAt,
    error_category: errorCategory,
    error_message: 'REPLY_REPAIR_BLOCKED: 댓글 링크 복구 불가 - tracking_link_missing',
    created_at: createdAt,
    updated_at: createdAt
  });
  return { account, queue };
}

test('posted reply link issues remain customer visible and dismissible', async () => {
  const { queue } = await createPostedReplyIssue('reply_repair_blocked');

  assert.equal(isCustomerVisibleProblemQueue(queue), true);
  assert.equal(isCustomerDismissibleQueue(queue), true);

  await dismissQueueForCustomer(queue, 'customer_confirmed_link_issue');
  const saved = await dbGet('post_queue', { id: queue.id });
  assert.ok(saved.customer_hidden_at);
  assert.equal(saved.customer_hidden_reason, 'customer_confirmed_link_issue');
  assert.equal(saved.status, 'posted');
});

test('dismissPastQueueIssuesForAccount hides old posted reply link issues', async () => {
  const { account, queue } = await createPostedReplyIssue('reply_warning', '2026-05-07T00:00:00.000Z');

  const result = await dismissPastQueueIssuesForAccount(account.id, {
    mode: 'apply',
    before: '2026-05-09T00:00:00.000Z',
    reason: 'customer_past_issue_cleanup'
  });
  const saved = await dbGet('post_queue', { id: queue.id });

  assert.equal(result.hiddenCount, 1);
  assert.ok(result.hiddenIds.includes(queue.id));
  assert.ok(saved.customer_hidden_at);
  assert.equal(saved.status, 'posted');
});
