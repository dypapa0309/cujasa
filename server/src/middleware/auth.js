import { isAuthConfigured, shouldBypassAuth, verifyToken } from '../services/authService.js';

const publicPaths = [
  '/api/health',
  '/api/auth/login'
];

export function requireAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (publicPaths.includes(req.path)) return next();

  if (shouldBypassAuth()) {
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
  req.admin = payload;
  return next();
}
