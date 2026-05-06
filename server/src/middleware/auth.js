import { isTokenConfigured, listUserProducts, shouldBypassAuth, verifyToken } from '../services/authService.js';
import { dbList } from '../services/supabaseService.js';
import { markedOkKeysFromAudits, shouldHideAssignment, suspiciousAssignmentsForUser } from '../services/accountOwnershipService.js';
import { refreshUserEntitlement } from '../services/billingEntitlementService.js';

const publicRoutes = [
  { method: 'GET', path: '/api/health' },
  { method: 'HEAD', path: '/api/health' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/register' },
  { method: 'GET', path: '/api/auth/threads/callback' },
  { method: 'POST', path: '/api/inquiries' },
  { method: 'POST', path: '/api/webhooks/toss' },
  { method: 'POST', path: '/api/public/checkout/virtual-account' },
  { method: 'POST', path: '/api/public/checkout/toss/success' }
];

function isPublicRoute(req) {
  return publicRoutes.some((route) => route.method === req.method && route.path === req.path);
}

export async function requireAuth(req, res, next) {
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
      await refreshUserEntitlement(payload.userId);
      const [userAccounts, users, accounts, allUserAccounts, audits] = await Promise.all([
        dbList('user_accounts', { user_id: payload.userId }),
        dbList('users'),
        dbList('accounts'),
        dbList('user_accounts'),
        dbList('account_conflict_audits').catch(() => [])
      ]);
      const ignoredKeys = markedOkKeysFromAudits(audits);
      const hiddenIds = new Set(
        suspiciousAssignmentsForUser({ userId: payload.userId, users, accounts, userAccounts: allUserAccounts, ignoredKeys })
          .filter(shouldHideAssignment)
          .map((row) => row.accountId)
      );
      req.user = {
        type: 'user',
        userId: payload.userId,
        email: payload.sub,
        username: payload.username || null,
        maxAccounts: payload.maxAccounts ?? 2,
        allowedAccountIds: userAccounts.map((ua) => ua.account_id).filter((accountId) => !hiddenIds.has(accountId)),
        products: await listUserProducts(payload.userId)
      };
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  } catch (e) {
    next(e);
  }
}
