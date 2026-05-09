import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import projectsRouter from './routes/projects.js';
import accountsRouter from './routes/accounts.js';
import topicsRouter from './routes/topics.js';
import productsRouter from './routes/products.js';
import postsRouter from './routes/posts.js';
import queueRouter from './routes/queue.js';
import schedulerRouter from './routes/scheduler.js';
import trackingRouter from './routes/tracking.js';
import metricsRouter from './routes/metrics.js';
import analyticsRouter from './routes/analytics.js';
import notificationsRouter from './routes/notifications.js';
import announcementsRouter from './routes/announcements.js';
import blogRouter from './routes/blog.js';
import adminRouter from './routes/admin.js';
import automationStudioRouter from './routes/automationStudio.js';
import inquiriesRouter from './routes/inquiries.js';
import billingRouter, { tossWebhook } from './routes/billing.js';
import publicCheckoutRouter from './routes/publicCheckout.js';
import supportWidgetRouter from './routes/supportWidget.js';
import supportRouter from './routes/support.js';
import productWorkspaceRouter from './routes/productWorkspace.js';
import workspaceAssistantRouter from './routes/workspaceAssistant.js';
import { requireAuth } from './middleware/auth.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { processDueQueue } from './services/schedulerService.js';
import { runDueMetricJobs } from './services/metricsJobService.js';
import { listBlogPosts } from './services/blogService.js';
import { refreshExpiringThreadsTokens } from './services/threadsOAuthService.js';
import { expireDueEntitlements } from './services/billingEntitlementService.js';
import { sendOpsAlert } from './services/notificationService.js';
import { runDailyOpsHealthCheck } from './services/opsHealthService.js';
import { redactSensitivePayload } from './services/redactionService.js';
import { dailyPipelineStatus, runDailyPipelineOnce } from './services/schedulerRunService.js';
import { replyLinkModeStatus } from './utils/replyLinkMode.js';

const app = express();
const port = process.env.PORT || 3000;
const runningCronJobs = new Set();
const allowedOrigins = new Set([
  ...(process.env.CLIENT_BASE_URL || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  'https://jasain.kr',
  'https://www.jasain.kr',
  'https://app.jasain.kr',
  'https://cujasa.jasain.kr',
  'https://dexor.jasain.kr',
  'https://dexor-pearl.vercel.app',
  'https://cujasa.vercel.app',
  'https://cujasa.onrender.com'
]);

function isAllowedOrigin(origin = '') {
  const normalized = origin.replace(/\/$/, '');
  if (!normalized) return true;
  if (allowedOrigins.has(normalized)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?jasain\.kr$/i.test(normalized)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?vercel\.app$/i.test(normalized) && process.env.NODE_ENV !== 'production') return true;
  if (
    process.env.NODE_ENV !== 'production'
    && (/^http:\/\/localhost:\d+$/i.test(normalized) || /^http:\/\/127\.0\.0\.1:\d+$/i.test(normalized))
  ) return true;
  return false;
}

async function runCronJob(name, fn) {
  if (runningCronJobs.has(name)) {
    console.warn(`[Cron:${name}] skipped because previous run is still active`);
    await sendOpsAlert('cron_skipped', {
      title: 'cron 중복 실행 스킵',
      code: 'CRON_ALREADY_RUNNING',
      message: `${name} 작업의 이전 실행이 아직 끝나지 않아 이번 실행을 건너뛰었습니다.`,
      hint: '반복 발생하면 해당 작업 처리 시간과 외부 API 지연을 확인하세요.',
      payload: { cronName: name }
    });
    return null;
  }
  runningCronJobs.add(name);
  const startedAt = Date.now();
  console.log(`[Cron:${name}] started`);
  try {
    const result = await fn();
    console.log(`[Cron:${name}] completed`, JSON.stringify({ durationMs: Date.now() - startedAt, result }));
    return result;
  } catch (error) {
    console.error(`[Cron:${name}] failed`, error);
    await sendOpsAlert('cron_failed', {
      title: 'cron 작업 실패',
      code: 'CRON_FAILED',
      message: `${name}: ${error.message}`,
      hint: '서버 로그와 activity_logs를 확인하세요.',
      payload: { cronName: name }
    });
    return null;
  } finally {
    runningCronJobs.delete(name);
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(securityHeaders);
app.use(express.json({ limit: '20mb' }));
app.use(requireAuth);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'jasain-api', product: 'cujasa' }));
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/accounts', topicsRouter);
app.use('/api/topics', productsRouter);
app.use('/api/topics', postsRouter);
app.use('/api/accounts', postsRouter);
app.use('/api/posts', queueRouter);
app.use('/api/accounts', queueRouter);
app.use('/api/queue', queueRouter);
app.use('/api/scheduler', schedulerRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/accounts', metricsRouter);
app.use('/api/accounts', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/product-workspace', productWorkspaceRouter);
app.use('/api/workspace-assistant', workspaceAssistantRouter);
app.use('/r', trackingRouter);
app.use('/blog', blogRouter);
app.use('/support', supportWidgetRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/automation-studio', automationStudioRouter);
app.use('/api/inquiries', inquiriesRouter);
app.use('/api/billing', billingRouter);
app.use('/api/public/checkout', publicCheckoutRouter);
app.use('/api/support', supportRouter);
app.post('/api/webhooks/toss', tossWebhook);

// sitemap.xml (블로그 글 포함 자동 생성)
app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
    const posts = await listBlogPosts({ limit: 1000 });
    const postUrls = posts.map((p) => `
  <url>
    <loc>${baseUrl}/blog/${p.slug}</loc>
    <lastmod>${new Date(p.published_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/blog</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>${postUrls}
</urlset>`);
  } catch {
    res.status(500).send('sitemap error');
  }
});
app.get('/mock/threads/:postId', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Mock Threads Post</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f7f8fa; color: #17202a; }
          main { max-width: 640px; margin: 64px auto; background: white; border: 1px solid #d8dee6; border-radius: 8px; padding: 24px; }
          .badge { display: inline-block; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; border-radius: 6px; padding: 4px 8px; font-size: 13px; font-weight: 600; }
          code { word-break: break-all; }
        </style>
      </head>
      <body>
        <main>
          <span class="badge">MOCK THREADS</span>
          <h1>업로드 mock 완료</h1>
          <p>실제 Threads에 업로드한 글이 아니라 adapter 테스트용 URL입니다.</p>
          <p>post id: <code>${req.params.postId}</code></p>
        </main>
      </body>
    </html>
  `);
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  const hideInternalErrors = process.env.ERROR_DETAIL_MODE === 'internal' || process.env.NODE_ENV === 'production';
  const exposeDetail = status < 500 || !hideInternalErrors;
  console.error('[request_error]', redactSensitivePayload({
    path: req.path,
    method: req.method,
    status,
    message: error.message,
    code: error.code,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  }));
  res.status(status).json({
    error: exposeDetail ? (error.message || 'Internal server error') : 'Internal server error',
    ...(error.code ? { code: error.code } : {}),
    ...(error.preflight ? { preflight: error.preflight } : {}),
    ...(error.limit != null ? { limit: error.limit } : {}),
    ...(error.used != null ? { used: error.used } : {}),
    ...(error.remaining != null ? { remaining: error.remaining } : {}),
    ...(error.upgradeRequired != null ? { upgradeRequired: error.upgradeRequired } : {})
  });
});

// 매분: 예약된 포스팅 업로드 + 성과 측정
cron.schedule('* * * * *', async () => {
  await runCronJob('queue-and-metrics', async () => {
    const processedQueue = await processDueQueue();
    const metricJobs = await runDueMetricJobs();
    return { processedQueue, metricJobs };
  });
});

// 매일 새벽 2시: 전체 파이프라인 자동 실행 (주제→상품→콘텐츠→큐 등록)
cron.schedule('0 2 * * *', async () => {
  await runCronJob('daily-pipeline', async () => {
    return runDailyPipelineOnce({ triggeredBy: 'node_cron' });
  });
}, { timezone: 'Asia/Seoul' });

// 매일 새벽 3시: Threads long-lived token 만료 전 갱신
cron.schedule('0 3 * * *', async () => {
  await runCronJob('threads-token-refresh', async () => refreshExpiringThreadsTokens());
});

// 매시간: 월결제 만료 고객 자동 차단
cron.schedule('17 * * * *', async () => {
  await runCronJob('billing-expire', async () => {
    const expired = await expireDueEntitlements();
    return { expiredCount: expired.length };
  });
});

// 매일 오전 8시(KST): 운영 위험 상태 요약 알림
cron.schedule('0 8 * * *', async () => {
  await runCronJob('daily-ops-healthcheck', async () => runDailyOpsHealthCheck());
}, { timezone: 'Asia/Seoul' });

async function runStartupDailyPipelineCatchUp() {
  const status = await dailyPipelineStatus();
  if (!status.missing) return null;
  return runCronJob('daily-pipeline-startup-catch-up', async () => runDailyPipelineOnce({
    triggeredBy: 'startup_catch_up',
    runDateKst: status.runDateKst
  }));
}

app.listen(port, () => {
  console.log(`JASAIN API running on http://localhost:${port}`);
  console.log('[threads reply link mode]', JSON.stringify(replyLinkModeStatus()));
  setTimeout(() => {
    runStartupDailyPipelineCatchUp().catch((error) => {
      console.error('[startup daily-pipeline catch-up] failed', error);
    });
  }, 3000);
});
