import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { createDailySchedule } from '../utils/randomSchedule.js';
import { uploadPost as uploadThreads } from '../platformAdapters/threadsAdapter.js';
import { createMetricJobs } from './metricsJobService.js';
import { listCtas } from './ctaService.js';
import { createTrackingLink } from './trackingService.js';

export async function addPostToQueue(postId, scheduledAt = null) {
  const post = await dbGet('posts', { id: postId });
  if (!post) throw new Error('Post not found');
  const account = await dbGet('accounts', { id: post.account_id });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot add post to queue`);
    error.status = 409;
    throw error;
  }
  const status = post.status === 'manual_required' || post.risk_level === 'high' ? 'manual_required' : 'scheduled';
  return dbInsert('post_queue', {
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: scheduledAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status,
    retry_count: 0
  });
}

export async function createDailyQueue(accountId) {
  const account = await dbGet('accounts', { id: accountId });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot create daily queue`);
    error.status = 409;
    throw error;
  }
  const allDrafts = (await dbList('posts', { account_id: accountId })).filter((p) => ['draft', 'ready'].includes(p.status));
  const topicIds = [...new Set(allDrafts.map((p) => p.topic_id))];
  const productsPerTopic = new Set();
  for (const tid of topicIds) {
    const pp = await dbList('post_products', { topic_id: tid });
    if (pp.length > 0) productsPerTopic.add(tid);
  }

  // link_post_ratio 적용: 링크 있는 것과 없는 것을 비율에 맞게 섞기
  const linkRatio = account.link_post_ratio ?? 0.3;
  const withLink = allDrafts.filter((p) => productsPerTopic.has(p.topic_id));
  const withoutLink = allDrafts.filter((p) => !productsPerTopic.has(p.topic_id));
  const times = createDailySchedule(account);
  const total = times.length;
  const linkCount = Math.round(total * linkRatio);
  const noLinkCount = total - linkCount;
  const drafts = [
    ...withLink.slice(0, linkCount),
    ...withoutLink.slice(0, noLinkCount)
  ].slice(0, total);
  const queued = [];
  for (const [index, post] of drafts.slice(0, times.length).entries()) {
    queued.push(await addPostToQueue(post.id, times[index]));
    await dbUpdate('posts', { id: post.id }, { status: 'queued' });
  }
  return queued;
}

export async function processDueQueue() {
  const rows = await dbList('post_queue', { status: 'scheduled' });
  const activeAccounts = await dbList('accounts', { status: 'active' });
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
  const due = rows.filter((row) => activeAccountIds.has(row.account_id) && new Date(row.scheduled_at) <= new Date());
  for (const row of due) await uploadQueueItem(row.id);
  return due.length;
}

export async function uploadQueueItem(queueId) {
  const queue = await dbGet('post_queue', { id: queueId });
  const account = await dbGet('accounts', { id: queue.account_id });
  const post = await dbGet('posts', { id: queue.post_id });
  try {
    if (account?.status !== 'active') {
      await logActivity({ account_id: queue.account_id, project_id: queue.project_id, post_id: queue.post_id, action: 'upload_skipped_inactive_account', level: 'warn', message: account?.status || 'missing' });
      return (await dbUpdate('post_queue', { id: queueId }, { status: 'skipped', error_message: `Account is ${account?.status || 'missing'}` }))[0];
    }
    await dbUpdate('post_queue', { id: queueId }, { status: 'posting' });
    const ctas = await listCtas(post.id);
    const cta = ctas[Math.floor(Math.random() * Math.max(1, ctas.length))] || null;
    const postProduct = (await dbList('post_products', { topic_id: post.topic_id }, { order: 'rank', ascending: true }))[0];
    const product = postProduct ? await dbGet('coupang_products', { id: postProduct.product_id }) : null;
    const trackingLink = product ? await createTrackingLink({
      project_id: post.project_id,
      account_id: post.account_id,
      topic_id: post.topic_id,
      post_id: post.id,
      product_id: product.id,
      destination_url: product.partner_url || product.product_url,
      link_type: product.is_fallback ? 'fallback' : 'coupang'
    }) : null;
    const uploaded = await uploadThreads({ account, post, cta, trackingLink });
    const [updated] = await dbUpdate('post_queue', { id: queueId }, {
      status: 'posted',
      posted_at: new Date().toISOString(),
      post_url: uploaded.postUrl,
      selected_cta_id: cta?.id,
      tracking_link_id: trackingLink?.id
    });
    await dbUpdate('posts', { id: post.id }, { status: 'posted' });
    await createMetricJobs(updated);
    await logActivity({ account_id: account.id, project_id: account.project_id, post_id: post.id, action: 'upload_completed', message: uploaded.postUrl });
    return updated;
  } catch (error) {
    const retry = (queue.retry_count || 0) + 1;
    const status = retry >= 3 ? 'manual_required' : 'retry';
    const [updated] = await dbUpdate('post_queue', { id: queueId }, { status, retry_count: retry, error_message: error.message });
    await logActivity({ account_id: queue.account_id, project_id: queue.project_id, action: 'upload_failed', level: 'error', message: error.message });
    return updated;
  }
}
