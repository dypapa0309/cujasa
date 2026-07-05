import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHealth, normalizeCoreBlockReason, processCoreDueQueue, recoverCore } from './cujasaCoreService.js';
import { dbGet, dbInsert } from './supabaseService.js';

test('coreHealth exposes the CUJASA core loop without requiring auxiliary features', async () => {
  const health = await coreHealth();

  assert.equal(health.status, 'ok');
  assert.deepEqual(health.coreLoop, ['login', 'schedule', 'product_match', 'threads_post', 'own_post_reply_link']);
  assert.equal(health.policy.linkFirst, true);
  assert.equal(health.policy.crossAccountReplyLinks, false);
});

test('normalizeCoreBlockReason separates reply, product, tracking, and DB blockers', () => {
  assert.equal(normalizeCoreBlockReason('Threads code 10 댓글 권한 없음'), 'reply_permission');
  assert.equal(normalizeCoreBlockReason('real coupang product missing'), 'product_missing');
  assert.equal(normalizeCoreBlockReason('tracking_link_id missing'), 'tracking_missing');
  assert.equal(normalizeCoreBlockReason('522 Connection timed out'), 'db_unavailable');
});

test('processCoreDueQueue runs stale posting recovery maintenance', async () => {
  const project = await dbInsert('projects', {
    name: 'core stale posting recovery',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'core stale posting account',
    platform: 'threads',
    account_handle: '@core-stale-posting',
    target_audience: '운영자',
    content_scope: '자동화 점검',
    status: 'active',
    automation_status: 'paused'
  });
  const post = await dbInsert('posts', {
    project_id: project.id,
    account_id: account.id,
    content_type: 'question',
    body: '오래 멈춘 posting 큐를 자동 복구합니다.',
    risk_level: 'low',
    status: 'queued'
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: '2000-01-01T00:00:00.000Z',
    status: 'posting',
    retry_count: 0,
    updated_at: '2000-01-01T00:00:00.000Z'
  });

  await processCoreDueQueue({ limit: 1, maxRunMs: 1000 });
  const updated = await dbGet('post_queue', { id: queue.id });

  assert.equal(updated.status, 'manual_required');
  assert.equal(updated.retry_count, 1);
});

test('recoverCore apply recovers stale posting queues', async () => {
  const project = await dbInsert('projects', {
    name: 'core recover apply',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'core recover account',
    platform: 'threads',
    account_handle: '@core-recover',
    target_audience: '운영자',
    content_scope: '자동화 점검',
    status: 'active',
    automation_status: 'paused'
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    platform: 'threads',
    scheduled_at: '2000-01-02T00:00:00.000Z',
    status: 'posting',
    retry_count: 0,
    updated_at: '2000-01-02T00:00:00.000Z'
  });

  const result = await recoverCore({ accountId: account.id, mode: 'apply', limit: 5 });
  const updated = await dbGet('post_queue', { id: queue.id });

  assert.equal(result.stalePosting.recoveredCount >= 1, true);
  assert.equal(updated.status, 'manual_required');
});
