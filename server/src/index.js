import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import authRouter from './routes/auth.js';
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
import { requireAuth } from './middleware/auth.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { processDueQueue } from './services/schedulerService.js';
import { runDueMetricJobs } from './services/metricsJobService.js';

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = (process.env.CLIENT_BASE_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  }
}));
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(requireAuth);

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'cujasa-server' }));
app.use('/api/auth', authRouter);
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
app.use('/r', trackingRouter);
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
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

cron.schedule('* * * * *', async () => {
  await processDueQueue();
  await runDueMetricJobs();
});

app.listen(port, () => {
  console.log(`CUJASA API running on http://localhost:${port}`);
});
