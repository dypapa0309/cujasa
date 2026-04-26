import { Router } from 'express';
import { dbGet, dbList, dbUpdate } from '../services/supabaseService.js';
import { addPostToQueue, createDailyQueue, processDueQueue, uploadQueueItem } from '../services/schedulerService.js';

const router = Router();

router.post('/:postId/add-to-queue', async (req, res, next) => {
  try { res.status(201).json(await addPostToQueue(req.params.postId, req.body.scheduled_at)); } catch (e) { next(e); }
});
router.post('/:accountId/create-daily-queue', async (req, res, next) => {
  try { res.status(201).json(await createDailyQueue(req.params.accountId)); } catch (e) { next(e); }
});
router.get('/:accountId/queue', async (req, res, next) => {
  try { res.json(await dbList('post_queue', { account_id: req.params.accountId }, { order: 'scheduled_at', ascending: true })); } catch (e) { next(e); }
});
router.patch('/:queueId', async (req, res, next) => {
  try { res.json((await dbUpdate('post_queue', { id: req.params.queueId }, req.body))[0]); } catch (e) { next(e); }
});
router.post('/:queueId/upload-now', async (req, res, next) => {
  try { res.json(await uploadQueueItem(req.params.queueId)); } catch (e) { next(e); }
});
router.post('/run', async (req, res, next) => {
  try { res.json({ processed: await processDueQueue() }); } catch (e) { next(e); }
});

// 큐 아이템 상세 (글 내용 + 상품 + 트래킹 링크)
router.get('/detail/:queueId', async (req, res, next) => {
  try {
    const queue = await dbGet('post_queue', { id: req.params.queueId });
    if (!queue) return res.status(404).json({ error: 'Not found' });

    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    const postProducts = queue.topic_id
      ? await dbList('post_products', { topic_id: queue.topic_id }, { order: 'rank', ascending: true })
      : [];
    const products = await Promise.all(
      postProducts.map(async (pp) => {
        const p = await dbGet('coupang_products', { id: pp.product_id });
        return p ? { ...p, rank: pp.rank, reason: pp.recommendation_reason } : null;
      })
    );
    const trackingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;

    res.json({
      queue,
      post,
      products: products.filter(Boolean),
      trackingLink
    });
  } catch (e) { next(e); }
});

// 취소 (scheduled → skipped)
router.post('/cancel/:queueId', async (req, res, next) => {
  try {
    const queue = await dbGet('post_queue', { id: req.params.queueId });
    if (!queue) return res.status(404).json({ error: 'Not found' });
    if (queue.status !== 'scheduled') return res.status(409).json({ error: `Cannot cancel status: ${queue.status}` });
    const [updated] = await dbUpdate('post_queue', { id: req.params.queueId }, { status: 'skipped', error_message: '수동 취소' });
    res.json(updated);
  } catch (e) { next(e); }
});

export default router;
