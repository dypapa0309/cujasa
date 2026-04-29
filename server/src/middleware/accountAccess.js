import { dbGet } from '../services/supabaseService.js';

export function canAccessAccount(req, accountId) {
  return req.user?.type !== 'user' || req.user.allowedAccountIds.includes(accountId);
}

export function requireAccountAccessParam(paramName = 'accountId') {
  return (req, res, next) => {
    const accountId = req.params[paramName];
    if (!accountId) return res.status(400).json({ error: `${paramName} is required` });
    if (!canAccessAccount(req, accountId)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

export async function requireTopicAccess(req, res, next) {
  try {
    if (req.user?.type !== 'user') return next();
    const topic = await dbGet('topics', { id: req.params.topicId });
    if (!topic || !canAccessAccount(req, topic.account_id)) return res.status(403).json({ error: 'Access denied' });
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireQueueAccess(req, res, next) {
  try {
    if (req.user?.type !== 'user') return next();
    const queue = await dbGet('post_queue', { id: req.params.queueId });
    if (!queue || !canAccessAccount(req, queue.account_id)) return res.status(403).json({ error: 'Access denied' });
    req.queue = queue;
    next();
  } catch (error) {
    next(error);
  }
}
