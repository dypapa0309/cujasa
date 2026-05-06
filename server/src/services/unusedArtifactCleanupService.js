import { dbDelete, dbList, safeLogActivity } from './supabaseService.js';

const DEFAULT_RETENTION_DAYS = Math.max(1, Number(process.env.UNUSED_ARTIFACT_RETENTION_DAYS || 7));
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function cutoffFor(retentionDays = DEFAULT_RETENTION_DAYS) {
  return new Date(Date.now() - Math.max(1, Number(retentionDays) || DEFAULT_RETENTION_DAYS) * ONE_DAY_MS);
}

function rowTime(row = {}) {
  return new Date(row.created_at || 0).getTime() || 0;
}

function olderThan(row, cutoff) {
  return rowTime(row) > 0 && rowTime(row) < cutoff.getTime();
}

function byTopic(rows = []) {
  return rows.reduce((acc, row) => {
    if (!row.topic_id) return acc;
    acc.set(row.topic_id, [...(acc.get(row.topic_id) || []), row]);
    return acc;
  }, new Map());
}

export async function cleanupUnusedPipelineArtifacts({
  mode = 'dry-run',
  retentionDays = DEFAULT_RETENTION_DAYS,
  accountId = null
} = {}) {
  const apply = mode === 'apply';
  const cutoff = cutoffFor(retentionDays);
  const [topics, posts, products, postProducts, queue] = await Promise.all([
    dbList('topics', accountId ? { account_id: accountId } : {}),
    dbList('posts', accountId ? { account_id: accountId } : {}),
    dbList('coupang_products', accountId ? { account_id: accountId } : {}),
    dbList('post_products'),
    dbList('post_queue', accountId ? { account_id: accountId } : {})
  ]);

  const postsByTopic = byTopic(posts);
  const productsByTopic = byTopic(products);
  const selectionsByTopic = byTopic(postProducts);
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const protectedTopicIds = new Set();

  queue.forEach((row) => {
    if (row.topic_id) protectedTopicIds.add(row.topic_id);
    const postTopicId = postsById.get(row.post_id)?.topic_id;
    if (postTopicId) protectedTopicIds.add(postTopicId);
  });

  const targets = topics.filter((topic) => olderThan(topic, cutoff) && !protectedTopicIds.has(topic.id));
  const targetTopicIds = new Set(targets.map((topic) => topic.id));
  const targetPosts = posts.filter((post) => targetTopicIds.has(post.topic_id));
  const targetProducts = products.filter((product) => targetTopicIds.has(product.topic_id));
  const targetSelections = postProducts.filter((selection) => targetTopicIds.has(selection.topic_id));

  if (apply) {
    for (const topic of targets) {
      for (const selection of selectionsByTopic.get(topic.id) || []) {
        await dbDelete('post_products', { id: selection.id });
      }
      for (const product of productsByTopic.get(topic.id) || []) {
        await dbDelete('coupang_products', { id: product.id });
      }
      for (const post of postsByTopic.get(topic.id) || []) {
        await dbDelete('posts', { id: post.id });
      }
      await dbDelete('topics', { id: topic.id });
    }
    await safeLogActivity({
      account_id: accountId || null,
      action: 'unused_pipeline_artifacts_cleanup',
      level: 'info',
      message: `${targets.length}개의 미사용 주제를 정리했습니다.`,
      payload: {
        retentionDays,
        cutoff: cutoff.toISOString(),
        topicCount: targets.length,
        postCount: targetPosts.length,
        productCount: targetProducts.length,
        selectionCount: targetSelections.length
      }
    });
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    retentionDays,
    cutoff: cutoff.toISOString(),
    topicCount: targets.length,
    postCount: targetPosts.length,
    productCount: targetProducts.length,
    selectionCount: targetSelections.length,
    topicIds: targets.map((topic) => topic.id)
  };
}
