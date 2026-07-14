import { createHash } from 'node:crypto';
import { Router } from 'express';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  addThreadComment,
  getIssueBySlug,
  getIssueProduct,
  listIssues,
  listTopProducts,
  recordProductClick
} from '../services/issueService.js';

const router = Router();

const commentRateLimit = createRateLimit({
  scope: 'issue_comments',
  windowMs: Number(process.env.ISSUE_COMMENT_RATE_LIMIT_WINDOW_MS || 600_000),
  maxRequests: Number(process.env.ISSUE_COMMENT_RATE_LIMIT_MAX || 10)
});

const clickRateLimit = createRateLimit({
  scope: 'issue_clicks',
  windowMs: Number(process.env.TRACKING_RATE_LIMIT_WINDOW_MS || 60_000),
  maxRequests: Number(process.env.TRACKING_RATE_LIMIT_MAX || 120)
});

export function hashClientIp(req) {
  const salt = process.env.IP_HASH_SALT || '';
  const forwarded = req.headers['x-forwarded-for'];
  const ip = String(forwarded || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (!ip) return null;
  return createHash('sha256').update(salt + ip).digest('hex').slice(0, 32);
}

router.get('/', async (req, res, next) => {
  try {
    const issues = await listIssues({
      limit: Number(req.query.limit) || 20,
      category: req.query.category ? String(req.query.category) : null
    });
    res.json({ issues });
  } catch (error) {
    next(error);
  }
});

router.get('/rankings', async (req, res, next) => {
  try {
    const products = await listTopProducts({ limit: Number(req.query.limit) || 20 });
    res.json({ products });
  } catch (error) {
    next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const detail = await getIssueBySlug(req.params.slug);
    if (!detail) return res.status(404).json({ error: 'Issue not found' });
    res.json(detail);
  } catch (error) {
    next(error);
  }
});

router.post('/products/:productId/click', clickRateLimit, async (req, res, next) => {
  try {
    const product = await getIssueProduct(req.params.productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await recordProductClick(product, { ipHash: hashClientIp(req), userAgent: req.get('user-agent') });
    res.json({ url: product.partner_url });
  } catch (error) {
    next(error);
  }
});

router.post('/threads/:threadId/comments', commentRateLimit, async (req, res, next) => {
  try {
    const comment = await addThreadComment(req.params.threadId, {
      nickname: req.body?.nickname,
      body: req.body?.body,
      ipHash: hashClientIp(req)
    });
    res.status(201).json({ comment });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

export default router;
