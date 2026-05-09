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
  savePolibotRecommendationFeedback,
  savePolibotRecommendation,
  savePolibotUpload,
  saveSpreadApplicants,
  saveSpreadCampaign,
  updateSpreadCampaignStatus
} from '../services/productWorkspaceService.js';
import { buildReferencePatternContext, ingestTrendReferencesForAccount } from '../services/trendReferenceLearningService.js';
import { getAccount } from '../services/accountService.js';
import { extractTrendReferenceFromImage } from '../services/trendReferenceOcrService.js';

const router = Router();

function workspaceServiceClosedInProduction(productId) {
  if (process.env.NODE_ENV !== 'production') return false;
  if (productId === 'spread') return process.env.SPREAD_SERVICE_OPEN !== 'true';
  if (productId === 'infludex') return process.env.INFLUDEX_SERVICE_OPEN !== 'true';
  return false;
}

function requireUser(req, res) {
  if (!req.user || req.user.type !== 'user') {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return req.user;
}

function requireWorkspaceServiceOpen(req, res, productId) {
  if (!workspaceServiceClosedInProduction(productId)) return true;
  const productName = productId === 'infludex' ? 'INFLUDEX' : 'SPREAD';
  res.status(503).json({
    error: `${productName}_SERVICE_MAINTENANCE`,
    message: `${productName}는 현재 서비스 점검 중입니다.`
  });
  return false;
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

router.post('/cujasa/trend-references', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = req.body?.accountId;
    if (!accountId || !user.allowedAccountIds?.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await ingestTrendReferencesForAccount(accountId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/cujasa/trend-reference-ocr', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = req.body?.accountId;
    if (!accountId || !user.allowedAccountIds?.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await extractTrendReferenceFromImage({
      fileName: req.body?.fileName || '',
      mimeType: req.body?.mimeType || req.body?.type || 'image/png',
      base64: req.body?.base64 || '',
      topicKeyword: req.body?.topicKeyword || req.body?.category || ''
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/cujasa/reference-pattern-context/:accountId', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    if (!user.allowedAccountIds?.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const account = await getAccount(req.params.accountId);
    res.json(await buildReferencePatternContext(account, { limit: Number(req.query.limit || 5) }));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/candidates', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'infludex')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveInfludexCandidates(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/analyze', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'infludex')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await analyzeInfludexCandidates(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/infludex/reset', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'infludex')) return;
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

router.post('/polibot/recommendations/:id/feedback', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotRecommendationFeedback(user.userId, {
      ...(req.body || {}),
      recommendationId: req.params.id
    }));
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
    if (!requireWorkspaceServiceOpen(req, res, 'spread')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveSpreadCampaign(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/campaign/status', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'spread')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await updateSpreadCampaignStatus(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/applicants', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'spread')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveSpreadApplicants(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/spread/review', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'spread')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await reviewSpreadSubmission(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

export default router;
