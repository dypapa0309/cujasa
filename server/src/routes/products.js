import { Router } from 'express';
import { listProducts, searchProductsForTopic } from '../services/coupangService.js';
import { manuallySelectProduct, selectProducts } from '../services/productSelectionService.js';
import { requireTopicAccess } from '../middleware/accountAccess.js';
import { dbList } from '../services/supabaseService.js';
import { decorateProductQuality } from '../utils/productQuality.js';

const router = Router();
router.post('/:topicId/search-products', requireTopicAccess, async (req, res, next) => {
  try {
    const products = await searchProductsForTopic(req.params.topicId);
    const statusItem = products.find((product) => product.is_search_status || product.raw_data?.code);
    const blockedProduct = products.find((product) => [
      'COUPANG_RATE_LIMIT',
      'COUPANG_SEARCH_THROTTLED',
      'COUPANG_LOCK_UNAVAILABLE',
      'COUPANG_CREDENTIALS_MISSING',
      'COUPANG_API_REJECTED',
      'COUPANG_API_ERROR'
    ].includes(product.raw_data?.code || ''));
    const decorated = products
      .filter((product) => !product.is_search_status)
      .map(decorateProductQuality);
    const reasonCode = blockedProduct?.raw_data?.code || statusItem?.raw_data?.code || null;
    res.status(201).json({
      products: decorated,
      realCount: decorated.filter((product) => product.is_real_product !== false).length,
      blocked: Boolean(blockedProduct),
      reasonCode,
      message: reasonCode === 'NO_REAL_PRODUCTS'
        ? '쿠팡 검색 결과가 없어 실상품 후보를 만들지 못했습니다.'
        : reasonCode === 'COUPANG_CREDENTIALS_MISSING'
          ? '쿠팡 검색 키가 없어 상품 검색을 실행할 수 없습니다.'
          : reasonCode === 'COUPANG_API_REJECTED' || reasonCode === 'COUPANG_API_ERROR'
            ? '쿠팡 API 응답 문제로 실상품 후보를 만들지 못했습니다.'
            : blockedProduct?.raw_data?.message || null,
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
      if (!row) return product;
      if (product.is_real_product === false) {
        return {
          ...product,
          selected_invalid: true,
          selected_rank: row.rank,
          selected_fit_score: row.fit_score,
          selected_reason: row.recommendation_reason
        };
      }
      return {
        ...product,
        selected: true,
        selected_rank: row.rank,
        selected_fit_score: row.fit_score,
        selected_reason: row.recommendation_reason
      };
    }));
  } catch (e) { next(e); }
});
export default router;
