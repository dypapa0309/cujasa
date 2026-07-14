import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './routes/auth.js';
import meRouter from './routes/me.js';
import projectsRouter from './routes/projects.js';
import accountsRouter from './routes/accounts.js';
import topicsRouter from './routes/topics.js';
import productsRouter from './routes/products.js';
import postsRouter from './routes/posts.js';
import queueRouter from './routes/queue.js';
import schedulerRouter from './routes/scheduler.js';
import coreRouter from './routes/core.js';
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
import leadFormsRouter from './routes/leadForms.js';
import supportWidgetRouter from './routes/supportWidget.js';
import supportRouter from './routes/support.js';
import productWorkspaceRouter from './routes/productWorkspace.js';
import workspaceAssistantRouter from './routes/workspaceAssistant.js';
import issuesPublicRouter from './routes/issuesPublic.js';
import issueSiteRouter from './routes/issueSite.js';
import { requireAuth } from './middleware/auth.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { listAccountBlogPosts, listBlogPosts } from './services/blogService.js';
import { redactSensitivePayload } from './services/redactionService.js';
import { replyLinkModeStatus } from './utils/replyLinkMode.js';
import { getPublicLeadForm } from './services/automationStudioService.js';
import { loadSystemSettingsIntoEnv } from './services/systemSettingsService.js';
import { dbList } from './services/supabaseService.js';

const app = express();
const port = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enableInternalCron = process.env.ENABLE_INTERNAL_CRON !== 'false';
const allowedOrigins = new Set([
  ...(process.env.CLIENT_BASE_URL || '').split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  'https://jasain.kr',
  'https://www.jasain.kr',
  'https://store.jasain.kr',
  'https://app.jasain.kr',
  'https://cujasa.jasain.kr',
  'https://dexor.jasain.kr',
  'https://dexor-pearl.vercel.app',
  'https://cujasa.vercel.app',
  'https://cujasa.onrender.com',
  'https://polibot-jasain.web.app',
  'https://polibot-jasain.firebaseapp.com'
]);
const BLOG_CANONICAL_HOST = 'blog.jasain.kr';

function xmlEscape(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function requestHost(req) {
  return String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().split(':')[0].toLowerCase();
}

function isCanonicalBlogHost(req) {
  return requestHost(req) === BLOG_CANONICAL_HOST;
}

function publicBaseUrl(req) {
  return isCanonicalBlogHost(req)
    ? `https://${BLOG_CANONICAL_HOST}`
    : (process.env.APP_BASE_URL || `http://localhost:${port}`);
}

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

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-CUJASA-Device-Id',
    'X-CUJASA-Device-Type',
    'X-CUJASA-Device-Fingerprint',
    'X-POLIBOT-Device-Id',
    'X-POLIBOT-Device-Type',
    'X-POLIBOT-Device-Fingerprint'
  ],
  credentials: true,
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(securityHeaders);
app.use(express.json({ limit: '20mb' }));
app.use('/public/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads'), {
  maxAge: '1d',
  immutable: true
}));
app.use(requireAuth);

app.get('/api/health', (req, res) => res.json({
  ok: true,
  service: 'jasain-api',
  product: 'cujasa',
  commit: process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || null,
  environment: process.env.NODE_ENV || 'development',
  checkedAt: new Date().toISOString()
}));
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
app.use('/api/core', coreRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/accounts', metricsRouter);
app.use('/api/accounts', analyticsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/announcements', announcementsRouter);
app.use('/api/product-workspace', productWorkspaceRouter);
app.use('/api/workspace-assistant', workspaceAssistantRouter);
app.use('/r', trackingRouter);
app.use((req, res, next) => {
  if (!isCanonicalBlogHost(req)) return next();
  if (req.path.startsWith('/api/') || ['/robots.txt', '/sitemap.xml'].includes(req.path)) return next();
  return blogRouter(req, res, next);
});
app.use('/blog', blogRouter);
app.use('/support', supportWidgetRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/automation-studio', automationStudioRouter);
app.use('/api/inquiries', inquiriesRouter);
app.use('/api/billing', billingRouter);
app.use('/api/public/checkout', publicCheckoutRouter);
app.use('/api/public/lead-forms', leadFormsRouter);
app.use('/api/public/issues', issuesPublicRouter);
app.use('/site', issueSiteRouter);
app.use('/api/support', supportRouter);
app.post('/api/webhooks/toss', tossWebhook);

app.get('/robots.txt', (req, res) => {
  const baseUrl = publicBaseUrl(req);
  res.type('text/plain').send([
    'User-agent: *',
    `Allow: ${isCanonicalBlogHost(req) ? '/' : '/blog'}`,
    'Disallow: /api/',
    'Disallow: /admin',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ].join('\n'));
});

// sitemap.xml (블로그 글 포함 자동 생성)
app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = publicBaseUrl(req);
    const posts = isCanonicalBlogHost(req) ? [] : await listBlogPosts({ limit: 1000 });
    const postUrls = posts.map((p) => `
  <url>
    <loc>${xmlEscape(`${baseUrl}/blog/${encodeURIComponent(p.slug)}`)}</loc>
    <lastmod>${new Date(p.published_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join('');
    const accountBlogs = await dbList('accounts', { blog_enabled: true, status: 'active' }, {
      select: 'id,blog_slug,blog_created_at,updated_at'
    });
    const accountBlogUrls = [];
    const visibleAccountBlogs = accountBlogs
      .filter((row) => row.blog_slug);
    for (const account of visibleAccountBlogs) {
      const blogUrl = isCanonicalBlogHost(req)
        ? (account.blog_slug === 'jasain-cujasa-lab' ? baseUrl : `${baseUrl}/a/${encodeURIComponent(account.blog_slug)}`)
        : `${baseUrl}/blog/a/${encodeURIComponent(account.blog_slug)}`;
      if (blogUrl !== baseUrl || !isCanonicalBlogHost(req)) {
        accountBlogUrls.push(`
  <url>
    <loc>${xmlEscape(blogUrl)}</loc>
    <lastmod>${new Date(account.updated_at || account.blog_created_at || Date.now()).toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`);
      }
      const { posts: accountPosts } = await listAccountBlogPosts(account.blog_slug, { limit: 1000 });
      accountBlogUrls.push(...accountPosts.map((p) => `
  <url>
    <loc>${xmlEscape(`${blogUrl}/${encodeURIComponent(p.slug)}`)}</loc>
    <lastmod>${new Date(p.updated_at || p.published_at).toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`));
    }
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${xmlEscape(isCanonicalBlogHost(req) ? baseUrl : `${baseUrl}/blog`)}</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>${postUrls}${accountBlogUrls.join('')}
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

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/lead-forms/:slug', async (req, res, next) => {
  try {
    const form = await getPublicLeadForm(req.params.slug);
    const fields = form.fields.map((field) => {
      const label = escapeHtml(form.fieldLabels[field] || field);
      return `<label><span>${label}</span><input name="${escapeHtml(field)}" ${['name', 'phone', 'email'].includes(field) ? 'required' : ''} /></label>`;
    }).join('');
    res.type('html').send(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(form.title || 'JASAIN 신청')}</title>
  <style>
    body { margin: 0; background: #0f0f10; color: #111827; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 520px; margin: 56px auto; background: #fff; border-radius: 24px; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.25); }
    .eyebrow { color: #64748b; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-size: 28px; line-height: 1.2; }
    p { color: #475569; line-height: 1.7; }
    form { display: grid; gap: 14px; margin-top: 24px; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 800; color: #334155; }
    input { border: 1px solid #dbe3ef; border-radius: 12px; padding: 13px 14px; font-size: 15px; outline: none; }
    input:focus { border-color: #111827; }
    .consent { display: flex; gap: 10px; align-items: flex-start; font-size: 12px; font-weight: 700; color: #64748b; line-height: 1.5; }
    .consent input { margin-top: 2px; }
    button { border: 0; border-radius: 14px; background: #111827; color: white; padding: 14px 16px; font-size: 15px; font-weight: 900; cursor: pointer; }
    .message { min-height: 20px; color: #047857; font-size: 13px; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">JASAIN Lead Form</div>
    <h1>${escapeHtml(form.title || form.productName || '도입 안내 신청')}</h1>
    <p>${escapeHtml(form.offer || '신청 정보를 남겨주시면 확인 후 안내드릴게요.')}</p>
    <form id="lead-form">
      ${fields}
      <label class="consent"><input type="checkbox" name="privacyAccepted" required /> <span>${escapeHtml(form.privacyNote || '개인정보 수집 및 이용에 동의합니다.')}</span></label>
      <button>신청하기</button>
      <div class="message" id="message"></div>
    </form>
  </main>
  <script>
    document.getElementById('lead-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.privacyAccepted = Boolean(payload.privacyAccepted);
      payload.sourceUrl = window.location.href;
      const message = document.getElementById('message');
      message.textContent = '제출 중입니다...';
      const response = await fetch('/api/public/lead-forms/${escapeHtml(req.params.slug)}/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.style.color = '#be123c';
        message.textContent = data.error || '제출에 실패했습니다.';
        return;
      }
      form.reset();
      message.style.color = '#047857';
      message.textContent = data.message || '${escapeHtml(form.thankYouMessage || '신청이 접수되었습니다.')}';
    });
  </script>
</body>
</html>`);
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  const status = error.status || 500;
  const hideInternalErrors = process.env.ERROR_DETAIL_MODE === 'internal' || process.env.NODE_ENV === 'production';
  const exposeDetail = status < 500
    || !hideInternalErrors
    || error.code === 'SUPABASE_UNAVAILABLE'
    || String(error.code || '').startsWith('CAPTURE_')
    || String(error.code || '').startsWith('VIRAL_CAPTURE_');
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

let schedulerWorker = null;

function startSchedulerWorker() {
  if (!enableInternalCron || schedulerWorker) return;
  const workerPath = fileURLToPath(new URL('./scripts/runInternalSchedulerWorker.js', import.meta.url));
  schedulerWorker = fork(workerPath, [], { stdio: 'inherit', env: process.env });
  schedulerWorker.once('exit', (code, signal) => {
    console.error(`[Worker] internal scheduler exited code=${code} signal=${signal || 'none'}`);
    schedulerWorker = null;
    setTimeout(startSchedulerWorker, 5000);
  });
}

await loadSystemSettingsIntoEnv().catch((error) => {
  console.warn('[system settings] failed to load persisted settings', error?.message || error);
});

app.listen(port, () => {
  console.log(`JASAIN API running on http://localhost:${port}`);
  console.log('[threads reply link mode]', JSON.stringify(replyLinkModeStatus()));
  startSchedulerWorker();
});
