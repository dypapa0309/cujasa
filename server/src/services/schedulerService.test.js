import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGet, dbInsert } from './supabaseService.js';
import { recoverReplyLinkModeRequiredQueues, uploadQueueItem } from './schedulerService.js';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function createRecoverableReplyQueue() {
  const project = await dbInsert('projects', {
    name: 'reply recovery project',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'reply recovery account',
    platform: 'threads',
    account_handle: 'replytest',
    target_audience: '살림 관심 고객',
    content_scope: '생활용품',
    forbidden_topics: [],
    forbidden_words: [],
    daily_post_max: 1,
    active_time_windows: [{ start: '09:00', end: '23:00' }],
    min_interval_minutes: 50,
    link_post_ratio: 1,
    no_link_post_ratio: 0,
    status: 'active',
    automation_status: 'running',
    threads_access_token: 'token',
    threads_link_delivery_mode: 'reply',
    coupang_access_key: 'access',
    coupang_secret_key: 'secret',
    coupang_partner_id: 'partner',
    coupang_search_status: 'ok'
  });
  const topic = await dbInsert('topics', {
    project_id: project.id,
    account_id: account.id,
    title: '생활 수납',
    angle: '꺼내기 쉬운 수납'
  });
  const post = await dbInsert('posts', {
    project_id: project.id,
    account_id: account.id,
    topic_id: topic.id,
    content_type: '공감형',
    body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽이에요, 보기 깔끔한 쪽이에요?',
    risk_level: 'low',
    status: 'queued'
  });
  const product = await dbInsert('coupang_products', {
    project_id: project.id,
    account_id: account.id,
    topic_id: topic.id,
    keyword: '수납함',
    product_id: 'product-1',
    product_name: '튼튼 수납함',
    product_price: 12900,
    product_image: 'https://example.com/image.jpg',
    product_url: 'https://www.coupang.com/vp/products/1?itemId=2&vendorItemId=3',
    partner_url: 'https://link.coupang.com/re/AFFSDP?lptag=partner&pageKey=1&itemId=2&vendorItemId=3',
    category_name: '생활',
    is_fallback: false
  });
  await dbInsert('post_products', {
    topic_id: topic.id,
    product_id: product.id,
    rank: 1,
    fit_score: 90,
    recommendation_reason: '수납 상황에 맞습니다.'
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    topic_id: topic.id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: '2026-05-09T00:00:00.000Z',
    status: 'manual_required',
    post_mode: 'link',
    retry_count: 1,
    error_message: 'REPLY_LINK_MODE_REQUIRED: 링크 글은 댓글 링크 모드에서만 예약/업로드할 수 있습니다.',
    error_category: 'manual_required'
  });
  return { account, queue };
}

test('uploadQueueItem allows recoverable REPLY_LINK_MODE_REQUIRED queues when env is unset', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousReply = process.env.THREADS_REPLY_LINK_MODE_ENABLED;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  delete process.env.THREADS_REPLY_LINK_MODE_ENABLED;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { queue } = await createRecoverableReplyQueue();
    const uploaded = await uploadQueueItem(queue.id);

    assert.equal(uploaded.status, 'posted');
    assert.equal(uploaded.error_message, null);
    assert.ok(uploaded.tracking_link_id);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('THREADS_REPLY_LINK_MODE_ENABLED', previousReply);
    globalThis.fetch = previousFetch;
  }
});

test('recoverReplyLinkModeRequiredQueues turns matching failures back into retry', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { account, queue } = await createRecoverableReplyQueue();
    const result = await recoverReplyLinkModeRequiredQueues({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.recoveredCount, 1);
    assert.equal(saved.status, 'retry');
    assert.equal(saved.error_message, null);
    assert.equal(saved.error_category, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
