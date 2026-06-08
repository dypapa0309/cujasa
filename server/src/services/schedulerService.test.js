import assert from 'node:assert/strict';
import test from 'node:test';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { createDailyQueue, enforceDailyQueueLimits, recoverReplyLinkModeRequiredQueues, recoverStalePostingQueue, repairReplyLinkFailures, uploadQueueItem } from './schedulerService.js';

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
      link_post_ratio: 0.8,
      no_link_post_ratio: 0.2,
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
      if (index < 4) {
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
    assert.equal(queued.filter((row) => row.post_mode === 'link').length, 4);
    assert.equal(queued.filter((row) => row.post_mode === 'no_link').length, 1);
    assert.equal(queued.diagnostics.requiredLinkCount, 4);
    assert.equal(queued.diagnostics.requiredNoLinkCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue only fills remaining slots for today', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'remaining-slots' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'remaining slots project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'remaining slots account',
      platform: 'threads',
      account_handle: 'remaining_slots',
      target_audience: '생활 관심 고객',
      content_scope: '생활 꿀팁',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 3,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const existingTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '이미 예약된 생활 팁',
      angle: '기존 예약'
    });
    const existingPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: existingTopic.id,
      content_type: '정보제공형',
      body: '이미 오늘 예약된 글입니다. 오늘 예약 상한 계산에 포함되어야 합니다.',
      metadata: { contentFormat: 'plain_observation', contentGoal: 'trust', lengthBucket: 'short' },
      risk_level: 'low',
      status: 'queued'
    });
    await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: existingTopic.id,
      post_id: existingPost.id,
      platform: 'threads',
      scheduled_at: new Date().toISOString(),
      status: 'scheduled',
      post_mode: 'no_link',
      retry_count: 0
    });
    for (let index = 0; index < 4; index += 1) {
      const topic = await dbInsert('topics', {
        project_id: project.id,
        account_id: account.id,
        title: `추가 생활 팁 ${index}`,
        angle: '추가 예약'
      });
      await dbInsert('posts', {
        project_id: project.id,
        account_id: account.id,
        topic_id: topic.id,
        content_type: index % 2 === 0 ? '공감형' : '정보제공형',
        body: `오늘 남은 슬롯에만 들어가야 하는 생활 팁 ${index}. 이미 잡힌 예약을 넘기면 안 됩니다.`,
        metadata: index % 2 === 0
          ? { contentFormat: 'mini_poll', contentGoal: 'reply', lengthBucket: 'two_line' }
          : { contentFormat: 'before_buy_check', contentGoal: 'save', lengthBucket: 'short' },
        risk_level: 'low',
        status: 'draft'
      });
    }

    const queued = await createDailyQueue(account.id, { skipPreflight: true });

    assert.equal(queued.length, 2);
    assert.equal(queued.diagnostics.dailyLimit, 3);
    assert.equal(queued.diagnostics.existingTodayQueueCount, 1);
    assert.equal(queued.diagnostics.remainingDailySlots, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('enforceDailyQueueLimits skips excess pending queue and restores drafts', async () => {
  const project = await dbInsert('projects', {
    name: 'daily limit enforcement project',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'daily limit enforcement account',
    platform: 'threads',
    account_handle: 'limit_enforced',
    daily_post_max: 2,
    active_time_windows: [{ start: '09:00', end: '23:00' }],
    status: 'active',
    automation_status: 'running'
  });
  const makeQueuedPost = async (index, status = 'scheduled') => {
    const topic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: `상한 테스트 ${index}`,
      angle: '테스트'
    });
    const post = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: topic.id,
      content_type: '정보제공형',
      body: `상한 테스트용 글 ${index}. 초과 예약 자동 중지 검증입니다.`,
      risk_level: 'low',
      status: status === 'posted' ? 'posted' : 'queued'
    });
    const scheduledAt = new Date(Date.now() + index * 60 * 1000).toISOString();
    return dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: topic.id,
      post_id: post.id,
      platform: 'threads',
      scheduled_at: scheduledAt,
      posted_at: status === 'posted' ? scheduledAt : null,
      status,
      post_mode: 'no_link',
      retry_count: 0
    });
  };

  await makeQueuedPost(0, 'posted');
  await makeQueuedPost(1, 'scheduled');
  const excessScheduled = await makeQueuedPost(2, 'scheduled');
  const excessRetry = await makeQueuedPost(3, 'retry');

  const result = await enforceDailyQueueLimits({ accountId: account.id });
  const queues = await dbList('post_queue', { account_id: account.id });
  const posts = await dbList('posts', { account_id: account.id });

  assert.equal(result.excessCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.equal(queues.find((row) => row.id === excessScheduled.id).status, 'skipped');
  assert.equal(queues.find((row) => row.id === excessRetry.id).status, 'skipped');
  assert.equal(posts.find((row) => row.id === excessScheduled.post_id).status, 'draft');
  assert.equal(posts.find((row) => row.id === excessRetry.post_id).status, 'draft');
});

test('createDailyQueue rejects drafts similar to recently queued account posts', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'recenthistory' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'recent history project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'recent history account',
      platform: 'threads',
      account_handle: 'recenthistory',
      target_audience: '살림 관심 고객',
      content_scope: '주방용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 2,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const oldTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '최근 올린 주방 정리',
      angle: '놓는 자리'
    });
    const oldPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: oldTopic.id,
      content_type: '공감형',
      body: '주방용품은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회돼요. 설거지 후 바로 둘 자리와 물 빠짐을 같이 보면 오래 쓰게 됩니다.',
      risk_level: 'low',
      status: 'posted'
    });
    await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: oldTopic.id,
      post_id: oldPost.id,
      platform: 'threads',
      scheduled_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      status: 'posted',
      post_mode: 'no_link'
    });

    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: oldTopic.id,
      content_type: '공감형',
      body: '주방용품은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회돼요. 설거지 후 바로 둘 자리와 물 빠짐을 같이 보면 오래 쓰게 됩니다.',
      risk_level: 'low',
      status: 'draft'
    });
    const freshTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '환기 잘 되는 음식물통 고르기',
      angle: '냄새 관리'
    });
    const freshPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: freshTopic.id,
      content_type: '체크리스트형',
      body: '음식물통은 뚜껑이 잘 닫히는지보다 비울 때 손이 덜 가는지가 더 중요해요. 작은 주방이면 입구 크기와 봉투 교체 방식부터 보는 편이 편합니다.',
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].post_id, freshPost.id);
    assert.equal(queued.diagnostics.historyRejectedCount, 1);
    assert.equal(queued.diagnostics.queueableDraftPosts, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue uses 30-day history by default to avoid resurfacing older duplicates', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'longhistory' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'long history project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'long history account',
      platform: 'threads',
      account_handle: 'longhistory',
      target_audience: '살림 관심 고객',
      content_scope: '생활용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 1,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const oldTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '오래 전 자취템 기준',
      angle: '놓는 자리'
    });
    const repeatedBody = '자취템은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회돼요. 현관에서 바로 집는 물건 자리와 빨래 바구니 자리를 같이 보면 오래 쓰게 됩니다.';
    const oldPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: oldTopic.id,
      content_type: '공감형',
      body: repeatedBody,
      risk_level: 'low',
      status: 'posted'
    });
    const twelveDaysAgo = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString();
    await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: oldTopic.id,
      post_id: oldPost.id,
      platform: 'threads',
      scheduled_at: twelveDaysAgo,
      posted_at: twelveDaysAgo,
      status: 'posted',
      post_mode: 'no_link'
    });

    const repeatTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '다시 나온 자취템 기준',
      angle: '놓는 자리'
    });
    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: repeatTopic.id,
      content_type: '공감형',
      body: repeatedBody,
      risk_level: 'low',
      status: 'draft'
    });
    const freshTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '장마철 방 습기 기준',
      angle: '환기와 보관'
    });
    const freshPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: freshTopic.id,
      content_type: '체크리스트형',
      body: '방 안 빨래는 향보다 바람 지나갈 길이 먼저예요. 젖은 수건을 따로 둘 자리와 창문 앞 동선이 맞으면 냄새가 덜 남아요.',
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].post_id, freshPost.id);
    assert.equal(queued.diagnostics.historyRejectedCount, 1);
    assert.equal(queued.diagnostics.historyRejected[0].reason, 'body_already_queued_recently');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue skips drafts with repeated CUJASA tail phrases', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'tailfilter' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'tail filter project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'tail filter account',
      platform: 'threads',
      account_handle: 'tailfilter',
      target_audience: '살림 관심 고객',
      content_scope: '생활용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 1,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const repeatedTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '반복 후렴 후보',
      angle: '케이블 정리'
    });
    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: repeatedTopic.id,
      content_type: '공감형',
      body: '여름철 냉방기기 주변 케이블 엉킴, 멀티탭 정리함으로 깔끔하게 정리했어요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.',
      risk_level: 'low',
      status: 'draft'
    });
    const templateTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '구형 템플릿 후보',
      angle: '주방 정리'
    });
    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: templateTopic.id,
      content_type: '공감형',
      body: '주방 정리템 고를 때 처음엔 예쁜 것부터 보이는데, 살아보면 귀찮은 순간이 기준을 바꾸더라고요. 다시 넣을 때 손이 덜 가는 구조처럼 잠깐 둘 곳이 있으면 바닥에 쌓이는 일이 확 줄어요.',
      risk_level: 'low',
      status: 'draft'
    });
    const freshTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '새 수납 기준',
      angle: '저장형'
    });
    const freshPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: freshTopic.id,
      content_type: '체크리스트형',
      body: '수납함은 사기 전에 넣을 물건보다 꺼낼 위치를 먼저 정해두면 실패가 줄어요. 선반 위면 가벼운 재질, 바닥이면 손잡이부터 보는 식입니다.',
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].post_id, freshPost.id);
    assert.equal(queued.diagnostics.qualityRejectedCount, 2);
    assert.equal(queued.diagnostics.qualityRejected[0].reason, 'quality_issue');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue prefers underused content formats when questions are overused', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'formatbalance' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'format balance project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'format balance account',
      platform: 'threads',
      account_handle: 'formatbalance',
      target_audience: '살림 관심 고객',
      content_scope: '생활용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 3,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    for (let index = 0; index < 2; index += 1) {
      const topic = await dbInsert('topics', {
        project_id: project.id,
        account_id: account.id,
        title: `최근 질문형 ${index}`,
        angle: '선택 질문'
      });
      const post = await dbInsert('posts', {
        project_id: project.id,
        account_id: account.id,
        topic_id: topic.id,
        content_type: '질문형',
        body: `최근 질문형 본문 ${index}. 여러분은 정리할 때 어디부터 시작하세요?`,
        risk_level: 'low',
        status: 'posted'
      });
      await dbInsert('post_queue', {
        project_id: project.id,
        account_id: account.id,
        topic_id: topic.id,
        post_id: post.id,
        platform: 'threads',
        scheduled_at: new Date().toISOString(),
        posted_at: new Date().toISOString(),
        status: 'posted',
        post_mode: 'no_link'
      });
    }

    const questionTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '새 질문 후보',
      angle: '선택 질문'
    });
    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: questionTopic.id,
      content_type: '질문형',
      body: '새 수납용품을 고를 때 여러분은 꺼내기 쉬운 쪽을 먼저 보세요, 보기 깔끔한 쪽을 먼저 보세요?',
      risk_level: 'low',
      status: 'draft'
    });
    const infoTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '수납함 고르는 기준',
      angle: '정보 제공'
    });
    const infoPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: infoTopic.id,
      content_type: '체크리스트형',
      body: '수납함은 크기보다 열고 닫는 위치가 먼저예요. 침대 밑이면 낮은 손잡이, 선반 위면 가벼운 재질처럼 꺼내는 동선부터 맞추면 덜 방치돼요.',
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].post_id, infoPost.id);
    assert.equal(queued.diagnostics.recentFormatCounts['질문형'], 2);
    assert.equal(queued.diagnostics.selectedContentTypes[0], '체크리스트형');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('createDailyQueue avoids repeated strategy format goal and opening patterns', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'strategydiversity' })
  });

  try {
    const project = await dbInsert('projects', {
      name: 'strategy diversity project',
      type: 'coupang',
      status: 'active'
    });
    const account = await dbInsert('accounts', {
      project_id: project.id,
      name: 'strategy diversity account',
      platform: 'threads',
      account_handle: 'strategydiversity',
      target_audience: '생활 관심 고객',
      content_scope: '생활용품',
      forbidden_topics: [],
      forbidden_words: [],
      daily_post_max: 2,
      active_time_windows: [{ start: '09:00', end: '23:00' }],
      min_interval_minutes: 90,
      link_post_ratio: 0,
      no_link_post_ratio: 1,
      status: 'active',
      automation_status: 'running',
      threads_access_token: 'token',
      threads_link_delivery_mode: 'reply',
      coupang_access_key: 'access',
      coupang_secret_key: 'secret',
      coupang_partner_id: 'partner',
      coupang_search_status: 'ok'
    });
    const recentTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '최근 짧은 공감',
      angle: '일상 공감'
    });
    const recentPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: recentTopic.id,
      content_type: '공감형',
      body: '은근 정리하려고 꺼낸 물건이 더 어질러질 때가 있어요.',
      metadata: { contentFormat: 'daily_one_liner', contentGoal: 'reach_only', lengthBucket: 'one_line' },
      risk_level: 'low',
      status: 'posted'
    });
    await dbInsert('post_queue', {
      project_id: project.id,
      account_id: account.id,
      topic_id: recentTopic.id,
      post_id: recentPost.id,
      platform: 'threads',
      scheduled_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      status: 'posted',
      post_mode: 'no_link'
    });

    const repeatedTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '반복 짧은 공감',
      angle: '일상 공감'
    });
    await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: repeatedTopic.id,
      content_type: '공감형',
      body: '퇴근하고 보면 바닥에 놓인 충전기부터 눈에 밟히는 날이 많아요.',
      metadata: { contentFormat: 'daily_one_liner', contentGoal: 'reach_only', lengthBucket: 'one_line' },
      risk_level: 'low',
      status: 'draft'
    });
    const freshTopic = await dbInsert('topics', {
      project_id: project.id,
      account_id: account.id,
      title: '구매 전 체크 기준',
      angle: '저장형'
    });
    const freshPost = await dbInsert('posts', {
      project_id: project.id,
      account_id: account.id,
      topic_id: freshTopic.id,
      content_type: '체크리스트형',
      body: '수납함은 사기 전에 넣을 물건보다 꺼낼 위치를 먼저 정해두면 실패가 줄어요. 선반 위면 가벼운 재질, 바닥이면 손잡이부터 보는 식입니다.',
      metadata: { contentFormat: 'before_buy_check', contentGoal: 'save', lengthBucket: 'short' },
      risk_level: 'low',
      status: 'draft'
    });

    const queued = await createDailyQueue(account.id, { skipPreflight: true });
    assert.equal(queued.length, 1);
    assert.equal(queued[0].post_id, freshPost.id);
    assert.equal(queued.diagnostics.recentContentFormatCounts.daily_one_liner, 1);
    assert.equal(queued.diagnostics.selectedContentFormats[0], 'before_buy_check');
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
      title: '재연결 후 욕실 정리',
      angle: '물기 관리'
    });
    const post = await dbInsert('posts', {
      project_id: account.project_id,
      account_id: account.id,
      topic_id: topic.id,
      content_type: '질문형',
      body: '욕실 정리는 물기 남는 자리를 먼저 보면 훨씬 덜 번거로워요. 발매트 주변과 세면대 옆을 먼저 말리는 쪽이에요, 한 번에 몰아서 청소하는 쪽이에요?',
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

test('uploadQueueItem upgrades no-link queue when a linkable Coupang product is attached', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousFetch = globalThis.fetch;
  process.env.MOCK_UPLOAD = 'true';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({ id: 'threads-user', username: 'replytest' })
  });

  try {
    const { queue } = await createRecoverableReplyQueue();
    await dbUpdate('post_queue', { id: queue.id }, {
      status: 'scheduled',
      post_mode: 'no_link',
      retry_count: 0,
      error_message: null,
      error_category: null
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
