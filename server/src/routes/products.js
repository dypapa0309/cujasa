import { Router } from 'express';
import { listProducts, searchProductsForTopic } from '../services/coupangService.js';
import { selectProducts } from '../services/productSelectionService.js';
import { requireTopicAccess } from '../middleware/accountAccess.js';

const router = Router();
router.post('/:topicId/search-products', requireTopicAccess, async (req, res, next) => {
  try { res.status(201).json(await searchProductsForTopic(req.params.topicId)); } catch (e) { next(e); }
});
router.post('/:topicId/select-products', requireTopicAccess, async (req, res, next) => {
  try { res.status(201).json(await selectProducts(req.params.topicId, req.body.postId)); } catch (e) { next(e); }
});
router.get('/:topicId/products', requireTopicAccess, async (req, res, next) => {
  try { res.json(await listProducts(req.params.topicId)); } catch (e) { next(e); }
});
export default router;
