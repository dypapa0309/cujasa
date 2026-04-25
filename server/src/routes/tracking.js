import { Router } from 'express';
import { recordClick } from '../services/trackingService.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const router = Router();

const trackingRateLimit = createRateLimit({
  scope: 'tracking',
  windowMs: Number(process.env.TRACKING_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  maxRequests: Number(process.env.TRACKING_RATE_LIMIT_MAX || 120)
});

router.use(trackingRateLimit);

router.get('/:code', async (req, res, next) => {
  try {
    const link = await recordClick(req.params.code, req);
    if (!link) return res.status(404).send('Tracking link not found');
    return res.redirect(link.destination_url);
  } catch (e) { next(e); }
});
export default router;
