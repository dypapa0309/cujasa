import { Router } from 'express';
import { generateBlogPost, getAccountBlogPost, getBlogPost, listAccountBlogPosts, listBlogPosts } from '../services/blogService.js';

const router = Router();

const rawLandingUrl = process.env.LANDING_URL || 'https://jasain.kr/cujasa';
const LANDING_URL = /landing-phi-flame\.vercel\.app/i.test(rawLandingUrl)
  ? 'https://jasain.kr/cujasa'
  : rawLandingUrl;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const BLOG_IMAGE_URL = process.env.BLOG_IMAGE_URL || 'https://jasain.kr/images/products.png';
const BLOG_AUTHOR = 'CUJASA';
const BLOG_CANONICAL_HOST = 'blog.jasain.kr';
const DEFAULT_ACCOUNT_BLOG_SLUG = 'jasain-cujasa-lab';
const NAVER_SITE_VERIFICATION = 'aed88b20e103365b174eea083db5c019997d8e6c';
const GOOGLE_SITE_VERIFICATION = 'm86b1pmlHCpiA_K9v0qSjs54ip7RyvZQ7IpVBEAjtXI';
const DEFAULT_BLOG_KEYWORDS = [
  '쿠팡 파트너스 자동화',
  '쿠팡 파트너스 부업',
  'CUJASA',
  '자사인',
  '추천 콘텐츠 자동화'
];

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

function normalizeKeywords(value = []) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set([...source, ...DEFAULT_BLOG_KEYWORDS]
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .slice(0, 12);
}

function requestHost(req) {
  return String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().split(':')[0].toLowerCase();
}

function isCanonicalBlogHost(req) {
  return requestHost(req) === BLOG_CANONICAL_HOST;
}

function baseUrlForRequest(req) {
  return isCanonicalBlogHost(req) ? `https://${BLOG_CANONICAL_HOST}` : APP_BASE_URL;
}

function accountBlogHref(req, account) {
  const baseUrl = baseUrlForRequest(req);
  if (isCanonicalBlogHost(req) && account?.blog_slug === DEFAULT_ACCOUNT_BLOG_SLUG) return baseUrl;
  return `${baseUrl}/blog/a/${encodeURIComponent(account.blog_slug)}`;
}

function cujasaBanner() {
  return `
  <div style="margin:48px 0 0;padding:32px;background:linear-gradient(135deg,#1e1e2e,#2d1a1a);border-radius:16px;color:#fff;text-align:center;">
    <div style="font-size:11px;font-weight:700;color:#ff6b6b;letter-spacing:2px;text-transform:uppercase;margin-bottom:12px;">이 블로그는 CUJASA로 자동 운영됩니다</div>
    <h3 style="font-size:22px;font-weight:900;margin:0 0 10px;line-height:1.3;">쿠팡 파트너스, 직접 쓰고 올리고 계신가요?</h3>
    <p style="font-size:15px;color:#ccc;margin:0 0 24px;line-height:1.6;">AI가 주제 선정부터 상품 검색, 글 작성, Threads 업로드까지<br>전부 자동으로 해드립니다. 지금 신청하세요.</p>
    <a href="${LANDING_URL}#purchase-form" target="_blank"
      style="display:inline-block;background:#C00000;color:#fff;font-weight:900;font-size:15px;padding:14px 36px;border-radius:10px;text-decoration:none;">
      지금 신청하기 (일시불 ₩590,000 / 월 ₩129,000) →
    </a>
    <div style="font-size:12px;color:#888;margin-top:12px;">베이직 플랜: Threads 계정 2개까지 운영</div>
  </div>`;
}

function blogLayout({
  title,
  metaDescription,
  canonical,
  body,
  ogType = 'article',
  publishedAt,
  modifiedAt,
  structuredData,
  siteName = 'CUJASA 블로그',
  homeHref = `${APP_BASE_URL}/blog`,
  navCta = '자동화 프로그램 →',
  keywords = DEFAULT_BLOG_KEYWORDS,
  imageUrl = BLOG_IMAGE_URL
}) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(metaDescription);
  const safeCanonical = escapeHtml(canonical);
  const safeImage = escapeHtml(imageUrl || BLOG_IMAGE_URL);
  const safeKeywords = escapeHtml(normalizeKeywords(keywords).join(', '));
  const articleTags = normalizeKeywords(keywords)
    .map((keyword) => `<meta property="article:tag" content="${escapeHtml(keyword)}">`)
    .join('\n  ');
  const jsonLd = structuredData ? seoJson(structuredData) : null;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="keywords" content="${safeKeywords}">
  <meta name="author" content="${escapeHtml(BLOG_AUTHOR)}">
  <meta name="naver-site-verification" content="${NAVER_SITE_VERIFICATION}">
  <meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:alt" content="CUJASA 쿠팡 파트너스 자동화">
  <meta property="og:locale" content="ko_KR">
  <meta property="og:site_name" content="${escapeHtml(siteName)}">
  ${publishedAt ? `<meta property="article:published_time" content="${escapeHtml(new Date(publishedAt).toISOString())}">` : ''}
  ${modifiedAt ? `<meta property="article:modified_time" content="${escapeHtml(new Date(modifiedAt).toISOString())}">` : ''}
  ${ogType === 'article' ? articleTags : ''}
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
    <a href="${escapeHtml(homeHref)}" class="nav-logo">${escapeHtml(siteName)}</a>
    <a href="${LANDING_URL}" class="nav-link" target="_blank">${escapeHtml(navCta)}</a>
  </nav>
  <div class="container">
    ${body}
  </div>
</body>
</html>`;
}

function accountBlogTitle(account) {
  return account?.blog_title || `${account?.name || 'JASAIN'} 블로그`;
}

// 블로그 목록
router.get('/', async (req, res, next) => {
  try {
    if (isCanonicalBlogHost(req)) {
      const { account, posts } = await listAccountBlogPosts(DEFAULT_ACCOUNT_BLOG_SLUG, { limit: 20 });
      if (!account) return res.status(404).type('html').send('<h1>블로그를 찾을 수 없습니다</h1>');
      return sendAccountBlogIndex(req, res, account, posts);
    }

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
      keywords: ['쿠팡 파트너스 블로그', '쿠팡 파트너스 자동화', 'CUJASA', '자사인'],
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'Blog',
        name: 'CUJASA 블로그',
        description: '쿠팡 파트너스 수익화 꿀팁, 추천 상품 정보를 AI가 자동으로 작성합니다.',
        url: canonical,
        image: BLOG_IMAGE_URL,
        keywords: normalizeKeywords(['쿠팡 파트너스 블로그', '쿠팡 파트너스 자동화']),
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

function sendAccountBlogIndex(req, res, account, posts) {
  const blogTitle = accountBlogTitle(account);
  const homeHref = accountBlogHref(req, account);
  const cards = posts.map((p) => `
      <a href="${homeHref}/${escapeHtml(p.slug)}" style="text-decoration:none">
        <div class="post-card">
          <div class="post-card-date">${formatDate(p.published_at)}</div>
          <div class="post-card-title">${escapeHtml(p.title)}</div>
          <div class="post-card-desc">${escapeHtml(p.meta_description || '')}</div>
        </div>
      </a>`).join('');

  const body = `
      <div style="margin-bottom:32px">
        <h1 style="font-size:26px;font-weight:900;margin-bottom:8px">${escapeHtml(blogTitle)}</h1>
        <p style="color:#666;font-size:15px">${escapeHtml(account.content_scope || '자동으로 정리되는 추천 콘텐츠')}</p>
      </div>
      ${posts.length ? `<div class="card-grid">${cards}</div>` : '<p style="color:#aaa">아직 게시된 글이 없습니다.</p>'}
      ${cujasaBanner()}`;

  const canonical = homeHref;
  return res.type('html').send(blogLayout({
    title: `${blogTitle} | 쿠팡 파트너스 자동화 콘텐츠`,
    metaDescription: `${blogTitle}에서 쿠팡 파트너스 자동화, 추천 콘텐츠 운영, CUJASA 활용법을 확인하세요.`,
    canonical,
    ogType: 'website',
    siteName: blogTitle,
    homeHref,
    keywords: [blogTitle, account.content_scope, '쿠팡 파트너스 자동화', 'CUJASA', '자사인 블로그'],
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: blogTitle,
      description: `${blogTitle}에서 쿠팡 파트너스 자동화와 추천 콘텐츠 운영법을 다룹니다.`,
      url: canonical,
      image: BLOG_IMAGE_URL,
      keywords: normalizeKeywords([blogTitle, account.content_scope, '추천 콘텐츠 운영']),
      publisher: {
        '@type': 'Organization',
        name: BLOG_AUTHOR,
        url: LANDING_URL
      }
    },
    body
  }));
}

// 계정별 블로그 목록
router.get('/a/:blogSlug', async (req, res, next) => {
  try {
    const { account, posts } = await listAccountBlogPosts(req.params.blogSlug, { limit: 20 });
    if (!account) return res.status(404).type('html').send('<h1>블로그를 찾을 수 없습니다</h1>');
    return sendAccountBlogIndex(req, res, account, posts);
  } catch (e) { next(e); }
});

// 계정별 블로그 글 상세
router.get('/a/:blogSlug/:postSlug', async (req, res, next) => {
  try {
    const { account, post } = await getAccountBlogPost(req.params.blogSlug, req.params.postSlug);
    if (!account || !post) return res.status(404).type('html').send('<h1>글을 찾을 수 없습니다</h1>');

    const blogTitle = accountBlogTitle(account);
    const homeHref = accountBlogHref(req, account);
    const canonical = `${homeHref}/${encodeURIComponent(post.slug)}`;
    const title = `${post.title} | ${blogTitle}`;
    const metaDescription = post.meta_description || stripHtml(post.content).slice(0, 150);
    const keywords = normalizeKeywords([...(post.seo_keywords || []), ...(post.tags || []), account.content_scope]);
    const imageUrl = post.cover_image_url || BLOG_IMAGE_URL;
    const body = `
      <div class="breadcrumb"><a href="${homeHref}">블로그</a> / ${escapeHtml(post.title)}</div>
      <div class="post-header">
        <div class="tag">추천 콘텐츠</div>
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">${formatDate(post.published_at)}</div>
      </div>
      <div class="post-body">${post.content}</div>
      ${cujasaBanner()}`;

    res.type('html').send(blogLayout({
      title,
      metaDescription,
      canonical,
      siteName: blogTitle,
      homeHref,
      keywords,
      imageUrl,
      publishedAt: post.published_at,
      modifiedAt: post.updated_at || post.published_at,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: metaDescription,
        image: imageUrl,
        keywords,
        datePublished: new Date(post.published_at).toISOString(),
        dateModified: new Date(post.updated_at || post.published_at).toISOString(),
        author: {
          '@type': 'Organization',
          name: blogTitle,
          url: homeHref
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

// 블로그 글 상세
router.get('/:slug', async (req, res, next) => {
  try {
    if (isCanonicalBlogHost(req)) {
      const { account, post } = await getAccountBlogPost(DEFAULT_ACCOUNT_BLOG_SLUG, req.params.slug);
      if (!account || !post) return res.status(404).type('html').send('<h1>글을 찾을 수 없습니다</h1>');

      const blogTitle = accountBlogTitle(account);
      const homeHref = accountBlogHref(req, account);
      const canonical = `${homeHref}/${encodeURIComponent(post.slug)}`;
      const title = `${post.title} | ${blogTitle}`;
      const metaDescription = post.meta_description || stripHtml(post.content).slice(0, 150);
      const keywords = normalizeKeywords([...(post.seo_keywords || []), ...(post.tags || []), account.content_scope]);
      const imageUrl = post.cover_image_url || BLOG_IMAGE_URL;
      const body = `
      <div class="breadcrumb"><a href="${homeHref}">블로그</a> / ${escapeHtml(post.title)}</div>
      <div class="post-header">
        <div class="tag">추천 콘텐츠</div>
        <h1 class="post-title">${escapeHtml(post.title)}</h1>
        <div class="post-meta">${formatDate(post.published_at)}</div>
      </div>
      <div class="post-body">${post.content}</div>
      ${cujasaBanner()}`;

      return res.type('html').send(blogLayout({
        title,
        metaDescription,
        canonical,
        siteName: blogTitle,
        homeHref,
        keywords,
        imageUrl,
        publishedAt: post.published_at,
        modifiedAt: post.updated_at || post.published_at,
        structuredData: {
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: post.title,
          description: metaDescription,
          image: imageUrl,
          keywords,
          datePublished: new Date(post.published_at).toISOString(),
          dateModified: new Date(post.updated_at || post.published_at).toISOString(),
          author: {
            '@type': 'Organization',
            name: blogTitle,
            url: homeHref
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
    }

    const post = await getBlogPost(req.params.slug);
    if (!post) return res.status(404).type('html').send('<h1>글을 찾을 수 없습니다</h1>');

    const canonical = `${APP_BASE_URL}/blog/${post.slug}`;
    const title = `${post.title} | CUJASA 블로그`;
    const metaDescription = post.meta_description || stripHtml(post.content).slice(0, 150);
    const keywords = normalizeKeywords([...(post.seo_keywords || []), ...(post.tags || [])]);
    const imageUrl = post.cover_image_url || BLOG_IMAGE_URL;
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
      keywords,
      imageUrl,
      publishedAt: post.published_at,
      modifiedAt: post.updated_at || post.published_at,
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: metaDescription,
        image: imageUrl,
        keywords,
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
