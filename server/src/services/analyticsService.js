import { dbList } from './supabaseService.js';

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row[key] || 'unknown';
    acc[value] = (acc[value] || 0) + Number(row.clicks || 0);
    return acc;
  }, {});
}

export async function getAccountAnalytics(accountId) {
  const metrics = await dbList('post_metrics', { account_id: accountId });
  const clicks = await dbList('click_events', { account_id: accountId });
  const topics = await dbList('topics', { account_id: accountId });
  const totalClicks = clicks.length || metrics.reduce((sum, m) => sum + Number(m.clicks || 0), 0);
  const byTopic = clicks.reduce((acc, click) => {
    acc[click.topic_id] = (acc[click.topic_id] || 0) + 1;
    return acc;
  }, {});
  const bestTopics = Object.entries(byTopic)
    .sort((a, b) => b[1] - a[1])
    .map(([topicId, count]) => ({ topic: topics.find((t) => t.id === topicId)?.title || topicId, clicks: count }))
    .slice(0, 5);
  return {
    totalClicks,
    accountClicks: totalClicks,
    topicClicks: bestTopics,
    productClicks: groupCount(metrics, 'product_id'),
    ctaClicks: groupCount(metrics, 'cta_variant_id'),
    recommendations: bestTopics.length
      ? bestTopics.map((item) => `${item.topic}와 비슷한 문제/상품군을 확장하세요.`)
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
