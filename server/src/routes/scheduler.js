import { Router } from 'express';
import { processDueQueue } from '../services/schedulerService.js';
import { runFullPipeline } from '../services/pipelineService.js';
import { generateBlogPost } from '../services/blogService.js';
import { requireAdmin } from '../middleware/rateLimit.js';

const router = Router();
let manualFullPipelineRunning = false;

router.post('/run', requireAdmin, async (req, res, next) => {
  try { res.json({ processed: await processDueQueue() }); } catch (e) { next(e); }
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
