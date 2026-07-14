import { Router } from 'express';
import { createRateLimit } from '../middleware/rateLimit.js';
import {
  getIssueBySlug,
  getIssueProduct,
  listIssues,
  listTopProducts,
  recordProductClick
} from '../services/issueService.js';
import { hashClientIp } from './issuesPublic.js';

const router = Router();

const SITE_NAME = process.env.ISSUE_SITE_NAME || 'CUJASA 이슈';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

const AFFILIATE_NOTICE = '이 페이지에는 제휴 링크가 포함되어 있으며, 링크를 통해 구매 시 운영자가 일정 수수료를 받을 수 있습니다. 쿠팡 파트너스 활동의 일환으로 수수료를 제공받습니다.';
const BRIEFING_NOTICE = '본 페이지는 공개 뉴스의 제목·출처·링크와 핵심 이슈를 바탕으로 자동 생성된 브리핑입니다. 기사 원문은 각 언론사 링크에서 확인하세요.';

const clickRateLimit = createRateLimit({
  scope: 'issue_site_go',
  windowMs: Number(process.env.TRACKING_RATE_LIMIT_WINDOW_MS || 60_000),
  maxRequests: Number(process.env.TRACKING_RATE_LIMIT_MAX || 120)
});

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return '';
  return `${price.toLocaleString('ko-KR')}원`;
}

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function layout({ title, description, path, body }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description || `${SITE_NAME} — 오늘의 이슈와 관련 상품, 사람들의 반응을 한 곳에서`);
  const canonical = escapeHtml(`${APP_BASE_URL}/site${path}`);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:type" content="website">
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; background: #f6f7f9; color: #1c1c1e; }
    a { color: inherit; text-decoration: none; }
    .nav { background: #fff; border-bottom: 1px solid #e5e5ea; position: sticky; top: 0; z-index: 10; }
    .nav-inner { max-width: 960px; margin: 0 auto; padding: 14px 20px; display: flex; align-items: center; gap: 20px; }
    .nav-logo { font-size: 18px; font-weight: 900; color: #c00000; }
    .nav a.tab { font-size: 14px; font-weight: 600; color: #555; }
    .nav a.tab:hover { color: #c00000; }
    .wrap { max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; }
    .section-title { font-size: 20px; font-weight: 800; margin: 32px 0 14px; }
    .issue-card { display: block; background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; padding: 18px 20px; margin-bottom: 12px; }
    .issue-card:hover { border-color: #c00000; }
    .issue-title { font-size: 17px; font-weight: 700; margin: 0 0 6px; line-height: 1.4; }
    .issue-meta { font-size: 12.5px; color: #8e8e93; }
    .badge { display: inline-block; font-size: 11px; font-weight: 700; color: #c00000; background: #fdecec; border-radius: 6px; padding: 2px 8px; margin-right: 8px; }
    .briefing { background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; padding: 22px; font-size: 15.5px; line-height: 1.7; }
    .notice { font-size: 12px; color: #8e8e93; line-height: 1.6; margin-top: 10px; }
    .sources li { font-size: 14px; margin-bottom: 8px; line-height: 1.5; }
    .sources a { color: #0a66c2; }
    .products { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
    .product { background: #fff; border: 1px solid #e5e5ea; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
    .product img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #f2f2f7; }
    .product .p-body { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .product .p-name { font-size: 13px; line-height: 1.4; height: 2.8em; overflow: hidden; }
    .product .p-price { font-size: 14px; font-weight: 800; color: #c00000; }
    .product .p-rank { font-size: 11px; color: #8e8e93; }
    .comment { background: #fff; border: 1px solid #e5e5ea; border-radius: 10px; padding: 12px 14px; margin-bottom: 8px; }
    .comment .c-nick { font-size: 12.5px; font-weight: 700; color: #555; margin-right: 8px; }
    .comment .c-body { font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
    .comment-form { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .comment-form input, .comment-form textarea { border: 1px solid #d1d1d6; border-radius: 8px; padding: 10px 12px; font-size: 14px; font-family: inherit; }
    .comment-form button { align-self: flex-end; background: #c00000; color: #fff; border: 0; border-radius: 8px; padding: 10px 22px; font-size: 14px; font-weight: 700; cursor: pointer; }
    footer { max-width: 960px; margin: 0 auto; padding: 24px 20px 40px; font-size: 12px; color: #8e8e93; line-height: 1.7; border-top: 1px solid #e5e5ea; }
  </style>
</head>
<body>
  <nav class="nav">
    <div class="nav-inner">
      <a class="nav-logo" href="/site">${escapeHtml(SITE_NAME)}</a>
      <a class="tab" href="/site">이슈</a>
      <a class="tab" href="/site/shop">쇼핑</a>
      <a class="tab" href="/site/rankings">랭킹</a>
    </div>
  </nav>
  <main class="wrap">
${body}
  </main>
  <footer>
    ${escapeHtml(AFFILIATE_NOTICE)}<br>
    ${escapeHtml(BRIEFING_NOTICE)}
  </footer>
</body>
</html>`;
}

function productCard(product) {
  const image = product.product_image
    ? `<img src="${escapeHtml(product.product_image)}" alt="${escapeHtml(product.product_name)}" loading="lazy">`
    : '<div style="aspect-ratio:1;background:#f2f2f7;"></div>';
  return `<a class="product" href="/site/go/${escapeHtml(product.id)}" target="_blank" rel="nofollow sponsored noopener">
    ${image}
    <div class="p-body">
      <div class="p-name">${escapeHtml(product.product_name)}</div>
      <div class="p-price">${escapeHtml(formatPrice(product.product_price))}</div>
      <div class="p-rank">클릭 ${Number(product.click_count) || 0}</div>
    </div>
  </a>`;
}

function issueCard(issue) {
  return `<a class="issue-card" href="/site/issue/${encodeURIComponent(issue.slug)}">
    <h3 class="issue-title"><span class="badge">${escapeHtml(issue.category || '이슈')}</span>${escapeHtml(issue.title)}</h3>
    <div class="issue-meta">출처 ${Number(issue.source_count) || 0}건 · ${escapeHtml(formatDate(issue.published_at))}</div>
  </a>`;
}

router.get('/', async (req, res, next) => {
  try {
    const [issues, products] = await Promise.all([
      listIssues({ limit: 20 }),
      listTopProducts({ limit: 10 })
    ]);
    const body = `
    <h2 class="section-title">오늘의 이슈</h2>
    ${issues.length > 0 ? issues.map(issueCard).join('\n') : '<p class="issue-meta">아직 수집된 이슈가 없습니다. 잠시 후 다시 확인해주세요.</p>'}
    ${products.length > 0 ? `<h2 class="section-title">지금 많이 보는 상품</h2><div class="products">${products.map(productCard).join('\n')}</div><p class="notice">${escapeHtml(AFFILIATE_NOTICE)}</p>` : ''}`;
    res.send(layout({ title: `${SITE_NAME} — 오늘의 이슈와 상품`, path: '/', body }));
  } catch (error) {
    next(error);
  }
});

router.get('/rankings', async (req, res, next) => {
  try {
    const products = await listTopProducts({ limit: 30 });
    const body = `
    <h2 class="section-title">오늘의 클릭 랭킹</h2>
    ${products.length > 0 ? `<div class="products">${products.map(productCard).join('\n')}</div>` : '<p class="issue-meta">아직 랭킹 데이터가 없습니다.</p>'}
    <p class="notice">${escapeHtml(AFFILIATE_NOTICE)}</p>`;
    res.send(layout({ title: `${SITE_NAME} — 랭킹`, path: '/rankings', body }));
  } catch (error) {
    next(error);
  }
});

router.get('/shop', async (req, res, next) => {
  try {
    const products = await listTopProducts({ limit: 50 });
    const byCategory = new Map();
    for (const product of products) {
      const category = product.category_name || '기타';
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(product);
    }
    const sections = [...byCategory.entries()]
      .map(([category, list]) => `<h2 class="section-title">${escapeHtml(category)}</h2><div class="products">${list.map(productCard).join('\n')}</div>`)
      .join('\n');
    const body = `${sections || '<p class="issue-meta">아직 등록된 상품이 없습니다.</p>'}
    <p class="notice">${escapeHtml(AFFILIATE_NOTICE)}</p>`;
    res.send(layout({ title: `${SITE_NAME} — 쇼핑`, path: '/shop', body }));
  } catch (error) {
    next(error);
  }
});

router.get('/issue/:slug', async (req, res, next) => {
  try {
    const detail = await getIssueBySlug(req.params.slug);
    if (!detail) return res.status(404).send(layout({ title: `${SITE_NAME} — 이슈를 찾을 수 없습니다`, path: '/', body: '<p class="issue-meta">이슈를 찾을 수 없습니다.</p>' }));
    const { issue, sources, products, thread, comments } = detail;
    const sourceList = sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener nofollow">${escapeHtml(source.title)}</a> <span class="issue-meta">${escapeHtml(source.publisher || '')}</span></li>`).join('\n');
    const commentList = comments.map((comment) => `<div class="comment"><span class="c-nick">${escapeHtml(comment.nickname)}</span><span class="issue-meta">${escapeHtml(formatDate(comment.created_at))}</span><div class="c-body">${escapeHtml(comment.body)}</div></div>`).join('\n');
    const commentForm = thread ? `
    <form class="comment-form" id="comment-form">
      <input type="text" id="comment-nickname" placeholder="닉네임 (선택)" maxlength="30">
      <textarea id="comment-body" rows="3" placeholder="이 이슈에 대한 생각을 남겨주세요." maxlength="2000" required></textarea>
      <button type="submit">등록</button>
    </form>
    <script>
      document.getElementById('comment-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = document.getElementById('comment-body').value.trim();
        if (body.length < 2) return alert('내용을 입력해주세요.');
        const response = await fetch('/api/public/issues/threads/${escapeHtml(thread.id)}/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: document.getElementById('comment-nickname').value, body })
        });
        if (response.ok) location.reload();
        else alert((await response.json().catch(() => ({}))).error || '등록에 실패했습니다.');
      });
    </script>` : '';
    const body = `
    <h1 class="issue-title" style="font-size:24px;"><span class="badge">${escapeHtml(issue.category || '이슈')}</span>${escapeHtml(issue.title)}</h1>
    <div class="issue-meta" style="margin-bottom:16px;">출처 ${Number(issue.source_count) || 0}건 · ${escapeHtml(formatDate(issue.published_at))}</div>
    <div class="briefing">${escapeHtml(issue.briefing)}</div>
    <p class="notice">${escapeHtml(BRIEFING_NOTICE)}</p>
    <h2 class="section-title">관련 기사 원문</h2>
    <ul class="sources">${sourceList || '<li class="issue-meta">원문 목록이 없습니다.</li>'}</ul>
    ${products.length > 0 ? `<h2 class="section-title">관련 상품</h2><div class="products">${products.map(productCard).join('\n')}</div><p class="notice">${escapeHtml(AFFILIATE_NOTICE)}</p>` : ''}
    <h2 class="section-title">스레드 ${comments.length > 0 ? `(${comments.length})` : ''}</h2>
    ${commentList || '<p class="issue-meta">첫 댓글을 남겨보세요.</p>'}
    ${commentForm}`;
    res.send(layout({ title: `${issue.title} — ${SITE_NAME}`, description: issue.briefing, path: `/issue/${encodeURIComponent(issue.slug)}`, body }));
  } catch (error) {
    next(error);
  }
});

router.get('/go/:productId', clickRateLimit, async (req, res, next) => {
  try {
    const product = await getIssueProduct(req.params.productId);
    if (!product?.partner_url) return res.status(404).send('Not found');
    await recordProductClick(product, { ipHash: hashClientIp(req), userAgent: req.get('user-agent') });
    res.redirect(302, product.partner_url);
  } catch (error) {
    next(error);
  }
});

export default router;
