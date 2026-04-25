import { Router } from 'express';
import { generateTopics, listTopics } from '../services/topicService.js';

const router = Router();
router.post('/:accountId/generate-topics', async (req, res, next) => {
  try { res.status(201).json(await generateTopics(req.params.accountId)); } catch (e) { next(e); }
});
router.get('/:accountId/topics', async (req, res, next) => {
  try { res.json(await listTopics(req.params.accountId)); } catch (e) { next(e); }
});
export default router;
