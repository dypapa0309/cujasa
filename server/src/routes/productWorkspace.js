import { Router } from 'express';
import {
  analyzeDexorCandidates,
  analyzeInfludexCandidates,
  getProductWorkspace,
  resetDexorWorkspace,
  resetInfludexWorkspace,
  reviewSpreadSubmission,
  saveInfludexCandidates,
  saveDexorCandidates,
  savePolibotCustomer,
  savePolibotKnowledge,
  savePolibotRecommendation,
  savePolibotUpload,
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

router.post('/dexor/reset', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await resetDexorWorkspace(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/candidates', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveInfludexCandidates(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/analyze', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await analyzeInfludexCandidates(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/reset', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await resetInfludexWorkspace(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/upload', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotUpload(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/knowledge', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotKnowledge(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/recommend', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotRecommendation(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/customers', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotCustomer(user.userId, req.body || {}));
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
