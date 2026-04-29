import { Router } from 'express';
import { processDueQueue } from '../services/schedulerService.js';
import { runFullPipeline } from '../services/pipelineService.js';
import { generateBlogPost } from '../services/blogService.js';

const router = Router();

router.post('/run', async (req, res, next) => {
  try { res.json({ processed: await processDueQueue() }); } catch (e) { next(e); }
});

router.post('/run-pipeline', async (req, res, next) => {
  try { res.json({ results: await runFullPipeline({ requestedBy: req.user?.email || req.user?.type || 'scheduler' }) }); } catch (e) { next(e); }
});

router.post('/generate-blog/:topicId', async (req, res, next) => {
  try { res.status(201).json(await generateBlogPost(req.params.topicId)); } catch (e) { next(e); }
});

export default router;
