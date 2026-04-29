import { Router } from 'express';
import { dashboardSummary, getAccountAnalytics } from '../services/analyticsService.js';
import { requireAccountAccessParam } from '../middleware/accountAccess.js';

const router = Router();
router.get('/dashboard/summary', async (req, res, next) => {
  try { res.json(await dashboardSummary()); } catch (e) { next(e); }
});
router.get('/:accountId/analytics', requireAccountAccessParam(), async (req, res, next) => {
  try { res.json(await getAccountAnalytics(req.params.accountId)); } catch (e) { next(e); }
});
export default router;
