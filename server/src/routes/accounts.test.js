import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbInsert } from '../services/supabaseService.js';
import { countActiveAssignedAccounts } from './accounts.js';

test('account slot count only includes active assigned accounts', async () => {
  const userId = randomUUID();
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: 'Account slot count project',
    type: 'coupang',
    status: 'active'
  });

  const activeAccount = await dbInsert('accounts', {
    id: randomUUID(),
    project_id: projectId,
    name: '활성 계정',
    platform: 'threads',
    status: 'active'
  });
  const archivedAccount = await dbInsert('accounts', {
    id: randomUUID(),
    project_id: projectId,
    name: '보관 계정',
    platform: 'threads',
    status: 'archived'
  });
  const pausedAccount = await dbInsert('accounts', {
    id: randomUUID(),
    project_id: projectId,
    name: '중지 계정',
    platform: 'threads',
    status: 'paused'
  });

  await dbInsert('user_accounts', { user_id: userId, account_id: activeAccount.id });
  await dbInsert('user_accounts', { user_id: userId, account_id: archivedAccount.id });
  await dbInsert('user_accounts', { user_id: userId, account_id: pausedAccount.id });

  assert.equal(await countActiveAssignedAccounts(userId), 1);
});
