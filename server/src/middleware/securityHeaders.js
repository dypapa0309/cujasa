export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'none'",
      "style-src 'unsafe-inline'",
      "img-src 'self' https://ads-partners.coupang.com https://*.coupangcdn.com data:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
  next();
}
