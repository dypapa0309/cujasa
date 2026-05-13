import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { createDailyQueue, recoverReplyLinkModeRequiredQueues, recoverStalePostingQueue, repairReplyLinkFailures, uploadQueueItem } from './schedulerService.js';

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

test('repairReplyLinkFailures dry-run previews without posting or mutating queue', async () => {
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
    const result = await repairReplyLinkFailures({ accountId: account.id, dryRun: true });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.dryRun, true);
    assert.equal(result.wouldRepairCount, 1);
    assert.equal(result.repairedCount, 0);
    assert.equal(saved.status, 'manual_required');
    assert.equal(saved.error_category, 'reply_warning');
    assert.equal(saved.tracking_link_id, undefined);
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

test('createDailyQueue keeps product-linked drafts when only old reply warnings need review', async () => {
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
      error_category: 'reply_warning',
      updated_at: '2026-05-01T00:00:00.000Z'
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
    assert.equal(queued.length, 1);
    assert.equal(queued.filter((row) => row.post_mode === 'link').length, 1);
    assert.equal(queued.filter((row) => row.post_mode === 'no_link').length, 0);
    assert.equal(queued.diagnostics.requiredLinkCount, 1);
    assert.equal(queued.diagnostics.blockedLinkPosts, 0);
    assert.equal(queued.diagnostics.linkPostsBlocked, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue blocks link drafts when active reply permission is still missing', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'permissionblocked' })
  });

  try {
    const { account } = await createReplyFailureQueue();
    await dbUpdate('post_queue', { account_id: account.id }, {
      retry_count: 1,
      status: 'manual_required',
      error_category: 'reply_permission_required',
      error_message: 'Threads reply publish failed: {"error":{"message":"Application does not have permission for this action","code":10}}'
    });
    const topic = await dbInsert('topics', {
      project_id: account.project_id,
      account_id: account.id,
      title: '생활 링크 권한 차단',
      angle: '댓글 유도'
    });
    await dbInsert('posts', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      content_type: '질문형',
      body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽이에요, 보기 깔끔한 쪽이에요?',
      risk_level: 'low',
      status: 'draft'
    });
    const product = await dbInsert('coupang_products', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      keyword: '수납함',
      product_id: 'product-reply-permission-blocked',
      product_name: '수납함',
      product_price: 12900,
      product_image: 'https://example.com/image.jpg',
      product_url: 'https://www.coupang.com/vp/products/55?itemId=2&vendorItemId=3',
      partner_url: 'https://link.coupang.com/re/AFFSDP?pageKey=55&itemId=2&vendorItemId=3',
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
    await dbInsert('posts', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: null,
      content_type: '일상형',
      body: '오늘은 정리 루틴을 가볍게 점검해보는 날이에요. 여러분은 어디부터 시작하세요?',
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 0);
    assert.equal(queued.diagnostics.linkPostsBlocked, true);
    assert.equal(queued.diagnostics.reasonCode, 'REPLY_PERMISSION_REQUIRED');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue resumes link drafts after Threads reconnect supersedes reply permission failures', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'reconnectedlinks' })
  });

  try {
    const { account, queue } = await createReplyFailureQueue();
    await dbUpdate('post_queue', { id: queue.id }, {
      status: 'posted',
      error_category: 'reply_permission_required',
      error_message: 'Threads reply publish failed: {"error":{"message":"Application does not have permission for this action","code":10}}'
    });
    await dbUpdate('accounts', { id: account.id }, {
      threads_connected_at: new Date(Date.now() + 1000).toISOString(),
      threads_token_status: 'connected'
    });
    const topic = await dbInsert('topics', {
      project_id: account.project_id,
      account_id: account.id,
      title: '생활 수납',
      angle: '꺼내기 쉬운 수납'
    });
    const post = await dbInsert('posts', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      content_type: '질문형',
      body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽이에요, 보기 깔끔한 쪽이에요?',
      risk_level: 'low',
      status: 'draft'
    });
    const product = await dbInsert('coupang_products', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      keyword: '수납함',
      product_id: 'product-reconnected-link',
      product_name: '정리 수납함',
      product_price: 12900,
      product_image: 'https://example.com/image.jpg',
      product_url: 'https://www.coupang.com/vp/products/11?itemId=22&vendorItemId=33',
      partner_url: 'https://link.coupang.com/re/AFFSDP?pageKey=11&itemId=22&vendorItemId=33',
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

    const queued = await createDailyQueue(account.id, { skipPreflight: true });

    assert.equal(queued.diagnostics.linkPostsBlocked, false);
    assert.equal(queued.filter((row) => row.post_mode === 'link').length, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('repairReplyLinkFailures repairs reply permission failures after reconnect', async () => {
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
    await dbUpdate('post_queue', { id: queue.id }, {
      status: 'posted',
      error_category: 'reply_permission_required',
      error_message: 'Threads reply publish failed: {"error":{"message":"Application does not have permission for this action","code":10}}'
    });
    await dbUpdate('accounts', { id: account.id }, {
      threads_connected_at: new Date(Date.now() + 1000).toISOString(),
      threads_token_status: 'connected'
    });

    const result = await repairReplyLinkFailures({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 1);
    assert.equal(saved.status, 'posted');
    assert.equal(saved.error_message, null);
    assert.equal(saved.error_category, null);
    assert.ok(saved.tracking_link_id);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('APP_BASE_URL', previousBaseUrl);
    globalThis.fetch = previousFetch;
  }
});

test('repairReplyLinkFailures repairs reconnect-marked retryable link comments', async () => {
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
    await dbUpdate('post_queue', { id: queue.id }, {
      error_category: 'retry_available',
      error_message: 'Threads 재연결 후 재시도 가능'
    });

    const result = await repairReplyLinkFailures({ accountId: account.id });
    const saved = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 1);
    assert.equal(saved.status, 'posted');
    assert.equal(saved.error_message, null);
    assert.equal(saved.error_category, null);
    assert.ok(saved.tracking_link_id);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('APP_BASE_URL', previousBaseUrl);
    globalThis.fetch = previousFetch;
  }
});

test('uploadQueueItem publishes link queue instead of falling back to no-link when stale reply review remains', async () => {
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
      error_category: 'reply_permission_required',
      error_message: 'Threads reply publish failed: {"error":{"message":"Application does not have permission for this action","code":10}}',
      updated_at: new Date(Date.now() + 1000).toISOString()
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

    assert.equal(uploaded.status, 'posted');
    assert.equal(uploaded.post_mode, 'link');
    assert.ok(uploaded.tracking_link_id);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('uploadQueueItem publishes Automation Studio no-link queue without Coupang setup or topic context', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'studio' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'automation studio no-link',
      type: 'ads',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'Automation Studio account',
      platform: 'threads',
      account_handle: 'studio',
      target_audience: '운영자',
      content_scope: '자체 제품 캠페인',
      forbidden_topics: [],
      forbidden_words: [],
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply'
    });
    const campaign = await dbInsert('automation_studio_campaigns', {
      project_id: project.id,
      account_id: account.id,
      name: 'Studio campaign',
      product_name: '쿠자사',
      product_url: 'https://jasain.kr/cujasa',
      target_goal: '클릭 유도',
      platforms: ['threads'],
      daily_post_min: 1,
      daily_post_max: 1,
      days: 1,
      status: 'running'
    });
    const asset = await dbInsert('automation_studio_assets', {
      campaign_id: campaign.id,
      account_id: account.id,
      platform: 'threads',
      asset_type: 'text',
      title: '쿠자사 운영 흐름을 자동화해보세요.',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      status: 'queued',
      metadata: { source: 'automation_studio', reviewStatus: 'queued' }
    });
    const post = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      content_type: 'automation_studio_threads',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      risk_level: 'low',
      status: 'draft',
      metadata: { source: 'automation_studio', campaignId: campaign.id, assetId: asset.id }
    });
    const trackingLink = await dbInsert('tracking_links', {
      project_id: project.id,
      account_id: account.id,
      post_id: post.id,
      destination_url: 'https://jasain.kr/cujasa',
      link_type: 'custom',
      code: 'studio-link'
    });
    const queue = await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      post_id: post.id,
      platform: 'threads',
      scheduled_at: '2026-05-09T00:00:00.000Z',
      status: 'scheduled',
      post_mode: 'no_link',
      retry_count: 0,
      tracking_link_id: trackingLink.id
    });
    await dbInsert('automation_studio_queue_links', {
      campaign_id: campaign.id,
      asset_id: asset.id,
      queue_id: queue.id,
      post_id: post.id,
      platform: 'threads',
      status: 'scheduled'
    });

    const uploaded = await uploadQueueItem(queue.id);
    const [link] = await dbList('automation_studio_queue_links', { queue_id: queue.id });

    assert.equal(uploaded.status, 'posted');
    assert.equal(uploaded.post_mode, 'no_link');
    assert.equal(link.status, 'posted');
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('repairReplyLinkFailures repairs Automation Studio no-link custom tracking replies', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'studio' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'automation studio reply repair',
      type: 'ads',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'Automation Studio repair account',
      platform: 'threads',
      account_handle: 'studio',
      target_audience: '운영자',
      content_scope: '자체 제품 캠페인',
      forbidden_topics: [],
      forbidden_words: [],
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply'
    });
    const campaign = await dbInsert('automation_studio_campaigns', {
      project_id: project.id,
      account_id: account.id,
      name: 'Studio repair campaign',
      product_name: '쿠자사',
      product_url: 'https://jasain.kr/cujasa',
      target_goal: '클릭 유도',
      platforms: ['threads'],
      daily_post_min: 1,
      daily_post_max: 1,
      days: 1,
      status: 'running'
    });
    const asset = await dbInsert('automation_studio_assets', {
      campaign_id: campaign.id,
      account_id: account.id,
      platform: 'threads',
      asset_type: 'text',
      title: '쿠자사 운영 흐름을 자동화해보세요.',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      status: 'queued',
      metadata: { source: 'automation_studio', reviewStatus: 'queued' }
    });
    const post = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      content_type: 'automation_studio_threads',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      risk_level: 'low',
      status: 'posted',
      metadata: { source: 'automation_studio', campaignId: campaign.id, assetId: asset.id }
    });
    const trackingLink = await dbInsert('tracking_links', {
      project_id: project.id,
      account_id: account.id,
      post_id: post.id,
      destination_url: 'https://jasain.kr/cujasa',
      link_type: 'custom',
      code: 'studio-repair'
    });
    const queue = await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      post_id: post.id,
      platform: 'threads',
      scheduled_at: '2026-05-09T00:00:00.000Z',
      posted_at: '2026-05-09T00:01:00.000Z',
      post_url: 'https://www.threads.net/@studio/post/18081644654439950',
      status: 'posted',
      post_mode: 'no_link',
      retry_count: 0,
      error_message: 'Threads reply publish failed: temporary error',
      error_category: 'reply_warning',
      tracking_link_id: trackingLink.id
    });
    await dbInsert('automation_studio_queue_links', {
      campaign_id: campaign.id,
      asset_id: asset.id,
      queue_id: queue.id,
      post_id: post.id,
      platform: 'threads',
      status: 'posted'
    });

    const result = await repairReplyLinkFailures({ accountId: account.id });
    const updated = await dbGet('post_queue', { id: queue.id });

    assert.equal(result.repairedCount, 1);
    assert.equal(updated.status, 'posted');
    assert.equal(updated.error_message, null);
    assert.equal(updated.error_category, null);
    assert.equal(updated.tracking_link_id, trackingLink.id);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('uploadQueueItem allows Automation Studio custom link replies when only old repair-blocked failures remain', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'studio' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'automation studio reply readiness',
      type: 'ads',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'Automation Studio reply readiness account',
      platform: 'threads',
      account_handle: 'studio',
      target_audience: '운영자',
      content_scope: '자체 제품 캠페인',
      forbidden_topics: [],
      forbidden_words: [],
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply'
    });
    const campaign = await dbInsert('automation_studio_campaigns', {
      project_id: project.id,
      account_id: account.id,
      name: 'Studio reply readiness campaign',
      product_name: '쿠자사',
      product_url: 'https://jasain.kr/cujasa',
      target_goal: '클릭 유도',
      platforms: ['threads'],
      daily_post_min: 1,
      daily_post_max: 1,
      days: 1,
      status: 'running'
    });
    const asset = await dbInsert('automation_studio_assets', {
      campaign_id: campaign.id,
      account_id: account.id,
      platform: 'threads',
      asset_type: 'text',
      title: '쿠자사 운영 흐름을 자동화해보세요.',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      status: 'queued',
      metadata: { source: 'automation_studio', reviewStatus: 'queued' }
    });
    const post = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      content_type: 'automation_studio_threads',
      body: '쿠자사 운영 흐름을 자동화해보세요.',
      risk_level: 'low',
      status: 'draft',
      metadata: { source: 'automation_studio', campaignId: campaign.id, assetId: asset.id }
    });
    const blockerPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      content_type: 'automation_studio_threads',
      body: '이전 댓글 실패',
      risk_level: 'low',
      status: 'posted',
      metadata: { source: 'automation_studio', campaignId: campaign.id }
    });
    await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      post_id: blockerPost.id,
      platform: 'threads',
      scheduled_at: '2026-05-08T00:00:00.000Z',
      status: 'manual_required',
      post_mode: 'no_link',
      retry_count: 3,
      error_message: 'REPLY_REPAIR_BLOCKED: 댓글 링크 복구 불가 - linkable_product_missing',
      error_category: 'reply_repair_blocked'
    });
    const trackingLink = await dbInsert('tracking_links', {
      project_id: project.id,
      account_id: account.id,
      post_id: post.id,
      destination_url: 'https://jasain.kr/cujasa',
      link_type: 'custom',
      code: 'studio-readiness'
    });
    const queue = await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: null,
      post_id: post.id,
      platform: 'threads',
      scheduled_at: '2026-05-09T00:00:00.000Z',
      status: 'scheduled',
      post_mode: 'no_link',
      retry_count: 0,
      tracking_link_id: trackingLink.id
    });
    await dbInsert('automation_studio_queue_links', {
      campaign_id: campaign.id,
      asset_id: asset.id,
      queue_id: queue.id,
      post_id: post.id,
      platform: 'threads',
      status: 'scheduled'
    });

    const uploaded = await uploadQueueItem(queue.id);
    const [link] = await dbList('automation_studio_queue_links', { queue_id: queue.id });

    assert.equal(uploaded.status, 'posted');
    assert.equal(uploaded.error_category, null);
    assert.equal(link.status, 'posted');
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    globalThis.fetch = previousFetch;
  }
});

test('recoverStalePostingQueue syncs Automation Studio queue link status', async () => {
  const project = await dbInsert('projects', {
    name: 'automation studio stale posting',
    type: 'ads',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'Automation Studio stale account',
    platform: 'threads',
    account_handle: 'studio',
    target_audience: '운영자',
    content_scope: '자체 제품 캠페인',
    forbidden_topics: [],
    forbidden_words: [],
    status: 'active',
    automation_status: 'running',
    threads_access_token: 'token',
    threads_link_delivery_mode: 'reply'
  });
  const campaign = await dbInsert('automation_studio_campaigns', {
    project_id: project.id,
    account_id: account.id,
    name: 'Studio stale campaign',
    product_name: '쿠자사',
    product_url: 'https://jasain.kr/cujasa',
    target_goal: '클릭 유도',
    platforms: ['threads'],
    daily_post_min: 1,
    daily_post_max: 1,
    days: 1,
    status: 'running'
  });
  const asset = await dbInsert('automation_studio_assets', {
    campaign_id: campaign.id,
    account_id: account.id,
    platform: 'threads',
    asset_type: 'text',
    title: '쿠자사 운영 흐름을 자동화해보세요.',
    body: '쿠자사 운영 흐름을 자동화해보세요.',
    status: 'queued',
    metadata: { source: 'automation_studio', reviewStatus: 'queued' }
  });
  const post = await dbInsert('posts', {
    project_id: project.id,
    account_id: account.id,
    topic_id: null,
    content_type: 'automation_studio_threads',
    body: '쿠자사 운영 흐름을 자동화해보세요.',
    risk_level: 'low',
    status: 'queued',
    metadata: { source: 'automation_studio', campaignId: campaign.id, assetId: asset.id }
  });
  const queue = await dbInsert('post_queue', {
    project_id: project.id,
    account_id: account.id,
    topic_id: null,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: '2026-05-09T00:00:00.000Z',
    status: 'posting',
    post_mode: 'no_link',
    retry_count: 0,
    updated_at: '2026-05-09T00:00:00.000Z'
  });
  await dbInsert('automation_studio_queue_links', {
    campaign_id: campaign.id,
    asset_id: asset.id,
    queue_id: queue.id,
    post_id: post.id,
    platform: 'threads',
    status: 'posting'
  });

  const recovered = await recoverStalePostingQueue();
  const updated = await dbGet('post_queue', { id: queue.id });
  const [link] = await dbList('automation_studio_queue_links', { queue_id: queue.id });

  assert.equal(recovered >= 1, true);
  assert.equal(updated.status, 'retry');
  assert.equal(link.status, 'retry');
});
