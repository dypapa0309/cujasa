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

test('preserves existing schedule settings when undefined fields are submitted', async () => {
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: 'Undefined schedule settings project',
    type: 'coupang',
    status: 'active'
  });
  const account = await createAccount({
    project_id: projectId,
    name: '부분 저장 계정',
    target_audience: '기존 타겟',
    content_scope: '기존 주제',
    daily_post_max: 1,
    active_time_windows: [{ start: '14:00', end: '14:00' }],
    min_interval_minutes: 20
  });

  const updated = await updateAccount(account.id, {
    target_audience: '수정 타겟',
    daily_post_max: undefined,
    active_time_windows: undefined,
    min_interval_minutes: undefined
  });

  assert.equal(updated.target_audience, '수정 타겟');
  assert.equal(updated.daily_post_max, 1);
  assert.deepEqual(updated.active_time_windows, [{ start: '14:00', end: '14:00' }]);
  assert.equal(updated.min_interval_minutes, 20);
});

test('normalizes customer-facing content and schedule settings', async () => {
  const projectId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: 'Customer settings normalization project',
    type: 'coupang',
    status: 'active'
  });
  const account = await createAccount({
    project_id: projectId,
    name: '고객 설정 계정',
    target_audience: '기존 타겟',
    content_scope: '기존 주제'
  });

  const updated = await updateAccount(account.id, {
    account_handle: 'customer.handle',
    target_audience: '처음 자취하는 20대',
    content_scope: '자취용품, 원룸 수납',
    tone: '친근하고 실제 후기처럼 짧게',
    content_mode: 'safe_debate',
    safe_debate_enabled: false,
    content_intensity: 'loud',
    comment_induction_style: 'choice_question',
    product_mention_style: 'direct',
    emoji_level: 'none',
    seasonality_enabled: false,
    anonymous_learning_enabled: true,
    daily_post_min: 4,
    daily_post_max: 99,
    active_time_windows: [{ start: '09:30', end: '09:30' }],
    min_interval_minutes: 0,
    forbidden_topics: ['의약품'],
    forbidden_words: ['100%']
  });

  assert.equal(updated.account_handle, '@customer.handle');
  assert.equal(updated.target_audience, '처음 자취하는 20대');
  assert.equal(updated.content_scope, '자취용품, 원룸 수납');
  assert.equal(updated.content_mode, 'question');
  assert.equal(updated.content_intensity, 'normal');
  assert.equal(updated.comment_induction_style, 'choice_question');
  assert.equal(updated.product_mention_style, 'direct');
  assert.equal(updated.emoji_level, 'none');
  assert.equal(updated.seasonality_enabled, false);
  assert.equal(updated.anonymous_learning_enabled, true);
  assert.equal(updated.daily_post_min, 0);
  assert.equal(updated.daily_post_max, 5);
  assert.deepEqual(updated.active_time_windows, [{ start: '09:30', end: '09:30' }]);
  assert.equal(updated.min_interval_minutes, 1);
  assert.deepEqual(updated.forbidden_topics, ['의약품']);
  assert.deepEqual(updated.forbidden_words, ['100%']);
});
