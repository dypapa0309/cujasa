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
import { assertAccountCanUpload, recordSuccessfulUpload } from './trialEntitlementService.js';
import { assertAutomationRunning, isAutomationRunning } from './accountAutomationService.js';

async function hasProductsForTopic(topicId) {
  if (!topicId) return false;
  const rows = await dbList('post_products', { topic_id: topicId }, { limit: 1 });
  return rows.length > 0;
}

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

export async function addPostToQueue(postId, scheduledAt = null, options = {}) {
  const post = await dbGet('posts', { id: postId });
  if (!post) throw new Error('Post not found');
  await assertAccountOwnerCanOperate(post.account_id);
  await assertAccountCanUpload(post.account_id);
  const account = await dbGet('accounts', { id: post.account_id });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot add post to queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'add post to queue');
  if (!(await isPostAllowedForQueue(post, account))) {
    const error = new Error('Post blocked by content guardrails');
    error.status = 422;
    throw error;
  }
  const status = post.status === 'manual_required' || post.risk_level === 'high' ? 'manual_required' : 'scheduled';
  const postMode = ['link', 'no_link'].includes(options.postMode)
    ? options.postMode
    : ((await hasProductsForTopic(post.topic_id)) ? 'link' : 'no_link');
  const payload = {
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: scheduledAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status,
    post_mode: postMode,
    retry_count: 0
  };
  try {
    return await dbInsert('post_queue', payload);
  } catch (error) {
    if (!/post_mode|schema cache|column/i.test(error.message || '')) throw error;
    const { post_mode, ...fallbackPayload } = payload;
    return dbInsert('post_queue', fallbackPayload);
  }
}

export async function createDailyQueue(accountId) {
  await assertAccountOwnerCanOperate(accountId);
  await assertAccountCanUpload(accountId);
  const account = await dbGet('accounts', { id: accountId });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot create daily queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'create daily queue');
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
  const times = createDailySchedule(account);
  const total = times.length;
  const linkCount = Math.round(total * linkRatio);
  const noLinkCount = total - linkCount;
  const primaryWithLink = withLink.slice(0, linkCount);
  const usedLinkPostIds = new Set(primaryWithLink.map((post) => post.id));
  const primaryWithoutLink = allDrafts.filter((post) => !usedLinkPostIds.has(post.id)).slice(0, noLinkCount);
  const drafts = [
    ...primaryWithLink.map((post) => ({ post, postMode: 'link' })),
    ...primaryWithoutLink.map((post) => ({ post, postMode: 'no_link' }))
  ];
  if (primaryWithLink.length < linkCount) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'queue_link_slots_shortage',
      level: 'warn',
      message: `링크 글 후보 부족: 목표 ${linkCount}개, 가능 ${primaryWithLink.length}개`,
      payload: { linkRatio, total, linkCount, availableLinkPosts: withLink.length }
    });
  }
  const queued = [];
  for (const [index, item] of drafts.slice(0, times.length).entries()) {
    queued.push(await addPostToQueue(item.post.id, times[index], { postMode: item.postMode }));
    await dbUpdate('posts', { id: item.post.id }, { status: 'queued' });
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
  const activeAccountIds = new Set(activeAccounts.filter(isAutomationRunning).map((account) => account.id));
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
  if (!isAutomationRunning(account)) {
    const error = new Error('자동화가 중지되어 업로드를 보류했습니다.');
    error.status = 409;
    error.code = 'AUTOMATION_PAUSED';
    throw error;
  }
  try {
    await assertAccountOwnerCanOperate(queue.account_id);
    await assertAccountCanUpload(queue.account_id);
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
    const postProduct = (await dbList('post_products', { topic_id: post.topic_id }, { order: 'rank', ascending: true }))[0];
    const product = postProduct ? await dbGet('coupang_products', { id: postProduct.product_id }) : null;
    // retry 시 기존 tracking_link 재사용 — 중복 생성 방지
    const existingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const postMode = queue.post_mode || 'auto';
    const requiresLink = postMode === 'link';
    const ctas = requiresLink ? await listCtas(post.id) : [];
    const cta = requiresLink ? (ctas[Math.floor(Math.random() * Math.max(1, ctas.length))] || null) : null;
    if (requiresLink && !product) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글로 예약됐지만 연결된 쿠팡 상품이 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const trackingLink = requiresLink ? (existingLink || (product ? await createTrackingLink({
      project_id: post.project_id,
      account_id: post.account_id,
      topic_id: post.topic_id,
      post_id: post.id,
      product_id: product.id,
      destination_url: product.partner_url || product.product_url,
      link_type: product.is_fallback ? 'fallback' : 'coupang'
    }) : null)) : null;
    if (requiresLink && !trackingLink) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글의 트래킹 링크를 만들 수 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const uploaded = await uploadThreads({ account, post, cta, trackingLink });
    let postedRows;
    try {
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl,
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id,
        error_message: null,
        error_category: null
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl,
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id,
        error_message: null
      });
    }
    const [updated] = postedRows;
    await dbUpdate('posts', { id: post.id }, { status: 'posted' });
    await recordSuccessfulUpload(account.id);
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
