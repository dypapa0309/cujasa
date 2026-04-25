import { Router } from 'express';
import { listProducts, searchProductsForTopic } from '../services/coupangService.js';
import { selectProducts } from '../services/productSelectionService.js';

const router = Router();
router.post('/:topicId/search-products', async (req, res, next) => {
  try { res.status(201).json(await searchProductsForTopic(req.params.topicId)); } catch (e) { next(e); }
});
router.post('/:topicId/select-products', async (req, res, next) => {
  try { res.status(201).json(await selectProducts(req.params.topicId, req.body.postId)); } catch (e) { next(e); }
});
router.get('/:topicId/products', async (req, res, next) => {
  try { res.json(await listProducts(req.params.topicId)); } catch (e) { next(e); }
});
export default router;
