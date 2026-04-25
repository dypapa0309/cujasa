import { Router } from 'express';
import { dbList, dbUpdate } from '../services/supabaseService.js';
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
export default router;
