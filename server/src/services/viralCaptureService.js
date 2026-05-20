import { getJson } from './openaiService.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getAccount } from './accountService.js';
import { dbInsert, dbList, dbUpdate, safeLogActivity, supabase } from './supabaseService.js';
import { searchProductsForTopic } from './coupangService.js';
import { createTrackingLink } from './trackingService.js';
import { uploadPost as uploadThreads } from '../platformAdapters/threadsAdapter.js';
import { evaluateProductTopicMatch } from '../utils/productMatching.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

function normalizeCaptureUrl(rawUrl = '') {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    const error = new Error('인기글 URL을 정확히 입력해주세요.');
    error.status = 400;
    throw error;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const error = new Error('http 또는 https URL만 사용할 수 있어요.');
    error.status = 400;
    throw error;
  }
  return parsed.toString();
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const error = new Error('자동 캡처 엔진이 아직 설치되지 않았어요. 서버에 playwright 설치가 필요합니다.');
    error.status = 501;
    error.code = 'CAPTURE_ENGINE_MISSING';
    throw error;
  }
}

async function captureUrl(url) {
  if (process.env.VIRAL_CAPTURE_USE_BROWSER === 'false') {
    return captureUrlFromMetadata(url);
  }
  let chromium;
  try {
    ({ chromium } = await loadPlaywright());
  } catch (error) {
    await safeLogActivity({
      action: 'viral_capture_engine_unavailable',
      level: 'warn',
      message: error.message || 'Playwright import failed'
    }).catch(() => null);
    return captureUrlFromMetadata(url);
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  } catch (launchError) {
    await safeLogActivity({
      action: 'viral_capture_browser_unavailable',
      level: 'warn',
      message: launchError.message || 'Playwright browser launch failed'
    }).catch(() => null);
    return captureUrlFromMetadata(url);
  }
  try {
    const page = await browser.newPage({
      viewport: { width: 430, height: 900 },
      deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await cleanThreadsCapturePage(page);
    const imageCaptures = await captureThreadsPostImages(page);
    const fallbackClip = imageCaptures.length ? null : await resolveThreadsPostClip(page);
    const fallbackBuffer = imageCaptures.length
      ? null
      : (fallbackClip
        ? await page.screenshot({ type: 'png', clip: fallbackClip, timeout: 15000 })
        : await page.locator('body').screenshot({ type: 'png', timeout: 15000 }));
    const primary = imageCaptures[0] || {
      mimeType: 'image/png',
      base64: fallbackBuffer.toString('base64'),
      clip: fallbackClip,
      kind: 'post_area_fallback'
    };
    return {
      url,
      mimeType: primary.mimeType,
      base64: primary.base64,
      clip: primary.clip,
      kind: primary.kind,
      images: imageCaptures
    };
  } finally {
    await browser.close().catch(() => null);
  }
}

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaContent(html = '', names = []) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) return decodeHtml(match[1]).trim();
    }
  }
  return '';
}

function extractMetaContents(html = '', names = []) {
  const values = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta\\s+[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'gi'),
      new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'gi')
    ];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        if (match?.[1]) values.push(decodeHtml(match[1]).trim());
      }
    }
  }
  return values;
}

function threadsImageIdentity(rawUrl = '') {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.split('/').pop() || parsed.pathname;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function extractThreadsImageUrls(html = '') {
  const normalized = decodeHtml(html).replace(/\\\//g, '/');
  const metaUrls = extractMetaContents(normalized, ['og:image', 'twitter:image']);
  const embeddedUrls = [...normalized.matchAll(/https:\/\/scontent[^"'\\\s<>]+/g)]
    .map((match) => match[0]);
  const seen = new Set();
  return [...metaUrls, ...embeddedUrls]
    .map((item) => String(item || '').trim())
    .filter((item) => /^https:\/\/scontent/i.test(item))
    .filter((item) => /\/t51\.82787-15\//.test(item))
    .filter((item) => /\.(?:jpe?g|webp|png)(?:[?#]|$)/i.test(item))
    .filter((item) => {
      const identity = threadsImageIdentity(item);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .slice(0, 10);
}

async function fetchThreadsMetadata(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JASAINBot/1.0; +https://jasain.kr)',
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!res.ok) {
    const error = new Error(`인기글 페이지를 불러오지 못했어요. (${res.status})`);
    error.status = 502;
    error.code = 'VIRAL_CAPTURE_SOURCE_FETCH_FAILED';
    throw error;
  }
  const html = await res.text();
  const imageUrls = extractThreadsImageUrls(html);
  const imageUrl = imageUrls[0] || '';
  const description = extractMetaContent(html, ['og:description', 'twitter:description', 'description']);
  const title = extractMetaContent(html, ['og:title', 'twitter:title']);
  if (!/^https?:\/\//i.test(imageUrl)) {
    const error = new Error('인기글에서 사용할 이미지를 찾지 못했어요.');
    error.status = 422;
    error.code = 'VIRAL_CAPTURE_IMAGE_NOT_FOUND';
    throw error;
  }
  return { imageUrl, imageUrls, description, title };
}

async function downloadThreadsImageAsCapture({ url, imageUrl, metadata, index }) {
  const imageRes = await fetch(imageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; JASAINBot/1.0; +https://jasain.kr)',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: url
    }
  });
  if (!imageRes.ok) {
    const error = new Error(`인기글 이미지를 내려받지 못했어요. (${imageRes.status})`);
    error.status = 502;
    error.code = 'VIRAL_CAPTURE_IMAGE_FETCH_FAILED';
    throw error;
  }
  const input = Buffer.from(await imageRes.arrayBuffer());
  const output = await sharp(input)
    .rotate()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return {
    url,
    mimeType: 'image/jpeg',
    base64: output.toString('base64'),
    clip: null,
    kind: 'threads_og_image',
    sourceImageUrl: imageUrl,
    sourceText: metadata.description,
    sourceTitle: metadata.title,
    sourceIndex: index
  };
}

async function captureUrlFromMetadata(url) {
  const metadata = await fetchThreadsMetadata(url);
  const captures = [];
  for (const [index, imageUrl] of metadata.imageUrls.entries()) {
    try {
      captures.push(await downloadThreadsImageAsCapture({ url, imageUrl, metadata, index }));
    } catch (error) {
      await safeLogActivity({
        action: 'viral_capture_image_fetch_failed',
        level: 'warn',
        message: error.message || 'Threads image fetch failed',
        payload: { imageUrl, index }
      }).catch(() => null);
    }
  }
  if (!captures.length) {
    const error = new Error('인기글 이미지를 내려받지 못했어요.');
    error.status = 502;
    error.code = 'VIRAL_CAPTURE_IMAGE_FETCH_FAILED';
    throw error;
  }
  const primary = captures[0];
  return {
    url,
    mimeType: primary.mimeType,
    base64: primary.base64,
    clip: primary.clip,
    kind: primary.kind,
    sourceImageUrl: primary.sourceImageUrl,
    sourceText: metadata.description,
    sourceTitle: metadata.title,
    images: captures
  };
}

async function cleanThreadsCapturePage(page) {
  const hasAppPrompt = await page.evaluate(() => {
    const text = String(document.body?.innerText || document.body?.textContent || '');
    return text.includes('Open Threads')
      && (text.includes('Follow @') || text.includes('Conversations are better in the app'));
  }).catch(() => false);
  if (hasAppPrompt) {
    await page.mouse.click(92, 92).catch(() => null);
    await page.waitForTimeout(700).catch(() => null);
  }
  await page.evaluate(() => {
    const phrases = [
      'Open Threads',
      'Conversations are better in the app',
      'By continuing, you agree',
      'Threads Terms of Use',
      'Follow @'
    ];
    const viewportWidth = window.innerWidth || 430;
    const viewportHeight = window.innerHeight || 900;

    for (const node of [...document.querySelectorAll('body *')]) {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const text = String(node.innerText || node.textContent || '');
      const isCookieBanner = style.position === 'fixed'
        && text.includes('By continuing, you agree')
        && rect.width >= viewportWidth * 0.75;
      if (isCookieBanner) node.remove();
    }

    const appPromptCards = [...document.querySelectorAll('body *')]
      .map((node) => {
        const text = String(node.innerText || node.textContent || '');
        const rect = node.getBoundingClientRect();
        return { node, text, rect, area: rect.width * rect.height };
      })
      .filter(({ text, rect }) => text.includes('Open Threads')
        && (text.includes('Follow @') || text.includes('Conversations are better in the app'))
        && rect.width >= viewportWidth * 0.6
        && rect.width <= viewportWidth * 0.95
        && rect.height >= 160
        && rect.height <= viewportHeight * 0.6)
      .sort((a, b) => a.area - b.area);
    appPromptCards[0]?.node.remove();
  }).catch(() => null);
  await page.waitForTimeout(500).catch(() => null);
}

async function resolveThreadsPostClip(page) {
  return page.evaluate(() => {
    const viewportWidth = Math.min(window.innerWidth || 430, 640);
    const related = [...document.querySelectorAll('body *')]
      .find((node) => String(node.innerText || node.textContent || '').trim() === 'Related threads');
    const relatedY = related ? related.getBoundingClientRect().top : 0;
    const top = 100;
    const fallbackBottom = Math.min(window.innerHeight || 900, 720);
    const bottom = relatedY > top + 240 ? Math.min(relatedY, window.innerHeight || relatedY) : fallbackBottom;
    const height = Math.max(260, Math.min(760, bottom - top));
    return {
      x: 0,
      y: top,
      width: viewportWidth,
      height
    };
  }).catch(() => null);
}

async function resolveThreadsImageCandidates(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth || 430;
    const viewportHeight = window.innerHeight || 900;
    const related = [...document.querySelectorAll('body *')]
      .find((node) => String(node.innerText || node.textContent || '').trim() === 'Related threads');
    const relatedTop = related ? related.getBoundingClientRect().top : Number.POSITIVE_INFINITY;

    const candidates = [...document.images]
      .map((img, index) => {
        const rect = img.getBoundingClientRect();
        const style = window.getComputedStyle(img);
        const alt = String(img.getAttribute('alt') || '');
        const src = String(img.currentSrc || img.src || '');
        return {
          index,
          alt,
          src,
          x: Math.max(0, rect.left),
          y: Math.max(0, rect.top),
          width: Math.min(viewportWidth - Math.max(0, rect.left), rect.width),
          height: Math.min(viewportHeight - Math.max(0, rect.top), rect.height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05
        };
      })
      .filter((item) => {
        const area = item.width * item.height;
        const naturalArea = item.naturalWidth * item.naturalHeight;
        if (!item.visible) return false;
        if (!item.src || /^data:image\/svg/i.test(item.src)) return false;
        if (item.y < 70 || item.y > Math.min(relatedTop, viewportHeight) - 24) return false;
        if (item.width < 130 || item.height < 110 || area < 18000) return false;
        if (item.naturalWidth < 180 || item.naturalHeight < 180 || naturalArea < 50000) return false;
        if (/avatar|profile|프로필|logo|icon/i.test(item.alt)) return false;
        return true;
      })
      .sort((a, b) => {
        const topDelta = a.y - b.y;
        if (Math.abs(topDelta) > 24) return topDelta;
        return (b.width * b.height) - (a.width * a.height);
      });

    const firstTop = candidates[0]?.y ?? 0;
    return candidates
      .filter((item) => Math.abs(item.y - firstTop) < 420)
      .slice(0, 4)
      .map((item) => ({
        index: item.index,
        alt: item.alt,
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
        clip: {
          x: Math.floor(item.x),
          y: Math.floor(item.y),
          width: Math.max(1, Math.floor(item.width)),
          height: Math.max(1, Math.floor(item.height))
        }
      }));
  }).catch(() => []);
}

async function captureThreadsPostImages(page) {
  const candidates = await resolveThreadsImageCandidates(page);
  const captures = [];
  for (const candidate of candidates) {
    try {
      const locator = page.locator('img').nth(candidate.index);
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => null);
      const buffer = await locator.screenshot({ type: 'png', timeout: 10000 });
      captures.push({
        mimeType: 'image/png',
        base64: buffer.toString('base64'),
        clip: candidate.clip,
        naturalWidth: candidate.naturalWidth,
        naturalHeight: candidate.naturalHeight,
        alt: candidate.alt,
        kind: 'post_image_crop'
      });
    } catch {
      try {
        const buffer = await page.screenshot({ type: 'png', clip: candidate.clip, timeout: 10000 });
        captures.push({
          mimeType: 'image/png',
          base64: buffer.toString('base64'),
          clip: candidate.clip,
          naturalWidth: candidate.naturalWidth,
          naturalHeight: candidate.naturalHeight,
          alt: candidate.alt,
          kind: 'post_image_clip'
        });
      } catch {
        // Ignore failed candidates; a later image or the post-area fallback can still complete the run.
      }
    }
  }
  return captures;
}

function publicBaseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).split(',')[0].replace(/\/$/, '');
}

async function saveCaptureForThreads(capture, accountId) {
  const buffer = Buffer.from(capture.base64, 'base64');
  const extension = String(capture.mimeType || '').includes('jpeg') ? 'jpg' : 'png';
  const fileName = `${Date.now()}-${randomUUID()}.${extension}`;
  const objectPath = ['viral-captures', accountId, fileName].join('/');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || process.env.AUVIBOT_STORAGE_BUCKET || '';
  if (supabase && bucket) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(objectPath, buffer, {
        contentType: capture.mimeType || 'image/png',
        cacheControl: '86400',
        upsert: true
      });
    if (!error) {
      const configuredPublicBase = process.env.SUPABASE_PUBLIC_ASSET_URL || process.env.AUVIBOT_PUBLIC_BASE_URL || '';
      if (configuredPublicBase) return `${configuredPublicBase.replace(/\/$/, '')}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
      const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
      if (data?.publicUrl) return data.publicUrl;
    }
    await safeLogActivity({
      account_id: accountId,
      action: 'viral_capture_storage_upload_failed',
      level: 'warn',
      message: error?.message || 'Supabase Storage upload failed',
      payload: { bucket, objectPath }
    }).catch(() => null);
  }

  const relativePath = path.join('viral-captures', accountId, fileName);
  const uploadRoot = path.join(process.cwd(), 'public', 'uploads');
  const filePath = path.join(uploadRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return `${publicBaseUrl()}/public/uploads/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

async function saveCapturesForThreads(captures, accountId) {
  const urls = [];
  for (const capture of captures) {
    urls.push(await saveCaptureForThreads(capture, accountId));
  }
  return urls;
}

function fallbackDraft(account, url) {
  const scope = account.content_scope || '일상';
  return {
    body: `${scope} 얘기 보다가 문득 든 생각인데, 결국 오래 쓰는 건 화려한 것보다 손이 자주 가는 쪽이더라.\n\n처음엔 별거 아닌 차이 같아도 매일 반복되면 만족도가 완전히 달라짐.\n\n다들 이런 거 고를 때 제일 먼저 보는 기준 있어?`,
    sourceUrl: url,
    searchKeywords: [scope],
    analysis: {
      hook: '생활 공감형 관찰',
      topic: scope,
      rewriteDirection: '원문 구조를 복제하지 않고 계정 주제에 맞춘 새 공감 글'
    }
  };
}

async function generateDraftFromCapture(account, capture) {
  return getJson([
    {
      role: 'system',
      content: [
        'You create Korean Threads posts from a screenshot of a viral post.',
        'Do not copy the original text or preserve sentence structure.',
        'Infer only the topic, hook, emotion, and engagement mechanism.',
        'Also infer 2-4 concrete Coupang product search keywords that fit the rewritten post.',
        'Return JSON: { "body": string, "searchKeywords": string[], "analysis": { "hook": string, "topic": string, "rewriteDirection": string } }.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            `Account name: ${account.name || ''}`,
            `Handle: ${account.account_handle || ''}`,
            `Target audience: ${account.target_audience || ''}`,
            `Content scope: ${account.content_scope || ''}`,
            `Tone: ${account.tone || account.content_tone || ''}`,
            capture.sourceTitle ? `Source post title: ${capture.sourceTitle}` : '',
            capture.sourceText ? `Source post text: ${capture.sourceText}` : '',
            'Write one original Korean Threads post. Keep it natural, concise, and comment-inducing.',
            'Do not include URLs in the body. The product link will be posted separately.'
          ].filter(Boolean).join('\n')
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${capture.mimeType};base64,${capture.base64}`
          }
        }
      ]
    }
  ], () => fallbackDraft(account, capture.url), {
    schemaName: 'viral_capture_post',
    temperature: 0.8,
    timeoutMs: 60000,
    validate(value) {
      return {
        ok: typeof value?.body === 'string' && value.body.trim().length >= 20,
        reason: 'body is too short'
      };
    }
  });
}

function draftTopicTitle(account, draft) {
  return String(draft?.analysis?.topic || account.content_scope || '인기글 포스팅').trim().slice(0, 80) || '인기글 포스팅';
}

function draftKeywords(account, draft) {
  const values = Array.isArray(draft?.searchKeywords) ? draft.searchKeywords : [];
  const fallback = [
    draft?.analysis?.topic,
    account.content_scope,
    account.target_audience
  ];
  return [...new Set([...values, ...fallback]
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .slice(0, 4);
}

function startOfKoreanDayUtc(date = new Date()) {
  const kst = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return new Date(Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    -9,
    0,
    0,
    0
  )).toISOString();
}

async function assertViralCaptureDailyLimit(accountId) {
  const rows = await dbList('posts', {
    account_id: accountId,
    content_type: 'viral_capture_threads'
  }, {
    gte: { created_at: startOfKoreanDayUtc() },
    select: 'id,status,created_at',
    limit: 1
  });
  if (!rows.length) return;
  const error = new Error('인기글 포스팅 베타는 계정당 하루 1회만 사용할 수 있어요.');
  error.status = 429;
  error.code = 'VIRAL_CAPTURE_DAILY_LIMIT';
  error.limit = 1;
  error.used = 1;
  error.remaining = 0;
  throw error;
}

async function createViralTopic(account, draft) {
  const title = draftTopicTitle(account, draft);
  return dbInsert('topics', {
    account_id: account.id,
    project_id: account.project_id,
    title,
    angle: draft?.analysis?.hook || '인기글 반응 포인트 재해석',
    target_user: account.target_audience || '',
    reason: '인기글 URL 캡처 기반 즉시 포스팅',
    expected_intent: 'threads_engagement_with_coupang_link',
    search_keywords: draftKeywords(account, draft),
    status: 'new'
  });
}

function selectLinkableProduct(products = [], topic, account, body) {
  const candidates = products
    .filter((product) => !product.is_search_status && !product.is_fallback && isRealCoupangProduct(product))
    .map((product) => {
      const match = evaluateProductTopicMatch(product, topic, account, { body });
      return { product, match };
    })
    .filter(({ match }) => match.linkable)
    .sort((a, b) => Number(b.match.score || 0) - Number(a.match.score || 0));
  return candidates[0] || null;
}

async function createViralPostProduct({ post, topic, product, match }) {
  return dbInsert('post_products', {
    post_id: post.id,
    topic_id: topic.id,
    product_id: product.id,
    fit_score: Math.max(60, Math.min(95, Number(match?.score || 75))),
    recommendation_reason: match?.matchReasons?.[0] || `${topic.title}와 연결되는 쿠팡 상품`,
    rank: 1
  });
}

export async function runViralCapturePost({ accountId, url }) {
  const account = await getAccount(accountId);
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const normalizedUrl = normalizeCaptureUrl(url);
  await assertViralCaptureDailyLimit(account.id);
  const capture = await captureUrl(normalizedUrl);
  const capturedImages = Array.isArray(capture.images) && capture.images.length
    ? capture.images
    : [capture];
  const captureImageUrls = await saveCapturesForThreads(capturedImages, account.id);
  const captureImageUrl = captureImageUrls[0] || '';
  const draft = await generateDraftFromCapture(account, capture);
  const body = String(draft.body || '').trim();
  const topic = await createViralTopic(account, draft);
  const products = await searchProductsForTopic(topic.id, {
    keywords: draftKeywords(account, draft),
    keywordLimit: 2,
    stopAfterRealCount: 3
  });
  const selected = selectLinkableProduct(products, topic, account, body);
  if (!selected?.product) {
    const error = new Error('NO_REAL_COUPANG_LINKS: 인기글 내용과 연결할 수 있는 실제 쿠팡 상품 링크를 찾지 못했습니다.');
    error.status = 422;
    error.code = 'NO_REAL_COUPANG_LINKS';
    throw error;
  }
  const post = await dbInsert('posts', {
    project_id: account.project_id,
    account_id: account.id,
    topic_id: topic.id,
    content_type: 'viral_capture_threads',
    body,
    risk_level: 'low',
    status: 'posting',
    metadata: {
      source: 'viral_capture',
      sourceUrl: normalizedUrl,
      captureMimeType: capture.mimeType,
      captureKind: capture.kind || null,
      sourceImageUrl: capture.sourceImageUrl || null,
      sourceTitle: capture.sourceTitle || null,
      sourceText: capture.sourceText || null,
      analysis: draft.analysis || null,
      searchKeywords: draftKeywords(account, draft),
      captureClip: capture.clip || null,
      capturedImageCount: capturedImages.length,
      capturedImages: capturedImages.map((item, index) => ({
        index,
        kind: item.kind || null,
        mimeType: item.mimeType,
        clip: item.clip || null,
        naturalWidth: item.naturalWidth || null,
        naturalHeight: item.naturalHeight || null,
        sourceImageUrl: item.sourceImageUrl || null,
        uploadedImageUrl: captureImageUrls[index] || null,
        selectedForUpload: index < captureImageUrls.length
      })),
      imageAttachment: {
        attachImage: true,
        imageUrl: captureImageUrl,
        imageUrls: captureImageUrls,
        imageSourceType: 'viral_capture',
        imageRisk: 'low'
      },
      visualPlan: {
        attachImage: true,
        imageUrl: captureImageUrl,
        imageUrls: captureImageUrls,
        imageSourceType: 'viral_capture',
        imageRisk: 'low'
      },
      uploadPolicy: 'direct_threads_upload_with_coupang_reply'
    }
  });
  await createViralPostProduct({
    post,
    topic,
    product: selected.product,
    match: selected.match
  });
  const trackingLink = await createTrackingLink({
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: topic.id,
    post_id: post.id,
    product_id: selected.product.id,
    destination_url: selected.product.partner_url || selected.product.product_url,
    link_type: 'coupang'
  });
  let uploaded;
  try {
    uploaded = await uploadThreads({ account, post, trackingLink });
    await dbUpdate('posts', { id: post.id }, {
      status: 'posted',
      metadata: {
        ...(post.metadata || {}),
        selectedProductId: selected.product.id,
        trackingLinkId: trackingLink.id,
        captureImageUrl,
        captureImageUrls,
        postUrl: uploaded.postUrl || null,
        uploadRaw: uploaded.raw || null
      }
    });
  } catch (error) {
    await dbUpdate('posts', { id: post.id }, {
      status: 'manual_required',
      metadata: {
        ...(post.metadata || {}),
        selectedProductId: selected.product.id,
        trackingLinkId: trackingLink.id,
        captureImageUrl,
        captureImageUrls,
        uploadError: error.message
      }
    }).catch(() => null);
    throw error;
  }
  await safeLogActivity({
    project_id: account.project_id,
    account_id: account.id,
    action: 'viral_capture_post_created',
    level: 'info',
    message: '인기글 URL 기반 포스팅을 Threads에 업로드했습니다.',
    payload: {
      sourceUrl: normalizedUrl,
      postId: post.id,
      postUrl: uploaded.postUrl || null,
      productId: selected.product.id,
      trackingLinkId: trackingLink.id,
      analysis: draft.analysis || null
    }
  });
  return {
    ok: true,
    sourceUrl: normalizedUrl,
    capturePreview: `data:${capture.mimeType};base64,${capture.base64}`,
    captureImageUrl,
    captureImageUrls,
    capturedImageCount: captureImageUrls.length,
    captureClip: capture.clip || null,
    postUrl: uploaded.postUrl || null,
    product: {
      id: selected.product.id,
      name: selected.product.product_name,
      partnerUrl: selected.product.partner_url || selected.product.product_url
    },
    post: {
      id: post.id,
      body,
      status: 'posted',
      contentType: post.content_type
    }
  };
}
