import { Router } from 'express';
import { processDueQueue } from '../services/schedulerService.js';

const router = Router();
router.post('/run', async (req, res, next) => {
  try { res.json({ processed: await processDueQueue() }); } catch (e) { next(e); }
});
export default router;
