import { Router } from 'express';
import { DEFAULT_PRODUCT_ID, productById } from '../config/products.js';
import { grantUserProduct, isAuthConfigured, listAvailableProducts, listUserProducts, loginAdmin, loginUser, registerFreeUser, shouldBypassAuth } from '../services/authService.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { clearAuthContextCache } from '../middleware/auth.js';
import { completeThreadsOAuth, createThreadsAuthUrl } from '../services/threadsOAuthService.js';
import { refreshUserEntitlement } from '../services/billingEntitlementService.js';

const loginRateLimit = createRateLimit({ scope: 'login', windowMs: 10 * 60 * 1000, maxRequests: 10 });

const router = Router();

router.post('/register', loginRateLimit, async (req, res, next) => {
  try {
    const result = await registerFreeUser(req.body || {});
    const entitlement = await refreshUserEntitlement(result.userId);
    result.products = await listUserProducts(result.userId);
    result.billing = entitlement.billing;
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    if (isAuthConfigured()) {
      try {
        return res.json(loginAdmin(req.body.email, req.body.password));
      } catch (adminErr) {
        if (adminErr.status !== 401) throw adminErr;
      }
    }
    const result = await loginUser(req.body.email, req.body.password);
    if (result.type === 'user') {
      const entitlement = await refreshUserEntitlement(result.userId);
      result.products = await listUserProducts(result.userId);
      result.billing = entitlement.billing;
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) return res.json({ authConfigured: isAuthConfigured(), devBypass: shouldBypassAuth() });
    if (user.type === 'admin') {
      return res.json({ type: 'admin', admin: { email: user.email }, authConfigured: true });
    }
    const entitlement = await refreshUserEntitlement(user.userId);
    return res.json({
      type: 'user',
      user: {
        email: user.email,
        username: entitlement.user?.username || user.username || null,
        userId: user.userId,
        maxAccounts: user.maxAccounts,
        allowedAccountIds: user.allowedAccountIds,
        products: await listUserProducts(user.userId),
        billing: entitlement.billing
      },
      authConfigured: true
    });
  } catch (error) {
    next(error);
  }
});

router.post('/products/:productId/start', async (req, res, next) => {
  try {
    if (!req.user || req.user.type !== 'user') return res.status(401).json({ error: 'Unauthorized' });
    const requestedProductId = String(req.params.productId || '').trim().toLowerCase();
    const configuredProduct = productById(requestedProductId);
    const products = await listAvailableProducts();
    const dbProduct = products.find((item) => item.id === requestedProductId);
    const product = dbProduct ? {
      id: dbProduct.id,
      name: dbProduct.name,
      status: dbProduct.status
    } : configuredProduct;
    if (!product || product.status === 'inactive') return res.status(404).json({ error: 'Product not found' });
    if (product.id === 'spread' && process.env.NODE_ENV === 'production' && process.env.SPREAD_SERVICE_OPEN !== 'true') {
      return res.status(503).json({ error: 'SPREAD_SERVICE_MAINTENANCE', message: 'SPREAD는 현재 서비스 점검 중입니다.' });
    }
    if (product.status === 'preparing') {
      return res.status(409).json({ error: '아직 준비 중인 제품입니다.' });
    }

    await grantUserProduct(req.user.userId, product.id, { status: 'active', role: 'customer' });
    clearAuthContextCache(req.user.userId);
    const entitlement = await refreshUserEntitlement(req.user.userId);
    res.status(201).json({
      productId: product.id,
      products: await listUserProducts(req.user.userId),
      billing: entitlement.billing,
      accountRequired: product.id === DEFAULT_PRODUCT_ID
    });
  } catch (error) {
    next(error);
  }
});

router.get('/threads/start', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const accountId = req.query.accountId;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    const url = await createThreadsAuthUrl({ accountId, user: req.user });
    if (req.headers.authorization || req.accepts('json') === 'json') return res.json({ url });
    res.redirect(url);
  } catch (error) {
    next(error);
  }
});

router.get('/threads/callback', async (req, res, next) => {
  try {
    const account = await completeThreadsOAuth({ code: req.query.code, state: req.query.state });
    const clientBase = (process.env.CLIENT_BASE_URL || 'http://localhost:5175').split(',')[0].trim();
    const params = new URLSearchParams({ threads: 'connected', accountId: account.id });
    res.redirect(`${clientBase}?${params.toString()}`);
  } catch (error) {
    const clientBase = (process.env.CLIENT_BASE_URL || 'http://localhost:5175').split(',')[0].trim();
    const params = new URLSearchParams({ threads: 'error', message: error.message });
    res.redirect(`${clientBase}?${params.toString()}`);
  }
});

export default router;
