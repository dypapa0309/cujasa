import { Router } from 'express';
import { isAuthConfigured, loginAdmin, loginUser, shouldBypassAuth } from '../services/authService.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const loginRateLimit = createRateLimit({ scope: 'login', windowMs: 10 * 60 * 1000, maxRequests: 10 });

const router = Router();

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    // admin 먼저 시도, 실패하면 user 시도
    try {
      return res.json(loginAdmin(req.body.email, req.body.password));
    } catch (adminErr) {
      if (adminErr.status !== 401) throw adminErr;
    }
    return res.json(await loginUser(req.body.email, req.body.password));
  } catch (error) {
    next(error);
  }
});

router.get('/me', (req, res) => {
  const user = req.user;
  if (!user) return res.json({ authConfigured: isAuthConfigured(), devBypass: shouldBypassAuth() });
  if (user.type === 'admin') {
    return res.json({ type: 'admin', admin: { email: user.email }, authConfigured: true });
  }
  return res.json({
    type: 'user',
    user: { email: user.email, userId: user.userId, maxAccounts: user.maxAccounts, allowedAccountIds: user.allowedAccountIds },
    authConfigured: true
  });
});

export default router;
