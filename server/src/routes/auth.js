import { Router } from 'express';
import { DEFAULT_PRODUCT_ID, productById } from '../config/products.js';
import { grantUserProduct, isAdminLoginCandidate, isAuthConfigured, listAvailableProducts, listUserProducts, loginAdmin, loginUser, registerFreeUser, shouldBypassAuth } from '../services/authService.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { clearAuthContextCache } from '../middleware/auth.js';
import { completeThreadsOAuth, createThreadsAuthUrl, recordThreadsOAuthFailure, threadsOAuthErrorFromCallback } from '../services/threadsOAuthService.js';
import { refreshUserEntitlement } from '../services/billingEntitlementService.js';
import { productMaintenancePayload, productServiceClosedInProduction } from '../utils/productAvailability.js';

const loginRateLimit = createRateLimit({ scope: 'login', windowMs: 10 * 60 * 1000, maxRequests: 10 });
const AUTH_DETAIL_TIMEOUT_MS = Number(process.env.AUTH_DETAIL_TIMEOUT_MS || 1500);

const router = Router();

function fallbackProductsFromToken(user = {}) {
  return (Array.isArray(user.products) ? user.products : [])
    .map((productId) => {
      const product = productById(productId) || {};
      return {
        productId,
        status: 'active',
        role: 'customer',
        name: product.name || productId,
        description: product.description,
        appUrl: product.appUrl,
        landingUrl: product.landingUrl,
        settingsSummary: {}
      };
    });
}

async function withAuthDetailTimeout(label, promise, fallback) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[auth] ${label} timed out after ${AUTH_DETAIL_TIMEOUT_MS}ms`);
          resolve(fallback);
        }, AUTH_DETAIL_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    console.warn(`[auth] ${label} failed`, error?.message || error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

router.post('/register', loginRateLimit, async (req, res, next) => {
  try {
    const result = await registerFreeUser(req.body || {}, { req, device: req.body?.device || null });
    const entitlement = await withAuthDetailTimeout('register entitlement refresh', refreshUserEntitlement(result.userId), null);
    result.products = await withAuthDetailTimeout('register products refresh', listUserProducts(result.userId), result.products || []);
    result.billing = entitlement?.billing || null;
    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    if (isAdminLoginCandidate(req.body.email)) {
      return res.json(loginAdmin(req.body.email, req.body.password));
    }
    const result = await loginUser(req.body.email, req.body.password, { req, device: req.body.device || null });
    if (result.type === 'user') {
      const entitlement = await withAuthDetailTimeout('login entitlement refresh', refreshUserEntitlement(result.userId), null);
      result.billing = entitlement?.billing || null;
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
    if (req.authDegraded || user.dbUnavailable) {
      res.setHeader('X-CUJASA-Degraded', 'SUPABASE_UNAVAILABLE');
      return res.json({
        type: 'user',
        degraded: true,
        code: 'SUPABASE_UNAVAILABLE',
        message: '현재 데이터베이스 연결이 지연되고 있습니다. 로그인 세션은 유지되며 잠시 후 다시 시도해주세요.',
        user: {
          email: user.email,
          username: user.username || null,
          userId: user.userId,
          maxAccounts: user.maxAccounts,
          allowedAccountIds: [],
          products: fallbackProductsFromToken(user),
          billing: null
        },
        authConfigured: true
      });
    }
    const entitlement = await withAuthDetailTimeout('me entitlement refresh', refreshUserEntitlement(user.userId), null);
    const products = await withAuthDetailTimeout('me products refresh', listUserProducts(user.userId), fallbackProductsFromToken(user));
    return res.json({
      type: 'user',
      user: {
        email: user.email,
        username: entitlement?.user?.username || user.username || null,
        userId: user.userId,
        maxAccounts: entitlement?.user?.max_accounts ?? user.maxAccounts,
        allowedAccountIds: user.allowedAccountIds,
        products,
        billing: entitlement?.billing || null
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
    if (productServiceClosedInProduction(product.id)) {
      return res.status(503).json(productMaintenancePayload(product.id));
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
    const callbackError = threadsOAuthErrorFromCallback(req.query || {});
    if (callbackError) throw callbackError;
    const account = await completeThreadsOAuth({ code: req.query.code, state: req.query.state });
    const clientBase = (process.env.CLIENT_BASE_URL || 'http://localhost:5175').split(',')[0].trim();
    const params = new URLSearchParams({ threads: 'connected', accountId: account.id });
    res.redirect(`${clientBase}?${params.toString()}`);
  } catch (error) {
    const clientBase = (process.env.CLIENT_BASE_URL || 'http://localhost:5175').split(',')[0].trim();
    const failure = await recordThreadsOAuthFailure({ state: req.query.state, error }).catch(() => ({
      code: 'THREADS_OAUTH_FAILED',
      message: error.message || 'Threads 연결에 실패했습니다.',
      accountId: null
    }));
    const params = new URLSearchParams({
      threads: 'error',
      message: failure.message,
      code: failure.code
    });
    if (failure.accountId) params.set('accountId', failure.accountId);
    res.redirect(`${clientBase}?${params.toString()}`);
  }
});

export default router;
