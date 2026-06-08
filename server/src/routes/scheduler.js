import { Router } from 'express';
import { runFullPipeline } from '../services/pipelineService.js';
import { generateBlogPost } from '../services/blogService.js';
import { requireAdmin } from '../middleware/rateLimit.js';
import { runDailyPipelineOnce } from '../services/schedulerRunService.js';
import { processCoreDueQueue } from '../services/cujasaCoreService.js';
import { runRepetitionGuard } from '../services/repetitionGuardService.js';

const router = Router();
let manualFullPipelineRunning = false;

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
    res.json(await runDailyPipelineOnce({
      triggeredBy: req.body?.triggeredBy || 'external_scheduler',
      mode: req.body?.mode || 'scheduled'
    }));
  } catch (e) { next(e); }
});

router.post('/repetition-guard', requireSchedulerSecret, async (req, res, next) => {
  try {
    res.json(await runRepetitionGuard({
      triggeredBy: req.body?.triggeredBy || 'external_scheduler',
      statuses: req.body?.statuses || 'scheduled,retry,draft',
      days: req.body?.days || 30,
      limit: req.body?.limit || 3000
    }));
  } catch (e) { next(e); }
});

router.post('/run', requireAdmin, async (req, res, next) => {
  try { res.json({ processed: await processCoreDueQueue() }); } catch (e) { next(e); }
});

router.post('/run-pipeline', requireAdmin, async (req, res, next) => {
  try {
    const requestedBy = req.user?.email || req.user?.type || 'scheduler';
    if (manualFullPipelineRunning) {
      return res.status(202).json({
        ok: true,
        status: 'accepted',
        alreadyRunning: true,
        results: [],
        message: '전체 자동화 실행이 이미 진행 중입니다.'
      });
    }
    manualFullPipelineRunning = true;
    setTimeout(() => {
      runFullPipeline({ requestedBy })
        .catch((error) => {
          console.error('[manual full pipeline] failed', error);
        })
        .finally(() => {
          manualFullPipelineRunning = false;
        });
    }, 0);
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
