import { Router } from 'express';
import { isAuthConfigured, loginAdmin, shouldBypassAuth } from '../services/authService.js';

const router = Router();

router.post('/login', (req, res, next) => {
  try {
    res.json(loginAdmin(req.body.email, req.body.password));
  } catch (error) {
    next(error);
  }
});

router.get('/me', (req, res) => {
  res.json({
    admin: req.admin || null,
    authConfigured: isAuthConfigured(),
    devBypass: shouldBypassAuth()
  });
});

export default router;
