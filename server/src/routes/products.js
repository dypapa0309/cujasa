import { Router } from 'express';
import { listProducts, searchProductsForTopic } from '../services/coupangService.js';
import { manuallySelectProduct, selectProducts } from '../services/productSelectionService.js';
import { requireTopicAccess } from '../middleware/accountAccess.js';
import { dbList } from '../services/supabaseService.js';
import { repairProductsForTopic } from '../services/productRepairService.js';

const router = Router();
router.post('/:topicId/search-products', requireTopicAccess, async (req, res, next) => {
  try {
    const products = await searchProductsForTopic(req.params.topicId, { saveFallback: false });
    const repair = await repairProductsForTopic(req.params.topicId, { attemptLimit: 3 });
    res.status(201).json({ products, repair });
  } catch (e) { next(e); }
});
router.post('/:topicId/select-products', requireTopicAccess, async (req, res, next) => {
  try {
    const selected = await selectProducts(req.params.topicId, req.body.postId);
    if (selected.length > 0) return res.status(201).json(selected);
    const repair = await repairProductsForTopic(req.params.topicId, { postId: req.body.postId, attemptLimit: 3 });
    res.status(201).json(repair.selectedProducts || []);
  } catch (e) { next(e); }
});
router.post('/:topicId/manual-product-selection', requireTopicAccess, async (req, res, next) => {
  try {
    res.status(201).json(await manuallySelectProduct(req.params.topicId, req.body.productId, req.body));
  } catch (e) { next(e); }
});
router.get('/:topicId/products', requireTopicAccess, async (req, res, next) => {
  try {
    const [products, selected] = await Promise.all([
      listProducts(req.params.topicId),
      dbList('post_products', { topic_id: req.params.topicId }, { order: 'rank', ascending: true })
    ]);
    const selectedByProductId = new Map(selected.map((row) => [row.product_id, row]));
    res.json(products.map((product) => {
      const row = selectedByProductId.get(product.id);
      return row ? {
        ...product,
        selected: true,
        selected_rank: row.rank,
        selected_fit_score: row.fit_score,
        selected_reason: row.recommendation_reason
      } : product;
    }));
  } catch (e) { next(e); }
});
export default router;
