import { Router } from 'express';
import {
  createAutomationCampaign,
  deleteAutomationAsset,
  deleteAutomationCampaign,
  deleteAutomationSet,
  expandAutomationAsset,
  getAutomationCampaign,
  getAutomationStudioAnalytics,
  listAutomationCampaignLeads,
  listAutomationCampaigns,
  regenerateAutomationCampaignAssets,
  rewriteAutomationAsset,
  runAutomationCampaign,
  stopAutomationCampaign,
  updateAutomationAsset,
  updateAutomationCampaign
} from '../services/automationStudioService.js';

const router = Router();

function adminOnly(req, res, next) {
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.use(adminOnly);

router.get('/campaigns', async (req, res, next) => {
  try { res.json(await listAutomationCampaigns({ summaryOnly: true })); } catch (e) { next(e); }
});

router.get('/analytics', async (req, res, next) => {
  try { res.json(await getAutomationStudioAnalytics({ campaignId: req.query.campaignId || null })); } catch (e) { next(e); }
});

router.post('/campaigns', async (req, res, next) => {
  try { res.status(201).json(await createAutomationCampaign(req.body, req.user)); } catch (e) { next(e); }
});

router.get('/campaigns/:campaignId', async (req, res, next) => {
  try { res.json(await getAutomationCampaign(req.params.campaignId)); } catch (e) { next(e); }
});

router.patch('/campaigns/:campaignId', async (req, res, next) => {
  try { res.json(await updateAutomationCampaign(req.params.campaignId, req.body, req.user)); } catch (e) { next(e); }
});

router.post('/campaigns/:campaignId/run', async (req, res, next) => {
  try { res.json(await runAutomationCampaign(req.params.campaignId, req.user)); } catch (e) { next(e); }
});

router.post('/campaigns/:campaignId/regenerate-assets', async (req, res, next) => {
  try { res.json(await regenerateAutomationCampaignAssets(req.params.campaignId, req.user)); } catch (e) { next(e); }
});

router.get('/campaigns/:campaignId/leads', async (req, res, next) => {
  try { res.json(await listAutomationCampaignLeads(req.params.campaignId)); } catch (e) { next(e); }
});

router.post('/campaigns/:campaignId/stop', async (req, res, next) => {
  try { res.json(await stopAutomationCampaign(req.params.campaignId, req.user)); } catch (e) { next(e); }
});

router.delete('/campaigns/:campaignId', async (req, res, next) => {
  try { res.json(await deleteAutomationCampaign(req.params.campaignId, req.user)); } catch (e) { next(e); }
});

router.delete('/campaigns/:campaignId/sets/:platform', async (req, res, next) => {
  try { res.json(await deleteAutomationSet(req.params.campaignId, req.params.platform, req.user)); } catch (e) { next(e); }
});

router.patch('/campaigns/:campaignId/assets/:assetId', async (req, res, next) => {
  try { res.json(await updateAutomationAsset(req.params.campaignId, req.params.assetId, req.body, req.user)); } catch (e) { next(e); }
});

router.post('/campaigns/:campaignId/assets/:assetId/expand', async (req, res, next) => {
  try { res.status(201).json(await expandAutomationAsset(req.params.campaignId, req.params.assetId, req.body, req.user)); } catch (e) { next(e); }
});

router.post('/campaigns/:campaignId/assets/:assetId/rewrite', async (req, res, next) => {
  try { res.json(await rewriteAutomationAsset(req.params.campaignId, req.params.assetId, req.user)); } catch (e) { next(e); }
});

router.delete('/campaigns/:campaignId/assets/:assetId', async (req, res, next) => {
  try { res.json(await deleteAutomationAsset(req.params.campaignId, req.params.assetId, req.user)); } catch (e) { next(e); }
});

export default router;
