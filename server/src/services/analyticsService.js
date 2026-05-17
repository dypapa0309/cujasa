import { dbList } from './supabaseService.js';

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || 'unknown';
    acc[value] = (acc[value] || 0) + Number(row.clicks || 0);
    return acc;
  }, {});
}

function addCount(map, key, clicks = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + Number(clicks || 0));
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function textSnippet(value = '', max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export async function buildAccountPerformanceSignals(accountId, { limit = 5 } = {}) {
  const [clicks, metrics, topics, posts, products] = await Promise.all([
    dbList('click_events', { account_id: accountId }),
    dbList('post_metrics', { account_id: accountId }),
    dbList('topics', { account_id: accountId }),
    dbList('posts', { account_id: accountId }),
    dbList('coupang_products', { account_id: accountId }).catch(() => [])
  ]);
  const sourceRows = clicks.length
    ? clicks.map((row) => ({ ...row, clicks: 1 }))
    : metrics.map((row) => ({ ...row, clicks: Number(row.clicks || 0) }));
  const topicClicks = new Map();
  const productClicks = new Map();
  const postClicks = new Map();
  const formatClicks = new Map();
  const goalClicks = new Map();
  const lengthBucketClicks = new Map();
  for (const row of sourceRows) {
    const count = Number(row.clicks || 0);
    if (count <= 0) continue;
    addCount(topicClicks, row.topic_id, count);
    addCount(productClicks, row.product_id, count);
    addCount(postClicks, row.post_id, count);
  }
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const postById = new Map(posts.map((post) => [post.id, post]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const topTopics = topEntries(topicClicks, limit).map(([topicId, count]) => {
    const topic = topicById.get(topicId) || {};
    return {
      topicId,
      title: topic.title || topicId,
      angle: topic.angle || '',
      searchKeywords: Array.isArray(topic.search_keywords) ? topic.search_keywords.slice(0, 5) : [],
      clicks: count
    };
  });
  const topProducts = topEntries(productClicks, limit).map(([productId, count]) => {
    const product = productById.get(productId) || {};
    return {
      productId,
      productName: product.product_name || productId,
      keyword: product.keyword || '',
      category: product.category_name || '',
      productGroup: product.product_group || product.category_name || product.keyword || '',
      clicks: count
    };
  });
  const topPosts = topEntries(postClicks, limit).map(([postId, count]) => {
    const post = postById.get(postId) || {};
    const topic = topicById.get(post.topic_id) || {};
    addCount(formatClicks, post.metadata?.contentFormat, count);
    addCount(goalClicks, post.metadata?.contentGoal, count);
    addCount(lengthBucketClicks, post.metadata?.lengthBucket, count);
    return {
      postId,
      topicTitle: topic.title || '',
      contentType: post.content_type || '',
      contentFormat: post.metadata?.contentFormat || '',
      contentGoal: post.metadata?.contentGoal || '',
      lengthBucket: post.metadata?.lengthBucket || '',
      bodySnippet: textSnippet(post.body),
      engagementPattern: post.metadata?.engagementPattern || '',
      clicks: count
    };
  });
  const topProductGroups = topProducts.reduce((acc, product) => {
    const key = product.productGroup || product.keyword || product.category || 'unknown';
    acc[key] = (acc[key] || 0) + product.clicks;
    return acc;
  }, {});
  return {
    totalClicks: sourceRows.reduce((sum, row) => sum + Number(row.clicks || 0), 0),
    topTopics,
    topProducts,
    topProductGroups: Object.entries(topProductGroups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, count]) => ({ name, clicks: count })),
    topPosts,
    topContentFormats: topEntries(formatClicks, limit).map(([name, clicks]) => ({ name, clicks })),
    topContentGoals: topEntries(goalClicks, limit).map(([name, clicks]) => ({ name, clicks })),
    topLengthBuckets: topEntries(lengthBucketClicks, limit).map(([name, clicks]) => ({ name, clicks })),
    guidance: topTopics.length
      ? topTopics.map((item) => `${item.title}와 비슷한 문제/상품군을 확장하되 같은 제목 반복은 피하세요.`)
      : []
  };
}

export async function getAccountAnalytics(accountId) {
  const metrics = await dbList('post_metrics', { account_id: accountId });
  const clicks = await dbList('click_events', { account_id: accountId });
  const topics = await dbList('topics', { account_id: accountId });
  const learningSignals = await buildAccountPerformanceSignals(accountId);
  const totalClicks = clicks.length || metrics.reduce((sum, m) => sum + Number(m.clicks || 0), 0);
  const byTopic = clicks.reduce((acc, click) => {
    acc[click.topic_id] = (acc[click.topic_id] || 0) + 1;
    return acc;
  }, {});
  const bestTopics = Object.entries(byTopic)
    .sort((a, b) => b[1] - a[1])
    .map(([topicId, count]) => ({ topic: topics.find((t) => t.id === topicId)?.title || topicId, clicks: count }))
    .slice(0, 5);
  const topicClicks = bestTopics.length
    ? bestTopics
    : learningSignals.topTopics.map((item) => ({ topic: item.title, clicks: item.clicks }));
  return {
    totalClicks,
    accountClicks: totalClicks,
    topicClicks,
    productClicks: groupCount(metrics, 'product_id'),
    ctaClicks: groupCount(metrics, 'cta_variant_id'),
    learningSignals,
    recommendations: learningSignals.guidance.length
      ? learningSignals.guidance
      : ['클릭 데이터가 쌓이면 주제 확장 추천이 표시됩니다.']
  };
}

export async function dashboardSummary() {
  const accounts = await dbList('accounts');
  const queue = await dbList('post_queue');
  const clicks = await dbList('click_events');
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);
  return {
    accounts: accounts.length,
    scheduledToday: queue.filter((q) => q.status === 'scheduled' && new Date(q.scheduled_at) >= todayStart && new Date(q.scheduled_at) <= todayEnd).length,
    posted: queue.filter((q) => q.status === 'posted').length,
    clicks: clicks.length,
    bestTopics: []
  };
}
