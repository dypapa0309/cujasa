import { safeLogActivity } from '../services/supabaseService.js';

const buckets = new Map();

function clientKey(req, scope) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
  return `${scope}:${String(ip).split(',')[0].trim()}`;
}

export function requireAdmin(req, res, next) {
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  return next();
}

export function createRateLimit({ scope, windowMs, maxRequests }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = clientKey(req, scope);
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(maxRequests - 1));
      return next();
    }

    current.count += 1;
    const remaining = Math.max(0, maxRequests - current.count);
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));

    if (current.count > maxRequests) {
      safeLogActivity({
        action: 'public_rate_limit_hit',
        level: 'warn',
        message: `${scope}: ${key}`,
        payload: {
          scope,
          count: current.count,
          maxRequests,
          retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000)
        }
      });
      return res.status(429).json({ error: 'Too many requests' });
    }

    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60 * 1000).unref();
