const buckets = new Map();

function clientKey(req, scope) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'unknown';
  return `${scope}:${String(ip).split(',')[0].trim()}`;
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
