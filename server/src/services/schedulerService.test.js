import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGet, dbInsert, dbUpdate } from './supabaseService.js';
import { createDailyQueue, recoverReplyLinkModeRequiredQueues, repairReplyLinkFailures, uploadQueueItem } from './schedulerService.js';

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

async function createReplyFailureQueue() {
  const { account, queue } = await createRecoverableReplyQueue();
  const [updated] = await dbUpdateQueue(queue.id, {
    status: 'manual_required',
    retry_count: 1,
    post_url: 'https://www.threads.net/@replytest/post/1234567890',
    error_message: 'Threads reply publish failed: temporary error',
    error_category: 'reply_warning'
  });
  return { account, queue: updated };
}

async function dbUpdateQueue(queueId, patch) {
  return dbUpdate('post_queue', { id: queueId }, patch);
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

test('repairReplyLinkFailures posts only the missing reply and marks queue posted', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousBaseUrl = process.env.APP_BASE_URL;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  process.env.APP_BASE_URL = 'https://app.example.test';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { account, queue } = await createReplyFailureQueue();
    const result = await repairReplyLinkFailures({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 1);
    assert.equal(saved.status, 'posted');
    assert.equal(saved.error_message, null);
    assert.equal(saved.error_category, null);
    assert.ok(saved.tracking_link_id);
    assert.equal(saved.post_url, 'https://www.threads.net/@replytest/post/1234567890');
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('APP_BASE_URL', previousBaseUrl);
    globalThis.fetch = previousFetch;
  }
});

test('repairReplyLinkFailures marks posted reply warnings as blocked when threads post id is missing', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { account, queue } = await createReplyFailureQueue();
    await dbUpdate('post_queue', { id: queue.id }, {
      status: 'posted',
      post_url: 'https://www.threads.net/@replytest',
      error_category: 'reply_warning',
      error_message: 'Threads reply publish failed: temporary error'
    });

    const result = await repairReplyLinkFailures({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(saved.status, 'posted');
    assert.equal(saved.error_category, 'reply_repair_blocked');
    assert.match(saved.error_message, /threads_post_id_missing/);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('repairReplyLinkFailures moves unrecoverable reply failures out of retry loop when product is missing', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replyblocked' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'reply blocked project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'reply blocked account',
      platform: 'threads',
      account_handle: 'replyblocked',
      target_audience: '살림 관심 고객',
      content_scope: '생활용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 1,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 50,
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
      post_url: 'https://www.threads.net/@replyblocked/post/1234567890',
      error_message: 'Threads reply publish failed: temporary error',
      error_category: 'reply_warning'
    });

    const result = await repairReplyLinkFailures({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 0);
    assert.equal(result.targetCount, 1);
    assert.equal(saved.status, 'manual_required');
    assert.equal(saved.error_category, 'reply_repair_blocked');
    assert.equal(saved.retry_count, 3);
    assert.match(saved.error_message, /linkable_product_missing/);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue uses balanced link and no-link mix', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'balanced' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'balanced queue project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'balanced account',
      platform: 'threads',
      account_handle: 'balanced',
      target_audience: '생활 관심 고객',
      content_scope: '생활 꿀팁',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 5,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0.67,
      no_link_post_ratio: 0.33,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const posts = [];
    for (let index = 0; index < 5; index += 1) {
      const topic = await dbInsert('topics', {
        project_id: project.id,
        account_id: account.id,
        title: `생활 팁 ${index}`,
        angle: '댓글 유도'
      });
      const post = await dbInsert('posts', {
        project_id: project.id,
        account_id: account.id,
        topic_id: topic.id,
        content_type: '공감형',
        body: `생활에서 은근 갈리는 선택 ${index}. 여러분은 어떤 쪽이에요?`,
        risk_level: 'low',
        status: 'draft'
      });
      posts.push(post);
      if (index < 3) {
        const product = await dbInsert('coupang_products', {
          project_id: project.id,
          account_id: account.id,
          topic_id: topic.id,
          keyword: '생활용품',
          product_id: `balanced-product-${index}`,
          product_name: '생활용품',
          product_price: 12900,
          product_image: 'https://example.com/image.jpg',
          product_url: `https://www.coupang.com/vp/products/${index}?itemId=2&vendorItemId=3`,
          partner_url: `https://link.coupang.com/re/AFFSDP?pageKey=${index}&itemId=2&vendorItemId=3`,
          category_name: '생활',
          is_fallback: false
        });
        await dbInsert('post_products', {
          topic_id: topic.id,
          product_id: product.id,
          rank: 1,
          fit_score: 90,
          recommendation_reason: '상황에 맞습니다.'
        });
      }
    }

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 5);
    assert.equal(queued.filter((row) => row.post_mode === 'link').length, 3);
    assert.equal(queued.filter((row) => row.post_mode === 'no_link').length, 2);
    assert.equal(queued.diagnostics.requiredLinkCount, 3);
    assert.equal(queued.diagnostics.requiredNoLinkCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue blocks product-linked drafts when previous reply failures need review', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'blockedlinks' })
  });

  try {
    const { account } = await createReplyFailureQueue();
    await dbUpdate('post_queue', { account_id: account.id }, {
      retry_count: 3,
      status: 'manual_required',
      error_category: 'reply_warning'
    });
    for (let index = 0; index < 3; index += 1) {
      const topic = await dbInsert('topics', {
        project_id: account.project_id,
        account_id: account.id,
        title: `생활 링크 후보 ${index}`,
        angle: '댓글 유도'
      });
      await dbInsert('posts', {
        project_id: account.project_id,
        account_id: account.id,
        topic_id: topic.id,
        content_type: '질문형',
        body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽을 보세요, 보기 깔끔한 쪽을 보세요?',
        risk_level: 'low',
        status: 'draft'
      });
      const product = await dbInsert('coupang_products', {
        project_id: account.project_id,
        account_id: account.id,
        topic_id: topic.id,
        keyword: '수납함',
        product_id: `product-reply-blocked-${index}`,
        product_name: '수납함',
        product_price: 12900,
        product_image: 'https://example.com/image.jpg',
        product_url: `https://www.coupang.com/vp/products/${index}?itemId=2&vendorItemId=3`,
        partner_url: `https://link.coupang.com/re/AFFSDP?pageKey=${index}&itemId=2&vendorItemId=3`,
        category_name: '생활',
        is_fallback: false
      });
      await dbInsert('post_products', {
        topic_id: topic.id,
        product_id: product.id,
        rank: 1,
        fit_score: 90,
        recommendation_reason: '상황에 맞습니다.'
      });
    }

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 0);
    assert.equal(queued.filter((row) => row.post_mode === 'link').length, 0);
    assert.equal(queued.filter((row) => row.post_mode === 'no_link').length, 0);
    assert.equal(queued.diagnostics.requiredLinkCount, 1);
    assert.equal(queued.diagnostics.blockedLinkPosts, 1);
    assert.equal(queued.diagnostics.linkPostsBlocked, true);
    assert.equal(queued.diagnostics.reasonCode, 'REPLY_LINK_FAILURE_UNRESOLVED');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('uploadQueueItem keeps link queue in manual review instead of falling back to no-link', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { account } = await createReplyFailureQueue();
    await dbUpdate('post_queue', { account_id: account.id }, {
      retry_count: 3,
      status: 'manual_required',
      error_category: 'reply_warning'
    });
    const topic = await dbInsert('topics', {
      project_id: account.project_id,
      account_id: account.id,
      title: '생활 수납 추가',
      angle: '꺼내기 쉬운 기준'
    });
    const post = await dbInsert('posts', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      content_type: '공감형',
      body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽을 보세요, 보기 깔끔한 쪽을 보세요?',
      risk_level: 'low',
      status: 'queued'
    });
    const product = await dbInsert('coupang_products', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      keyword: '수납함',
      product_id: 'product-fallback-1',
      product_name: '수납함',
      product_price: 12900,
      product_image: 'https://example.com/image.jpg',
      product_url: 'https://www.coupang.com/vp/products/11?itemId=2&vendorItemId=3',
      partner_url: 'https://link.coupang.com/re/AFFSDP?pageKey=11&itemId=2&vendorItemId=3',
      category_name: '생활',
      is_fallback: false
    });
    await dbInsert('post_products', {
      topic_id: topic.id,
      product_id: product.id,
      rank: 1,
      fit_score: 90,
      recommendation_reason: '상황에 맞습니다.'
    });
    const queue = await dbInsert('post_queue', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      post_id: post.id,
      platform: 'threads',
      scheduled_at: '2026-05-09T00:00:00.000Z',
      status: 'scheduled',
      post_mode: 'link',
      retry_count: 0
    });

    const uploaded = await uploadQueueItem(queue.id);

    assert.equal(uploaded.status, 'manual_required');
    assert.equal(uploaded.post_mode, 'link');
    assert.match(uploaded.error_message, /REPLY_LINK_FAILURE_UNRESOLVED/);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});
