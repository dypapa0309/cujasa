import { Router } from 'express';
import { getTrialStatusForUser } from '../services/trialEntitlementService.js';

const router = Router();

router.get('/trial-status', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.type === 'admin') return res.json(await getTrialStatusForUser(null, { role: 'admin' }));
    res.json(await getTrialStatusForUser(req.user.userId));
  } catch (error) {
    next(error);
  }
});

export default router;
