import assert from 'node:assert/strict';
import test from 'node:test';

import { dbGet, dbInsert, dbUpdate } from './supabaseService.js';
import {
  markThreadsConnectionRequestConnected,
  syncLatestThreadsRequestToAccount,
  updateThreadsConnectionRequest
} from './threadsConnectionRequestService.js';

async function createRequestFixture(name) {
  const project = await dbInsert('projects', {
    name: `${name} project`,
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: `${name} account`,
    platform: 'threads',
    account_handle: '',
    status: 'active'
  });
  const user = await dbInsert('users', {
    email: `${name}@example.test`,
    password_hash: 'hash',
    buyer_name: name,
    status: 'active'
  });
  const request = await dbInsert('threads_connection_requests', {
    user_id: user.id,
    account_id: account.id,
    threads_handle: '@first_handle',
    status: 'requested'
  });
  return { account, request };
}

test('admin request handle edits sync to account handle', async () => {
  const { account, request } = await createRequestFixture('threads-sync-edit');

  await updateThreadsConnectionRequest(request.id, { threadsHandle: 'next_handle' }, { email: 'admin@example.test' });
  const saved = await dbGet('accounts', { id: account.id });

  assert.equal(saved.account_handle, '@next_handle');
});

test('admin customer-action status syncs latest request handle to blank account', async () => {
  const { account, request } = await createRequestFixture('threads-sync-status');

  await updateThreadsConnectionRequest(request.id, { status: 'customer_action_required' }, { email: 'admin@example.test' });
  const saved = await dbGet('accounts', { id: account.id });

  assert.equal(saved.account_handle, '@first_handle');
});

test('mark connected syncs latest request handle to account', async () => {
  const { account } = await createRequestFixture('threads-sync-connected');

  await markThreadsConnectionRequestConnected(account.id);
  const saved = await dbGet('accounts', { id: account.id });

  assert.equal(saved.account_handle, '@first_handle');
});

test('oauth preflight sync uses latest open request handle before auth start', async () => {
  const { account, request } = await createRequestFixture('threads-sync-preflight');
  await dbUpdate('threads_connection_requests', { id: request.id }, {
    threads_handle: '@latest_handle',
    status: 'customer_action_required'
  });
  await dbUpdate('accounts', { id: account.id }, { account_handle: '@stale_handle' });

  const result = await syncLatestThreadsRequestToAccount(account.id);
  const saved = await dbGet('accounts', { id: account.id });

  assert.equal(result.request.id, request.id);
  assert.equal(saved.account_handle, '@latest_handle');
});
