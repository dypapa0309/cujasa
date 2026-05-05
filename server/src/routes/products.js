import { Router } from 'express';
import { listProducts, searchProductsForTopic } from '../services/coupangService.js';
import { manuallySelectProduct, selectProducts } from '../services/productSelectionService.js';
import { requireTopicAccess } from '../middleware/accountAccess.js';
import { dbList } from '../services/supabaseService.js';

const router = Router();
router.post('/:topicId/search-products', requireTopicAccess, async (req, res, next) => {
  try {
    const products = await searchProductsForTopic(req.params.topicId);
    const blockedProduct = products.find((product) => ['COUPANG_RATE_LIMIT', 'COUPANG_SEARCH_THROTTLED'].includes(product.raw_data?.code || ''));
    res.status(201).json({
      products,
      realCount: products.filter((product) => !product.is_fallback).length,
      blocked: Boolean(blockedProduct),
      reasonCode: blockedProduct?.raw_data?.code || products.find((product) => product.raw_data?.code)?.raw_data?.code || null,
      retryAfterMs: blockedProduct?.raw_data?.retryAfterMs || null,
      cooldownUntil: blockedProduct?.raw_data?.cooldownUntil || null
    });
  } catch (e) { next(e); }
});
router.post('/:topicId/select-products', requireTopicAccess, async (req, res, next) => {
  try {
    const selected = await selectProducts(req.params.topicId, req.body.postId);
    res.status(201).json(selected);
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
