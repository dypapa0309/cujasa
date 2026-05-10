import { Router } from 'express';
import { getPublicLeadForm, submitPublicLeadForm } from '../services/automationStudioService.js';

const router = Router();

router.get('/:slug', async (req, res, next) => {
  try {
    res.json(await getPublicLeadForm(req.params.slug));
  } catch (e) {
    next(e);
  }
});

router.post('/:slug/submissions', async (req, res, next) => {
  try {
    res.status(201).json(await submitPublicLeadForm(req.params.slug, req.body, {
      referer: req.get('referer') || '',
      userAgent: req.get('user-agent') || ''
    }));
  } catch (e) {
    next(e);
  }
});

export default router;
