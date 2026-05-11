import { isTokenConfigured, listUserProducts, shouldBypassAuth, verifyToken } from '../services/authService.js';
import { dbGet, dbList } from '../services/supabaseService.js';
import { refreshUserEntitlement } from '../services/billingEntitlementService.js';

const AUTH_CONTEXT_CACHE_TTL_MS = Math.max(0, Number(process.env.AUTH_CONTEXT_CACHE_TTL_MS || 30000));
const userContextCache = new Map();

export function clearAuthContextCache(userId = '') {
  if (userId) userContextCache.delete(userId);
  else userContextCache.clear();
}

const publicRoutes = [
  { method: 'GET', path: '/api/health' },
  { method: 'HEAD', path: '/api/health' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/register' },
  { method: 'GET', path: '/api/auth/threads/callback' },
  { method: 'POST', path: '/api/inquiries' },
  { method: 'POST', path: '/api/webhooks/toss' },
  { method: 'POST', path: '/api/scheduler/daily-pipeline' },
  { method: 'POST', path: '/api/public/checkout/virtual-account' },
  { method: 'POST', path: '/api/public/checkout/toss/success' }
];

function isPublicRoute(req) {
  if (req.method === 'GET' && /^\/api\/public\/lead-forms\/[^/]+$/.test(req.path)) return true;
  if (req.method === 'POST' && /^\/api\/public\/lead-forms\/[^/]+\/submissions$/.test(req.path)) return true;
  return publicRoutes.some((route) => route.method === req.method && route.path === req.path);
}

export async function requireAuth(req, res, next) {
  const startedAt = Date.now();
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (isPublicRoute(req)) return next();
    if (req.path === '/api/auth/me' && !req.headers.authorization) return next();

    if (shouldBypassAuth()) {
      req.user = { type: 'admin', email: 'dev-local' };
      req.admin = { email: 'dev-local', bypass: true };
      return next();
    }

    if (!isTokenConfigured()) {
      return res.status(503).json({ error: 'Server auth token secret is not configured' });
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    if (payload.role === 'admin') {
      req.user = { type: 'admin', email: payload.sub };
      req.admin = { email: payload.sub };
    } else if (payload.role === 'user') {
      const cacheKey = payload.userId;
      const cached = userContextCache.get(cacheKey);
      const context = cached && cached.expiresAt > Date.now()
        ? cached.value
        : await (async () => {
          await refreshUserEntitlement(payload.userId);
          const [appUser, userAccounts, products] = await Promise.all([
            dbGet('users', { id: payload.userId }).catch(() => null),
            dbList('user_accounts', { user_id: payload.userId }),
            listUserProducts(payload.userId)
          ]);
          const value = {
            user: appUser,
            allowedAccountIds: userAccounts.map((ua) => ua.account_id).filter(Boolean),
            products
          };
          if (AUTH_CONTEXT_CACHE_TTL_MS > 0) {
            userContextCache.set(cacheKey, { value, expiresAt: Date.now() + AUTH_CONTEXT_CACHE_TTL_MS });
          }
          return value;
        })();
      if (!context.user) return res.status(401).json({ error: 'Unauthorized' });
      if (context.user.status === 'suspended') return res.status(403).json({ error: 'Account suspended' });
      if (context.user.archived_at) return res.status(403).json({ error: 'Account archived' });
      req.user = {
        type: 'user',
        userId: payload.userId,
        email: context.user.email || payload.sub,
        username: context.user.username || payload.username || null,
        maxAccounts: context.user.max_accounts ?? payload.maxAccounts ?? 2,
        allowedAccountIds: context.allowedAccountIds,
        products: context.products
      };
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.setHeader('X-Auth-Context-Duration-Ms', String(Date.now() - startedAt));
    next();
  } catch (e) {
    next(e);
  }
}
