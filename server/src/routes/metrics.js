import { Router } from 'express';
import { dbList } from '../services/supabaseService.js';
import { runDueMetricJobs } from '../services/metricsJobService.js';

const router = Router();
router.post('/run-jobs', async (req, res, next) => {
  try { res.json({ processed: await runDueMetricJobs() }); } catch (e) { next(e); }
});
router.get('/:accountId/metrics', async (req, res, next) => {
  try { res.json(await dbList('post_metrics', { account_id: req.params.accountId }, { order: 'measured_at' })); } catch (e) { next(e); }
});
export default router;
