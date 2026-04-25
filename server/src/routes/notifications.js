import { Router } from 'express';
import { sendNotification } from '../services/notificationService.js';

const router = Router();
router.post('/test', async (req, res, next) => {
  try { res.json(await sendNotification('test', req.body.message || 'CUJASA notification test')); } catch (e) { next(e); }
});
export default router;
