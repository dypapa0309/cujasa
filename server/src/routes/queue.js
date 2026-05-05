import { Router } from 'express';
import { dbGet, dbList, dbUpdate } from '../services/supabaseService.js';
import { addPostToQueue, createDailyQueue, processDueQueue, uploadQueueItem } from '../services/schedulerService.js';
import { requireAccountAccessParam, requireQueueAccess } from '../middleware/accountAccess.js';
import { assertUserCanOperate } from '../services/billingEntitlementService.js';
import { decorateQueueRow, decorateQueueRows, postModeLabel } from '../services/queueErrorService.js';
import { assertUserCanStartTrialAction } from '../services/trialEntitlementService.js';
import { decorateProductQuality, isRealCoupangProduct } from '../utils/productQuality.js';
import { dismissQueueForCustomer, isCustomerVisibleQueue } from '../services/queueVisibilityService.js';
import { requireAdmin } from '../middleware/rateLimit.js';

const router = Router();
const PATCHABLE_QUEUE_FIELDS = new Set([
  'scheduled_at',
  'status',
  'error_message',
  'error_category',
  'customer_hidden_at',
  'customer_hidden_reason'
]);
const PATCHABLE_QUEUE_STATUSES = new Set(['scheduled', 'posting', 'posted', 'failed', 'retry', 'manual_required', 'skipped']);

function isLinkableProduct(product = {}) {
  return isRealCoupangProduct(product);
}

function sanitizeQueuePatch(body = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (!PATCHABLE_QUEUE_FIELDS.has(key)) continue;
    patch[key] = value;
  }
  if (patch.status && !PATCHABLE_QUEUE_STATUSES.has(patch.status)) {
    const error = new Error(`Invalid queue status: ${patch.status}`);
    error.status = 400;
    throw error;
  }
  if (patch.scheduled_at && Number.isNaN(new Date(patch.scheduled_at).getTime())) {
    const error = new Error('scheduled_at must be a valid date');
    error.status = 400;
    throw error;
  }
  return patch;
}

router.post('/:postId/add-to-queue', async (req, res, next) => {
  try {
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    if (req.user?.type === 'user') await assertUserCanStartTrialAction(req.user.userId);
    res.status(201).json(await addPostToQueue(req.params.postId, req.body.scheduled_at));
  } catch (e) { next(e); }
});
router.post('/:accountId/create-daily-queue', requireAccountAccessParam(), async (req, res, next) => {
  try {
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    if (req.user?.type === 'user') await assertUserCanStartTrialAction(req.user.userId);
    res.status(201).json(await createDailyQueue(req.params.accountId));
  } catch (e) { next(e); }
});
router.get('/:accountId/queue', requireAccountAccessParam(), async (req, res, next) => {
  try {
    const rows = await dbList('post_queue', { account_id: req.params.accountId }, { order: 'scheduled_at', ascending: true });
    const visibleRows = req.user?.type === 'user' ? rows.filter(isCustomerVisibleQueue) : rows;
    res.json(decorateQueueRows(visibleRows));
  } catch (e) { next(e); }
});
router.patch('/:queueId', requireQueueAccess, async (req, res, next) => {
  try {
    if (req.user?.type === 'user') return res.status(403).json({ error: 'Admin only' });
    const patch = sanitizeQueuePatch(req.body);
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No supported queue fields provided' });
    res.json(decorateQueueRow((await dbUpdate('post_queue', { id: req.params.queueId }, patch))[0]));
  } catch (e) { next(e); }
});
router.post('/:queueId/upload-now', requireQueueAccess, async (req, res, next) => {
  try {
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    if (req.user?.type === 'user') await assertUserCanStartTrialAction(req.user.userId);
    res.json(await uploadQueueItem(req.params.queueId));
  } catch (e) { next(e); }
});
router.post('/:queueId/dismiss', requireQueueAccess, async (req, res, next) => {
  try {
    const queue = req.queue || await dbGet('post_queue', { id: req.params.queueId });
    const updated = await dismissQueueForCustomer(queue, req.body?.reason || 'customer_confirmed');
    res.json(decorateQueueRow(updated));
  } catch (e) { next(e); }
});
router.post('/run', requireAdmin, async (req, res, next) => {
  try { res.json({ processed: await processDueQueue() }); } catch (e) { next(e); }
});

// 큐 아이템 상세 (글 내용 + 상품 + 트래킹 링크)
router.get('/detail/:queueId', requireQueueAccess, async (req, res, next) => {
  try {
    const queue = req.queue || await dbGet('post_queue', { id: req.params.queueId });
    if (!queue) return res.status(404).json({ error: 'Not found' });

    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    const topicId = post?.topic_id || queue.topic_id;
    const postProducts = topicId
      ? await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true })
      : [];
    const products = await Promise.all(
      postProducts.map(async (pp) => {
        const p = await dbGet('coupang_products', { id: pp.product_id });
        return p ? decorateProductQuality({ ...p, rank: pp.rank, reason: pp.recommendation_reason }) : null;
      })
    );
    const trackingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const decoratedQueue = decorateQueueRow(queue);
    const postMode = queue.post_mode || 'auto';
    const hasLinkCandidate = products.filter(isLinkableProduct).length > 0;
    const linkStatus = postMode === 'link'
      ? (trackingLink ? 'ready' : (hasLinkCandidate ? 'pending_tracking' : 'missing'))
      : (postMode === 'no_link' ? 'not_required' : 'unknown');

    res.json({
      queue: decoratedQueue,
      postMode,
      postModeLabel: postModeLabel(postMode),
      linkStatus,
      post,
      products: products.filter(Boolean),
      trackingLink
    });
  } catch (e) { next(e); }
});

// 취소 (scheduled → skipped, post → draft 복구)
router.post('/cancel/:queueId', requireQueueAccess, async (req, res, next) => {
  try {
    const queue = req.queue || await dbGet('post_queue', { id: req.params.queueId });
    if (!queue) return res.status(404).json({ error: 'Not found' });
    if (queue.status !== 'scheduled') return res.status(409).json({ error: `Cannot cancel status: ${queue.status}` });
    const [updated] = await dbUpdate('post_queue', { id: req.params.queueId }, { status: 'skipped', error_message: '수동 취소' });
    if (queue.post_id) await dbUpdate('posts', { id: queue.post_id }, { status: 'draft' });
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
