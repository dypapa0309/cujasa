import { Router } from 'express';
import { getTrialStatusForUser } from '../services/trialEntitlementService.js';
import { getSetupStatusForUser } from '../services/setupReadinessService.js';
import { requestSetupTaskForUser } from '../services/setupTaskService.js';

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

router.get('/setup-status', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.type === 'admin') return res.json(await getSetupStatusForUser(null, { role: 'admin' }));
    res.json(await getSetupStatusForUser(req.user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/setup-request', async (req, res, next) => {
  try {
    if (!req.user || req.user.type !== 'user') return res.status(401).json({ error: 'Unauthorized' });
    res.json(await requestSetupTaskForUser(req.user.userId, {
      accountId: req.body?.accountId || null,
      message: req.body?.message || ''
    }));
  } catch (error) {
    next(error);
  }
});

export default router;
