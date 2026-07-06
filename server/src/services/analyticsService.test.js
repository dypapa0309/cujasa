import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildAccountPerformanceSignals, dashboardSummary } from './analyticsService.js';
import { dbInsert, dbCount } from './supabaseService.js';
import { generateTopicsPrompt } from '../prompts/generateTopicsPrompt.js';
import { selectProductsPrompt } from '../prompts/selectProductsPrompt.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';

async function createPerformanceFixture() {
  const projectId = randomUUID();
  const accountId = randomUUID();
  const topicId = randomUUID();
  const productId = randomUUID();
  const postId = randomUUID();
  await dbInsert('projects', {
    id: projectId,
    name: '성과 힌트 테스트 프로젝트',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    id: accountId,
    project_id: projectId,
    name: '성과 힌트 계정',
    target_audience: '20대 자취생',
    content_scope: '자취방 정리와 수납 문제',
    forbidden_topics: [],
    forbidden_words: [],
    tone: '친근하고 짧게',
    cta_style: '댓글 유도형',
    status: 'active'
  });
  const topic = await dbInsert('topics', {
    id: topicId,
    account_id: accountId,
    project_id: projectId,
    title: '자취생을 위한 정리하기 쉬운 수납함',
    angle: '좁은 공간 정리',
    target_user: '20대 자취생',
    reason: '클릭 성과가 높은 문제',
    expected_intent: 'high',
    search_keywords: ['수납함', '멀티탭 정리함']
  });
  const product = await dbInsert('coupang_products', {
    id: productId,
    account_id: accountId,
    topic_id: topicId,
    keyword: '수납함',
    product_id: 'coupang-storage-1',
    product_name: '접이식 수납함',
    product_price: 12900,
    product_image: 'https://example.com/storage.jpg',
    product_url: 'https://www.coupang.com/vp/products/1',
    partner_url: 'https://link.coupang.com/a/test',
    category_name: '수납/정리'
  });
  const post = await dbInsert('posts', {
    id: postId,
    account_id: accountId,
    project_id: projectId,
    topic_id: topicId,
    content_type: '질문형',
    body: '자취방 정리는 수납함을 사는 것보다 매일 다시 넣기 쉬운지가 더 갈리더라. 다들 어떤 기준으로 골라요?',
    risk_level: 'low',
    status: 'posted',
    metadata: {
      engagementPattern: 'choice_tension',
      contentFormat: 'mini_poll',
      contentGoal: 'reply',
      lengthBucket: 'short'
    }
  });
  for (let i = 0; i < 3; i += 1) {
    await dbInsert('click_events', {
      tracking_link_id: randomUUID(),
      project_id: projectId,
      account_id: accountId,
      topic_id: topicId,
      post_id: postId,
      product_id: productId
    });
  }
  return { account, topic, product, post };
}

test('buildAccountPerformanceSignals returns top clicked topics products and posts', async () => {
  const { account, topic, product, post } = await createPerformanceFixture();
  const signals = await buildAccountPerformanceSignals(account.id);

  assert.equal(signals.totalClicks, 3);
  assert.equal(signals.topTopics[0].topicId, topic.id);
  assert.equal(signals.topTopics[0].clicks, 3);
  assert.equal(signals.topProducts[0].productId, product.id);
  assert.equal(signals.topProducts[0].productName, '접이식 수납함');
  assert.equal(signals.topPosts[0].postId, post.id);
  assert.equal(signals.topPosts[0].contentFormat, 'mini_poll');
  assert.equal(signals.topContentFormats[0].name, 'mini_poll');
  assert.equal(signals.topContentGoals[0].name, 'reply');
  assert.equal(signals.topLengthBuckets[0].name, 'short');
  assert.match(signals.guidance[0], /같은 제목 반복은 피하세요/);
});

test('generation prompts include performance signals without removing guardrails', async () => {
  const { account, topic, product } = await createPerformanceFixture();
  const signals = await buildAccountPerformanceSignals(account.id);

  const topicPrompt = generateTopicsPrompt(account, [], signals);
  const productPrompt = selectProductsPrompt(topic, [product], account, signals);
  const postPrompt = generatePostsPrompt(topic, [product], { ...account, performanceSignals: signals });
  const topicPayload = JSON.parse(topicPrompt[1].content);
  const productPayload = JSON.parse(productPrompt[1].content);
  const postPayload = JSON.parse(postPrompt[1].content);

  assert.equal(topicPayload.performanceSignals.topTopics[0].topicId, topic.id);
  assert.ok(topicPayload.guardrails.some((rule) => rule.includes('performanceSignals')));
  assert.equal(productPayload.performanceSignals.topProducts[0].productId, product.id);
  assert.ok(productPayload.criteria.some((rule) => rule.includes('historically high-click products')));
  assert.equal(postPayload.performanceSignals.topPosts[0].topicTitle, topic.title);
  assert.equal(postPayload.performanceSignals.topContentFormats[0].name, 'mini_poll');
  assert.ok(postPayload.rules.some((rule) => rule.includes('performanceSignals.topPosts')));
  assert.ok(postPayload.rules.some((rule) => rule.includes('performanceSignals.topContentFormats')));
  assert.ok(postPayload.rules.some((rule) => rule.includes('Never write phrases like')));
});

test('content format breakdown counts clicked posts beyond the top 5', async () => {
  const projectId = randomUUID();
  const accountId = randomUUID();
  const topicId = randomUUID();
  await dbInsert('projects', { id: projectId, name: '포맷 집계 테스트', type: 'coupang', status: 'active' });
  await dbInsert('accounts', {
    id: accountId,
    project_id: projectId,
    name: '포맷 집계 계정',
    forbidden_topics: [],
    forbidden_words: [],
    status: 'active'
  });
  await dbInsert('topics', { id: topicId, account_id: accountId, project_id: projectId, title: '정리 수납' });

  const addPostWithClicks = async (contentFormat, contentGoal, clicks) => {
    const postId = randomUUID();
    await dbInsert('posts', {
      id: postId,
      account_id: accountId,
      project_id: projectId,
      topic_id: topicId,
      content_type: '질문형',
      body: `${contentFormat} 본문`,
      risk_level: 'low',
      status: 'posted',
      metadata: { contentFormat, contentGoal, lengthBucket: 'short' }
    });
    for (let i = 0; i < clicks; i += 1) {
      await dbInsert('click_events', {
        tracking_link_id: randomUUID(),
        project_id: projectId,
        account_id: accountId,
        topic_id: topicId,
        post_id: postId
      });
    }
  };

  // Five heavily-clicked posts occupy every top-5 topPosts slot...
  for (let i = 0; i < 5; i += 1) await addPostWithClicks('mini_poll', 'reply', 10);
  // ...and a sixth, lower-clicked post uses a distinct format that must still be counted.
  await addPostWithClicks('send_to_friend', 'share', 3);

  const signals = await buildAccountPerformanceSignals(accountId);
  const formatMap = new Map(signals.topContentFormats.map((f) => [f.name, f.clicks]));
  assert.equal(formatMap.get('mini_poll'), 50);
  assert.equal(formatMap.get('send_to_friend'), 3, 'format from a post outside the top 5 must still be aggregated');
});

test('dbCount counts rows matching eq and range filters without loading rows', async () => {
  const accountId = randomUUID();
  const base = Date.parse('2026-03-01T00:00:00.000Z');
  for (let i = 0; i < 5; i += 1) {
    await dbInsert('click_events', {
      account_id: accountId,
      created_at: new Date(base + i * 86400000).toISOString()
    });
  }

  assert.equal(await dbCount('click_events', { account_id: accountId }), 5);
  assert.equal(await dbCount('click_events', { account_id: randomUUID() }), 0);

  const rangeCount = await dbCount('click_events', { account_id: accountId }, {
    gte: { created_at: '2026-03-01T00:00:00.000Z' },
    lte: { created_at: '2026-03-03T00:00:00.000Z' }
  });
  assert.equal(rangeCount, 3);
});

test('dashboardSummary reports counts via count queries (delta-checked)', async () => {
  const before = await dashboardSummary();
  const accountId = randomUUID();
  await dbInsert('accounts', {
    id: accountId,
    name: 'dash-count 계정',
    platform: 'threads',
    status: 'active'
  });
  await dbInsert('post_queue', [
    { account_id: accountId, status: 'posted' },
    { account_id: accountId, status: 'posted' },
    { account_id: accountId, status: 'scheduled', scheduled_at: new Date().toISOString() },
    { account_id: accountId, status: 'scheduled', scheduled_at: new Date(Date.now() + 3 * 86_400_000).toISOString() }
  ]);
  for (let i = 0; i < 3; i += 1) {
    await dbInsert('click_events', { account_id: accountId });
  }

  const after = await dashboardSummary();
  assert.equal(after.accounts - before.accounts, 1);
  assert.equal(after.posted - before.posted, 2);
  assert.equal(after.scheduledToday - before.scheduledToday, 1, 'only the scheduled row inside today\u2019s window counts');
  assert.equal(after.clicks - before.clicks, 3);
});
