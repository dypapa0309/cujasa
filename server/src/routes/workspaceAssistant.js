import { Router } from 'express';
import { answerWorkspaceAssistant, logWorkspaceAssistantEvent } from '../services/workspaceAssistantService.js';

const router = Router();

function requireUser(req, res) {
  if (!req.user || req.user.type !== 'user') {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return req.user;
}

router.post('/message', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.json(await answerWorkspaceAssistant(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

router.post('/event', async (req, res, next) => {
  try {
    const user = requireUser(req, res);
    if (!user) return;
    res.status(202).json(await logWorkspaceAssistantEvent(user.userId, req.body || {}));
  } catch (error) {
    next(error);
  }
});

export default router;
