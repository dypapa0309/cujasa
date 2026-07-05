import { Router } from 'express';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateBlogPost } from '../services/blogService.js';
import { requireAdmin } from '../middleware/rateLimit.js';
import { processCoreDueQueue } from '../services/cujasaCoreService.js';

const router = Router();
function requireSchedulerSecret(req, res, next) {
  const expected = process.env.SCHEDULER_SECRET;
  if (!expected) return res.status(503).json({ error: 'SCHEDULER_SECRET is not configured' });
  const headerSecret = req.headers['x-scheduler-secret'];
  const auth = req.headers.authorization || '';
  const bearerSecret = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (headerSecret !== expected && bearerSecret !== expected) {
    return res.status(403).json({ error: 'Invalid scheduler secret' });
  }
  return next();
}

router.post('/daily-pipeline', requireSchedulerSecret, async (req, res, next) => {
  try {
    const mode = String(req.body?.mode || 'scheduled').replace(/[^a-z_-]/gi, '');
    const triggeredBy = String(req.body?.triggeredBy || 'external_scheduler').replace(/[^a-z0-9_-]/gi, '');
    const taskPath = fileURLToPath(new URL('../scripts/runDailyPipelineTask.js', import.meta.url));
    const child = fork(taskPath, [`--mode=${mode}`, `--triggered-by=${triggeredBy}`], {
      detached: true,
      stdio: 'inherit',
      env: process.env
    });
    child.unref();
    res.status(202).json({ ok: true, status: 'accepted', mode, triggeredBy });
  } catch (e) { next(e); }
});

router.post('/run', requireAdmin, async (req, res, next) => {
  try { res.json({ processed: await processCoreDueQueue() }); } catch (e) { next(e); }
});

router.post('/run-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const requestedBy = String(req.user?.email || req.user?.type || 'scheduler').replace(/[^a-z0-9@._-]/gi, '');
    const taskPath = fileURLToPath(new URL('../scripts/runFullPipelineTask.js', import.meta.url));
    const child = fork(taskPath, [`--requested-by=${requestedBy}`], {
      detached: true,
      stdio: 'inherit',
      env: process.env
    });
    child.unref();
    res.status(202).json({
      ok: true,
      status: 'accepted',
      results: [],
      message: '전체 자동화 실행을 시작했습니다. 운영 대시보드에서 진행 상태를 확인해주세요.'
    });
  } catch (e) { next(e); }
});

router.post('/generate-blog/:topicId', requireAdmin, async (req, res, next) => {
  try { res.status(201).json(await generateBlogPost(req.params.topicId)); } catch (e) { next(e); }
});

export default router;
