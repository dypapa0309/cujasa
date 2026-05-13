import { Router } from 'express';
import { coreHealth } from '../services/cujasaCoreService.js';

const router = Router();

router.get('/health', async (req, res, next) => {
  try {
    const health = await coreHealth();
    res.json(health);
  } catch (error) {
    next(error);
  }
});

export default router;
