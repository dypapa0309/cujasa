import { Router } from 'express';
import { getTrialStatusForUser } from '../services/trialEntitlementService.js';
import { getSetupStatusForUser } from '../services/setupReadinessService.js';
import { requestSetupTaskForUser } from '../services/setupTaskService.js';
import { listThreadsConnectionRequestsForUser, requestThreadsConnection } from '../services/threadsConnectionRequestService.js';

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

router.get('/threads-connection-requests', async (req, res, next) => {
  try {
    if (!req.user || req.user.type !== 'user') return res.status(401).json({ error: 'Unauthorized' });
    res.json(await listThreadsConnectionRequestsForUser(req.user.userId, {
      accountId: req.query?.accountId || null
    }));
  } catch (error) {
    next(error);
  }
});

router.post('/threads-connection-requests', async (req, res, next) => {
  try {
    if (!req.user || req.user.type !== 'user') return res.status(401).json({ error: 'Unauthorized' });
    res.json(await requestThreadsConnection({
      userId: req.user.userId,
      accountId: req.body?.accountId || '',
      threadsHandle: req.body?.threadsHandle || req.body?.threads_handle || '',
      requestMemo: req.body?.requestMemo || req.body?.request_memo || ''
    }));
  } catch (error) {
    next(error);
  }
});

export default router;
