import { Router } from 'express';
import { dbList } from '../services/supabaseService.js';
import { runDueMetricJobs } from '../services/metricsJobService.js';
import { requireAccountAccessParam } from '../middleware/accountAccess.js';
import { requireAdmin } from '../middleware/rateLimit.js';

const router = Router();
router.post('/run-jobs', requireAdmin, async (req, res, next) => {
  try { res.json({ processed: await runDueMetricJobs() }); } catch (e) { next(e); }
});
router.get('/:accountId/metrics', requireAccountAccessParam(), async (req, res, next) => {
  try { res.json(await dbList('post_metrics', { account_id: req.params.accountId }, { order: 'measured_at' })); } catch (e) { next(e); }
});
export default router;
