import { Router } from 'express';
import { generateTopics, listTopics, createManualTopic } from '../services/topicService.js';
import { requireAccountAccessParam } from '../middleware/accountAccess.js';

const router = Router();
router.post('/:accountId/generate-topics', requireAccountAccessParam(), async (req, res, next) => {
  try { res.status(201).json(await generateTopics(req.params.accountId)); } catch (e) { next(e); }
});
router.get('/:accountId/topics', requireAccountAccessParam(), async (req, res, next) => {
  try { res.json(await listTopics(req.params.accountId)); } catch (e) { next(e); }
});
router.post('/:accountId/manual-topic', requireAccountAccessParam(), async (req, res, next) => {
  try {
    const { title, angle } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: '주제 제목을 입력해주세요.' });
    res.status(201).json(await createManualTopic(req.params.accountId, { title: title.trim(), angle: angle?.trim() }));
  } catch (e) { next(e); }
});
export default router;
