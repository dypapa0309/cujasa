import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { createDailySchedule } from '../utils/randomSchedule.js';
import { uploadPost as uploadThreads } from '../platformAdapters/threadsAdapter.js';
import { createMetricJobs } from './metricsJobService.js';
import { listCtas } from './ctaService.js';
import { createTrackingLink } from './trackingService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { classifyQueueError } from './queueErrorService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';

async function isPostAllowedForQueue(post, account) {
  const topic = post.topic_id ? await dbGet('topics', { id: post.topic_id }) : null;
  const guardrail = validatePostCandidate(post.body, account, topic);
  if (guardrail.allowed) return true;
  await logActivity({
    account_id: post.account_id,
    project_id: post.project_id,
    topic_id: post.topic_id,
    post_id: post.id,
    action: 'queue_guardrail_skipped',
    level: 'warn',
    message: guardrail.reasons.join('; '),
    payload: { context: guardrail.context }
  });
  await dbUpdate('posts', { id: post.id }, { status: 'skipped' });
  return false;
}

export async function addPostToQueue(postId, scheduledAt = null) {
  const post = await dbGet('posts', { id: postId });
  if (!post) throw new Error('Post not found');
  await assertAccountOwnerCanOperate(post.account_id);
  const account = await dbGet('accounts', { id: post.account_id });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot add post to queue`);
    error.status = 409;
    throw error;
  }
  if (!(await isPostAllowedForQueue(post, account))) {
    const error = new Error('Post blocked by content guardrails');
    error.status = 422;
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
  await assertAccountOwnerCanOperate(accountId);
  const account = await dbGet('accounts', { id: accountId });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot create daily queue`);
    error.status = 409;
    throw error;
  }
  assertPreflightCanPublish(await preflightAccount(accountId, { includeQueue: false }));
  const allDrafts = [];
  for (const post of (await dbList('posts', { account_id: accountId })).filter((p) => ['draft', 'ready'].includes(p.status))) {
    if (await isPostAllowedForQueue(post, account)) allDrafts.push(post);
  }
  const topicIds = [...new Set(allDrafts.map((p) => p.topic_id))];
  const productsPerTopic = new Set();
  for (const tid of topicIds) {
    const pp = await dbList('post_products', { topic_id: tid });
    if (pp.length > 0) productsPerTopic.add(tid);
  }

  // link_post_ratio 적용: 링크 있는 것과 없는 것을 비율에 맞게 섞기
  const linkRatio = Math.min(1, Math.max(0, Number(account.link_post_ratio ?? 0.3)));
  const withLink = allDrafts.filter((p) => productsPerTopic.has(p.topic_id));
  const withoutLink = allDrafts.filter((p) => !productsPerTopic.has(p.topic_id));
  const times = createDailySchedule(account);
  const total = times.length;
  const linkCount = Math.round(total * linkRatio);
  const noLinkCount = total - linkCount;
  const primaryWithLink = withLink.slice(0, linkCount);
  const primaryWithoutLink = withoutLink.slice(0, noLinkCount);
  const usedPostIds = new Set([...primaryWithLink, ...primaryWithoutLink].map((post) => post.id));
  const fill = [...withLink, ...withoutLink].filter((post) => !usedPostIds.has(post.id));
  const drafts = [
    ...primaryWithLink,
    ...primaryWithoutLink,
    ...fill
  ].slice(0, total);
  const queued = [];
  for (const [index, post] of drafts.slice(0, times.length).entries()) {
    queued.push(await addPostToQueue(post.id, times[index]));
    await dbUpdate('posts', { id: post.id }, { status: 'queued' });
  }
  return queued;
}

export async function processDueQueue() {
  const [scheduled, retrying] = await Promise.all([
    dbList('post_queue', { status: 'scheduled' }),
    dbList('post_queue', { status: 'retry' })
  ]);
  const rows = [...scheduled, ...retrying];
  const activeAccounts = await dbList('accounts', { status: 'active' });
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
  const due = rows.filter((row) => activeAccountIds.has(row.account_id) && new Date(row.scheduled_at) <= new Date());
  for (const row of due) await uploadQueueItem(row.id);
  return due.length;
}

export async function uploadQueueItem(queueId) {
  const queue = await dbGet('post_queue', { id: queueId });
  if (!queue) {
    const error = new Error('Queue item not found');
    error.status = 404;
    throw error;
  }
  const account = await dbGet('accounts', { id: queue.account_id });
  const post = await dbGet('posts', { id: queue.post_id });
  try {
    await assertAccountOwnerCanOperate(queue.account_id);
    if (!post) {
      const error = new Error('Post not found for queue item');
      error.permanent = true;
      throw error;
    }
    if (account?.status !== 'active') {
      await logActivity({ account_id: queue.account_id, project_id: queue.project_id, post_id: queue.post_id, action: 'upload_skipped_inactive_account', level: 'warn', message: account?.status || 'missing' });
      return (await dbUpdate('post_queue', { id: queueId }, { status: 'skipped', error_message: `Account is ${account?.status || 'missing'}` }))[0];
    }
    assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false }));
    await dbUpdate('post_queue', { id: queueId }, { status: 'posting' });
    const ctas = await listCtas(post.id);
    const cta = ctas[Math.floor(Math.random() * Math.max(1, ctas.length))] || null;
    const postProduct = (await dbList('post_products', { topic_id: post.topic_id }, { order: 'rank', ascending: true }))[0];
    const product = postProduct ? await dbGet('coupang_products', { id: postProduct.product_id }) : null;
    // retry 시 기존 tracking_link 재사용 — 중복 생성 방지
    const existingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const trackingLink = existingLink || (product ? await createTrackingLink({
      project_id: post.project_id,
      account_id: post.account_id,
      topic_id: post.topic_id,
      post_id: post.id,
      product_id: product.id,
      destination_url: product.partner_url || product.product_url,
      link_type: product.is_fallback ? 'fallback' : 'coupang'
    }) : null);
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
    if (uploaded.raw?.replyWarning) {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'upload_reply_failed',
        level: 'warn',
        message: uploaded.raw.replyWarning,
        payload: { postUrl: uploaded.postUrl }
      });
    }
    return updated;
  } catch (error) {
    const retry = (queue.retry_count || 0) + 1;
    const status = error.permanent || retry >= 3 ? 'manual_required' : 'retry';
    const classified = classifyQueueError(error.message);
    if (error.code === 'THREADS_TOKEN_INVALID' || error.code === 'THREADS_TOKEN_MISSING') {
      await dbUpdate('accounts', { id: queue.account_id }, { threads_token_status: 'refresh_failed' });
    }
    let updatedRows;
    try {
      updatedRows = await dbUpdate('post_queue', { id: queueId }, {
        status,
        retry_count: retry,
        error_message: error.message,
        error_category: classified.category
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      updatedRows = await dbUpdate('post_queue', { id: queueId }, { status, retry_count: retry, error_message: error.message });
    }
    const [updated] = updatedRows;
    await logActivity({ account_id: queue.account_id, project_id: queue.project_id, action: 'upload_failed', level: 'error', message: error.message });
    return updated;
  }
}
