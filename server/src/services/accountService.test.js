import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dbInsert } from './supabaseService.js';
import { createAccount, getAccount, updateAccount } from './accountService.js';

test('updates account settings while ignoring dashboard-only fields', async () => {
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: 'Account settings test project',
    type: 'coupang',
    status: 'active'
  });
  const account = await createAccount({
    project_id: projectId,
    name: '기존 계정',
    target_audience: '기존 타겟',
    content_scope: '기존 주제',
    coupang_access_key: 'old-access',
    coupang_secret_key: 'old-secret',
    coupang_partner_id: 'old-partner',
    coupang_tracking_code: 'old-track'
  });

  const updated = await updateAccount(account.id, {
    owner: { id: 'dashboard-only-owner' },
    owner_label: '화면 표시용 고객',
    has_coupang_access_key: true,
    masked_coupang_access_key: '••••cess',
    pipelineRun: { status: 'completed' },
    target_audience: '수정 타겟',
    content_scope: '수정 주제',
    coupang_access_key: 'new-access',
    coupang_secret_key: 'new-secret',
    coupang_partner_id: 'new-partner',
    coupang_tracking_code: 'new-track'
  });

  assert.equal(updated.target_audience, '수정 타겟');
  assert.equal(updated.content_scope, '수정 주제');
  assert.equal(updated.coupang_access_key, 'new-access');
  assert.equal(updated.coupang_secret_key, 'new-secret');
  assert.equal(updated.coupang_partner_id, 'new-partner');
  assert.equal(updated.coupang_tracking_code, 'new-track');
  assert.equal(updated.owner, undefined);
  assert.equal(updated.owner_label, undefined);
  assert.equal(updated.masked_coupang_access_key, undefined);
  assert.equal(updated.has_coupang_access_key, undefined);
});

test('preserves stored sensitive account values when blanks are submitted', async () => {
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: 'Sensitive settings test project',
    type: 'coupang',
    status: 'active'
  });
  const account = await createAccount({
    project_id: projectId,
    name: '민감값 계정',
    target_audience: '타겟',
    content_scope: '주제',
    coupang_access_key: 'stored-access',
    coupang_secret_key: 'stored-secret',
    coupang_partner_id: 'stored-partner',
    coupang_tracking_code: 'stored-track'
  });

  await updateAccount(account.id, {
    target_audience: '빈 민감값 저장 테스트',
    coupang_access_key: '',
    coupang_secret_key: '   ',
    coupang_partner_id: null,
    coupang_tracking_code: undefined
  });

  const updated = await getAccount(account.id);
  assert.equal(updated.target_audience, '빈 민감값 저장 테스트');
  assert.equal(updated.coupang_access_key, 'stored-access');
  assert.equal(updated.coupang_secret_key, 'stored-secret');
  assert.equal(updated.coupang_partner_id, 'stored-partner');
  assert.equal(updated.coupang_tracking_code, 'stored-track');
});
