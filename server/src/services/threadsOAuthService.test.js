import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeQueueClassification } from './queueErrorService.js';
import { dbGet, dbInsert } from './supabaseService.js';
import { createThreadsAuthUrl, markPastTokenFailuresRetryable } from './threadsOAuthService.js';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('createThreadsAuthUrl requests reply permissions for link comments', async () => {
  const previousAppId = process.env.THREADS_APP_ID;
  const previousSecret = process.env.THREADS_APP_SECRET;
  const previousRedirect = process.env.THREADS_REDIRECT_URI;
  process.env.THREADS_APP_ID = 'threads-app-id';
  process.env.THREADS_APP_SECRET = 'threads-app-secret';
  process.env.THREADS_REDIRECT_URI = 'https://app.example.test/api/auth/threads/callback';

  try {
    const project = await dbInsert('projects', {
      name: 'oauth scope project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'oauth scope account',
      platform: 'threads',
      account_handle: '@replyscope',
      status: 'active'
    });

    const authUrl = await createThreadsAuthUrl({
      accountId: account.id,
      user: { type: 'user', userId: 'user-1', email: 'user@example.test', allowedAccountIds: [account.id] }
    });
    const scope = new URL(authUrl).searchParams.get('scope');

    assert.match(scope, /threads_basic/);
    assert.match(scope, /threads_content_publish/);
    assert.match(scope, /threads_manage_replies/);
    assert.match(scope, /threads_read_replies/);
  } finally {
    restoreEnv('THREADS_APP_ID', previousAppId);
    restoreEnv('THREADS_APP_SECRET', previousSecret);
    restoreEnv('THREADS_REDIRECT_URI', previousRedirect);
  }
});

test('markPastTokenFailuresRetryable clears stale reply permission messages after reconnect', async () => {
  const project = await dbInsert('projects', {
    name: 'retry marker project',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'retry marker account',
    platform: 'threads',
    account_handle: '@retry_marker',
    status: 'active'
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    platform: 'threads',
    scheduled_at: '2026-05-09T00:00:00.000Z',
    status: 'manual_required',
    error_category: 'reply_permission_required',
    error_message: 'Threads reply container failed: {"error":{"message":"Application does not have permission for this action","code":10}}'
  });

  const count = await markPastTokenFailuresRetryable(account.id);
  const saved = await dbGet('post_queue', { id: queue.id });
  const classified = normalizeQueueClassification(saved);

  assert.equal(count, 1);
  assert.equal(saved.error_category, 'retry_available');
  assert.equal(saved.error_message, 'Threads 재연결 후 재시도 가능');
  assert.equal(classified.category, 'retry_available');
  assert.equal(classified.severity, 'warn');
});
