import { isAuthConfigured, shouldBypassAuth, verifyToken } from '../services/authService.js';
import { dbList } from '../services/supabaseService.js';

const publicPaths = ['/api/health', '/api/auth/login'];

export async function requireAuth(req, res, next) {
  try {
    if (!req.path.startsWith('/api/')) return next();
    if (publicPaths.includes(req.path)) return next();

    if (shouldBypassAuth()) {
      req.user = { type: 'admin', email: 'dev-local' };
      req.admin = { email: 'dev-local', bypass: true };
      return next();
    }

    if (!isAuthConfigured()) {
      return res.status(503).json({ error: 'Admin auth is not configured' });
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized' });

    if (payload.role === 'admin') {
      req.user = { type: 'admin', email: payload.sub };
      req.admin = { email: payload.sub };
    } else if (payload.role === 'user') {
      const userAccounts = await dbList('user_accounts', { user_id: payload.userId });
      req.user = {
        type: 'user',
        userId: payload.userId,
        email: payload.sub,
        maxAccounts: payload.maxAccounts ?? 4,
        allowedAccountIds: userAccounts.map((ua) => ua.account_id)
      };
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    next();
  } catch (e) {
    next(e);
  }
}
