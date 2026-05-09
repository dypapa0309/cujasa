import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveUser, createUser, loginUser } from './authService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';

test('archiveUser hides access while preserving records and clearing assignments', async () => {
  const user = await createUser(`archive-${Date.now()}@example.com`, 'password123', 2, '보관 테스트');
  const [account] = await dbList('accounts', {}, { limit: 1 });
  await dbInsert('user_accounts', { user_id: user.id, account_id: account.id });
  await dbInsert('setup_tasks', {
    user_id: user.id,
    product_id: 'onetime_590000',
    status: 'pending',
    source: 'customer_request'
  });

  const archived = await archiveUser(user.id, { reason: 'duplicate_signup', archivedBy: 'admin@example.com' });

  assert.equal(archived.status, 'suspended');
  assert.ok(archived.archived_at);
  assert.equal(archived.archived_reason, 'duplicate_signup');
  assert.equal((await dbList('user_accounts', { user_id: user.id })).length, 0);
  assert.equal((await dbGet('user_products', { user_id: user.id, product_id: 'cujasa' })).status, 'suspended');
  assert.equal((await dbList('setup_tasks', { user_id: user.id }))[0].status, 'canceled');
  await assert.rejects(() => loginUser(user.email, 'password123'), /archived|suspended/i);
});

