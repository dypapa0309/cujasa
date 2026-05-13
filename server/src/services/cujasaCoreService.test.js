import test from 'node:test';
import assert from 'node:assert/strict';
import { coreHealth, normalizeCoreBlockReason } from './cujasaCoreService.js';

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
