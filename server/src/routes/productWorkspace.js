import { Router } from 'express';
import {
  analyzeDexorCandidates,
  analyzeInfludexCandidates,
  buildProductWorkspaceSummary,
  getPolibotCustomerWorkspace,
  getProductWorkspaceStatus,
  getProductWorkspace,
  resetDexorWorkspace,
  resetInfludexWorkspace,
  reviewSpreadSubmission,
  searchPolibotCoverageCodes,
  saveInfludexCandidates,
  deleteSublogSubscription,
  listSublogSubscriptions,
  saveDexorCandidates,
  savePolibotCustomer,
  savePolibotKnowledge,
  savePolibotRecommendationFeedback,
  savePolibotRecommendation,
  savePolibotUpload,
  saveSublogSubscription,
  saveSpreadApplicants,
  saveSpreadCampaign,
  startAuvibotAutomationRun,
  updateSpreadCampaignStatus
} from '../services/productWorkspaceService.js';
import { buildReferencePatternContext, ingestTrendReferencesForAccount } from '../services/trendReferenceLearningService.js';
import { getAccount } from '../services/accountService.js';
import { extractTrendReferenceFromImage } from '../services/trendReferenceOcrService.js';
import { analyzePolibotCoverageDocument } from '../services/polibotCoverageDocumentService.js';
import { buildCujasaContentPreview } from '../services/contentPreviewService.js';
import { buildCujasaQueueDiagnostics } from '../services/queueReliabilityService.js';
import { runViralCapturePost, runViralCaptureVideoPost } from '../services/viralCaptureService.js';
import { productMaintenancePayload, productServiceClosedInProduction } from '../utils/productAvailability.js';

const router = Router();

function workspaceServiceClosedInProduction(productId) {
  return productServiceClosedInProduction(productId);
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
  res.status(503).json(productMaintenancePayload(productId));
  return false;
}

router.get('/summary', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await buildProductWorkspaceSummary({
      userId: user.userId,
      allowedAccountIds: user.allowedAccountIds || []
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/polibot/code-search', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await searchPolibotCoverageCodes(user.userId, {
      query: req.query?.q || req.query?.query || '',
      company: req.query?.company || '',
      coverage: req.query?.coverage || '',
      limit: req.query?.limit || 30
    }));
  } catch (error) {
    next(error);
  }
});

router.get('/polibot/status', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await getProductWorkspaceStatus(user.userId, 'polibot'));
  } catch (error) {
    next(error);
  }
});

router.get('/polibot/customer-workspace', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await getPolibotCustomerWorkspace(user.userId));
  } catch (error) {
    next(error);
  }
});

router.get('/:productId', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, req.params.productId)) return;
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

router.post('/cujasa/content-preview', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = req.body?.accountId;
    if (!accountId || !user.allowedAccountIds?.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await buildCujasaContentPreview(accountId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/cujasa/viral-capture-run', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = req.body?.accountId;
    if (!accountId || !user.allowedAccountIds?.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await runViralCapturePost({
      accountId,
      url: req.body?.url || ''
    }));
  } catch (error) {
    next(error);
  }
});

router.post('/cujasa/viral-capture-video-run', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    const accountId = req.body?.accountId;
    if (!accountId || !user.allowedAccountIds?.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await runViralCaptureVideoPost({
      accountId,
      url: req.body?.url || ''
    }));
  } catch (error) {
    next(error);
  }
});

router.post('/auvibot/run', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'auvibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await startAuvibotAutomationRun(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get('/cujasa/queue-diagnostics/:accountId', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    if (!user.allowedAccountIds?.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await buildCujasaQueueDiagnostics(req.params.accountId, { limit: req.query.limit || 30 }));
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
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotUpload(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/knowledge', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotKnowledge(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/recommend', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotRecommendation(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/coverage-document/analyze', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await analyzePolibotCoverageDocument(req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/polibot/recommendations/:id/feedback', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
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
    if (!requireWorkspaceServiceOpen(req, res, 'polibot')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await savePolibotCustomer(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.get('/sublog/subscriptions', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'sublog')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await listSublogSubscriptions(user.userId));
  } catch (error) {
    next(error);
  }
});

router.post('/sublog/subscriptions', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'sublog')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await saveSublogSubscription(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.delete('/sublog/subscriptions/:id', async (req, res, next) => {
  try {
    if (!requireWorkspaceServiceOpen(req, res, 'sublog')) return;
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await deleteSublogSubscription(user.userId, req.params.id));
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
