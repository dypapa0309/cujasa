import { Router } from 'express';
import { generateBlogPost, getBlogPost, listBlogPosts } from '../services/blogService.js';

const router = Router();

const LANDING_URL = process.env.LANDING_URL || 'https://jasain.kr';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const BLOG_IMAGE_URL = process.env.BLOG_IMAGE_URL || `${LANDING_URL}/images/products.png`;
const BLOG_AUTHOR = 'CUJASA';

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function seoJson(data) {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}

function cujasaBanner() {
  return `
  <div style="margin:48px 0 0;padding:32px;background:linear-gradient(135deg,#1e1e2e,#2d1a1a);border-radius:16px;color:#fff;text-align:center;">
    <div style="font-size:11px;font-weight:700;color:#ff6b6b;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">이 블로그는 CUJASA로 자동 운영됩니다</div>
    <h3 style="font-size:22px;font-weight:900;margin:0 0 10px;line-height:1.3;">쿠팡 파트너스, 직접 쓰고 올리고 계신가요?</h3>
    <p style="font-size:15px;color:#ccc;margin:0 0 24px;line-height:1.6;">AI가 주제 선정부터 상품 검색, 글 작성, Threads 업로드까지<br>전부 자동으로 해드립니다. 지금 신청하세요.</p>
    <a href="${LANDING_URL}#purchase-form" target="_blank"
      style="display:inline-block;background:#C00000;color:#fff;font-weight:900;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">
      지금 신청하기 (일시불 ₩590,000 / 월 ₩59,000) →
    </a>
    <div style="font-size:12px;color:#888;margin-top:12px;">베이직 플랜: Threads 계정 2개까지 운영</div>
  </div>`;
}

function blogLayout({ title, metaDescription, canonical, body, ogType = 'article', publishedAt, modifiedAt, structuredData }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(metaDescription);
  const safeCanonical = escapeHtml(canonical);
  const safeImage = escapeHtml(BLOG_IMAGE_URL);
  const jsonLd = structuredData ? seoJson(structuredData) : null;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:alt" content="CUJASA 쿠팡 파트너스 자동화">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:site_name" content="CUJASA 블로그">
  ${publishedAt ? `<meta property="article:published_time" content="${escapeHtml(new Date(publishedAt).toISOString())}">` : ''}
  ${modifiedAt ? `<meta property="article:modified_time" content="${escapeHtml(new Date(modifiedAt).toISOString())}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">
  ${jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : ''}
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Noto Sans KR',Apple SD Gothic Neo,sans-serif;background:#f8f9fa;color:#1a1a1a;line-height:1.8;font-size:16px}
    a{color:#C00000;text-decoration:none}
    a:hover{text-decoration:underline}
    .nav{background:#fff;border-bottom:1px solid #eee;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
    .nav-logo{font-weight:900;font-size:18px;color:#C00000}
    .nav-link{font-size:13px;color:#666;font-weight:500}
    .container{max-width:760px;margin:0 auto;padding:40px 24px 80px}
    .post-header{margin-bottom:32px}
    .post-meta{font-size:13px;color:#888;margin-bottom:12px}
    .post-title{font-size:28px;font-weight:900;line-height:1.3;color:#111;margin-bottom:16px}
    .post-body h2{font-size:22px;font-weight:800;margin:36px 0 14px;color:#111;padding-bottom:8px;border-bottom:2px solid #f0f0f0}
    .post-body h3{font-size:18px;font-weight:700;margin:28px 0 10px;color:#222}
    .post-body p{margin-bottom:16px;color:#333}
    .post-body ul,.post-body ol{margin:12px 0 16px 24px}
    .post-body li{margin-bottom:8px;color:#333}
    .post-body strong{color:#111;font-weight:700}
    .post-body a{color:#C00000;font-weight:600;border-bottom:1px solid #fcc}
    .post-body a:hover{border-bottom-color:#C00000}
    .card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;margin:24px 0}
    .post-card{background:#fff;border:1px solid #eee;border-radius:12px;padding:20px;transition:box-shadow .2s}
    .post-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08)}
    .post-card-date{font-size:12px;color:#aaa;margin-bottom:6px}
    .post-card-title{font-size:16px;font-weight:700;color:#111;line-height:1.4}
    .post-card-desc{font-size:13px;color:#666;margin-top:8px;line-height:1.5}
    .breadcrumb{font-size:13px;color:#aaa;margin-bottom:20px}
    .breadcrumb a{color:#aaa}
    .tag{display:inline-block;background:#fff0f0;color:#C00000;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;margin-bottom:16px}
    @media(max-width:600px){.post-title{font-size:22px}.container{padding:24px 16px 60px}}
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet">
</head>
<body>
  <nav class="nav">
    <a href="${APP_BASE_URL}/blog" class="nav-logo">CUJASA 블로그</a>
    <a href="${LANDING_URL}" class="nav-link" target="_blank">자동화 프로그램 →</a>
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`;
}

// 블로그 목록
router.get('/', async (req, res, next) => {
  try {
    const posts = await listBlogPosts({ limit: 20 });
    const cards = posts.map((p) => `
      <a href="${APP_BASE_URL}/blog/${escapeHtml(p.slug)}" style="text-decoration:none">
        <div class="post-card">
          <div class="post-card-date">${formatDate(p.published_at)}</div>
          <div class="post-card-title">${escapeHtml(p.title)}</div>
          <div class="post-card-desc">${escapeHtml(p.meta_description || '')}</div>
        </div>
      </a>`).join('');

    const body = `
      <div style="margin-bottom:32px">
        <h1 style="font-size:26px;font-weight:900;margin-bottom:8px">쿠팡 파트너스 블로그</h1>
        <p style="color:#666;font-size:15px">AI가 자동으로 작성하는 쿠팡 파트너스 꿀팁 & 상품 추천</p>
      </div>
      ${posts.length ? `<div class="card-grid">${cards}</div>` : '<p style="color:#aaa">아직 게시된 글이 없습니다.</p>'}
      ${cujasaBanner()}`;

    const canonical = `${APP_BASE_URL}/blog`;
    res.type('html').send(blogLayout({
      title: 'CUJASA 블로그 — 쿠팡 파트너스 꿀팁 & 상품 추천',
      metaDescription: '쿠팡 파트너스 수익화 꿀팁, 추천 상품 정보를 AI가 자동으로 작성합니다.',
      canonical,
      ogType: 'website',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'CUJASA 블로그',
        description: '쿠팡 파트너스 수익화 꿀팁, 추천 상품 정보를 AI가 자동으로 작성합니다.',
        url: canonical,
        image: BLOG_IMAGE_URL,
        publisher: {
          '@type': 'Organization',
          name: BLOG_AUTHOR,
          url: LANDING_URL
        }
      },
      body
    }));
  } catch (e) { next(e); }
});

// 블로그 글 상세
router.get('/:slug', async (req, res, next) => {
  try {
    const post = await getBlogPost(req.params.slug);
    if (!post) return res.status(404).type('html').send('<h1>글을 찾을 수 없습니다</h1>');

    const canonical = `${APP_BASE_URL}/blog/${post.slug}`;
    const title = `${post.title} | CUJASA 블로그`;
    const metaDescription = post.meta_description || stripHtml(post.content).slice(0, 150);
    const body = `
      <div class="breadcrumb"><a href="${APP_BASE_URL}/blog">블로그</a> / ${escapeHtml(post.title)}</div>
      <div class="post-header">
        <div class="tag">쿠팡 파트너스</div>
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">${formatDate(post.published_at)}</div>
      </div>
      <div class="post-body">${post.content}</div>
      ${cujasaBanner()}`;

    res.type('html').send(blogLayout({
      title,
      metaDescription,
      canonical,
      publishedAt: post.published_at,
      modifiedAt: post.updated_at || post.published_at,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: metaDescription,
        image: BLOG_IMAGE_URL,
        datePublished: new Date(post.published_at).toISOString(),
        dateModified: new Date(post.updated_at || post.published_at).toISOString(),
        author: {
          '@type': 'Organization',
          name: BLOG_AUTHOR,
          url: LANDING_URL
        },
        publisher: {
          '@type': 'Organization',
          name: BLOG_AUTHOR,
          url: LANDING_URL
        },
        mainEntityOfPage: {
          '@type': 'WebPage',
          '@id': canonical
        }
      },
      body
    }));
  } catch (e) { next(e); }
});


export default router;
