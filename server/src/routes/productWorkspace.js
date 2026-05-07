import { Router } from 'express';
import {
  analyzeDexorCandidates,
  getProductWorkspace,
  reviewSpreadSubmission,
  saveDexorCandidates,
  saveSpreadApplicants,
  saveSpreadCampaign
} from '../services/productWorkspaceService.js';

const router = Router();

function requireUser(req, res) {
  if (!req.user || req.user.type !== 'user') {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return req.user;
}

router.get('/:productId', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await getProductWorkspace(user.userId, req.params.productId));
  } catch (error) {
    next(error);
  }
});

router.post('/dexor/candidates', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveDexorCandidates(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/dexor/analyze', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await analyzeDexorCandidates(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/campaign', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveSpreadCampaign(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/applicants', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveSpreadApplicants(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/review', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await reviewSpreadSubmission(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

export default router;
