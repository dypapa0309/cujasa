import { createHash } from 'node:crypto';
import { dbGet, dbInsert, dbList, dbUpdate, safeLogActivity } from './supabaseService.js';
import { getJson } from './openaiService.js';
import { searchKeyword } from './coupangService.js';
import { parseRssItems } from '../utils/rssParser.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_FEEDS = [
  // Google News KR aggregate feeds: headline/link/publisher only.
  'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=ko&gl=KR&ceid=KR:ko',
  'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=ko&gl=KR&ceid=KR:ko'
];

const config = () => ({
  feeds: String(process.env.ISSUE_NEWS_FEEDS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean)
    .concat(process.env.ISSUE_NEWS_FEEDS ? [] : DEFAULT_FEEDS)
    .slice(0, 12),
  minSources: Math.max(1, Number(process.env.ISSUE_MIN_SOURCES || 2)),
  maxIssuesPerRun: Math.max(1, Number(process.env.ISSUE_MAX_PER_RUN || 8)),
  productSearchLimit: Math.max(0, Number(process.env.ISSUE_PRODUCT_SEARCH_LIMIT || 5)),
  productSearchIntervalMs: Math.max(0, Number(process.env.ISSUE_PRODUCT_SEARCH_INTERVAL_MS || 15_000)),
  productsPerIssue: Math.min(10, Math.max(1, Number(process.env.ISSUE_PRODUCTS_PER_ISSUE || 10))),
  feedFetchTimeoutMs: Math.max(1000, Number(process.env.ISSUE_FEED_FETCH_TIMEOUT_MS || 10_000)),
  dedupeWindowHours: Math.max(1, Number(process.env.ISSUE_DEDUPE_WINDOW_HOURS || 48))
});

// ---------------------------------------------------------------------------
// Keyword extraction / clustering (rule-based, no LLM cost)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  '속보', '단독', '영상', '포토', '종합', '전문', '오늘', '내일', '어제', '기자', '뉴스',
  '발표', '공개', '확인', '이유', '논란', '입장', '반응', '현장', '결과', '진행', '예정',
  '위해', '통해', '대해', '관련', '이번', '지난', '올해', '내년', '작년', '함께', '모든',
  '것으로', '한다', '했다', '된다', '됐다', '있다', '없다', '무슨', '어떤', '가장', '최초',
  '최대', '최소', '명이', '명의', '것은', '것이', '까지', '부터', '보다', '해도', '해서'
]);

const PARTICLE_SUFFIXES = ['은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '와', '과', '만', '요', '고', '며'];

function stripParticle(token) {
  if (token.length < 3) return token;
  const last = token[token.length - 1];
  if (PARTICLE_SUFFIXES.includes(last)) return token.slice(0, -1);
  return token;
}

export function extractKeywords(title = '') {
  const cleaned = String(title)
    .replace(/\[[^\]]*\]|\([^)]*\)|「[^」]*」|<[^>]*>/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣\s]/g, ' ');
  const tokens = cleaned
    .split(/\s+/)
    .map((token) => stripParticle(token.trim()))
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
  return [...new Set(tokens)];
}

function sharedCount(a, b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

export function clusterNewsItems(items = [], { minShared = 2 } = {}) {
  const clusters = [];
  for (const item of items) {
    const keywords = new Set(extractKeywords(item.title));
    if (keywords.size === 0) continue;
    let best = null;
    let bestShared = 0;
    for (const cluster of clusters) {
      const shared = sharedCount(keywords, cluster.keywordSet);
      const jaccard = shared / (keywords.size + cluster.keywordSet.size - shared || 1);
      if ((shared >= minShared || jaccard >= 0.4) && shared > bestShared) {
        best = cluster;
        bestShared = shared;
      }
    }
    if (best) {
      best.items.push(item);
      for (const token of keywords) best.keywordCounts.set(token, (best.keywordCounts.get(token) || 0) + 1);
      best.keywordSet = new Set(best.keywordCounts.keys());
    } else {
      clusters.push({
        items: [item],
        keywordCounts: new Map([...keywords].map((token) => [token, 1])),
        keywordSet: keywords
      });
    }
  }
  return clusters.map((cluster) => ({
    items: cluster.items,
    keywords: [...cluster.keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token)
      .slice(0, 8)
  }));
}

// ---------------------------------------------------------------------------
// Category + shopping keyword rules (LLM-free first pass)
// ---------------------------------------------------------------------------

const PRODUCT_RULES = [
  { pattern: /폭염|무더위|열대야|온열|불볕/, category: '생활', keywords: ['휴대용 선풍기', '냉감 매트', '써큘레이터'] },
  { pattern: /장마|폭우|호우|태풍|침수|습도/, category: '생활', keywords: ['제습기', '장우산', '방수팩'] },
  { pattern: /한파|폭설|추위|영하/, category: '생활', keywords: ['전기요', '핫팩', '히터'] },
  { pattern: /미세먼지|황사|대기질/, category: '건강', keywords: ['공기청정기', 'KF94 마스크', '공기청정기 필터'] },
  { pattern: /독감|감기|바이러스|백신|유행/, category: '건강', keywords: ['마스크', '손소독제', '비타민'] },
  { pattern: /다이어트|운동|헬스|건강관리/, category: '건강', keywords: ['단백질 보충제', '요가매트', '체중계'] },
  { pattern: /전기요금|가스요금|난방비|냉방비|절약|물가|장바구니/, category: '생활', keywords: ['절전 멀티탭', 'LED 전구', '단열 커튼'] },
  { pattern: /캠핑|차박|글램핑/, category: '레저', keywords: ['캠핑 의자', '아이스박스', '캠핑 랜턴'] },
  { pattern: /휴가|여행|피서|연휴|항공/, category: '레저', keywords: ['여행용 캐리어', '목베개', '여행용 파우치'] },
  { pattern: /출산|육아|보육|어린이집|유아/, category: '육아', keywords: ['기저귀', '분유', '아기 물티슈'] },
  { pattern: /반려동물|반려견|반려묘|강아지|고양이/, category: '반려동물', keywords: ['강아지 사료', '고양이 모래', '펫 장난감'] },
  { pattern: /스마트폰|갤럭시|아이폰|노트북|가전|출시/, category: 'IT', keywords: ['보조배터리', '무선 이어폰', '스마트폰 케이스'] },
  { pattern: /게임|콘솔|플레이스테이션|닌텐도/, category: 'IT', keywords: ['게이밍 마우스', '게이밍 헤드셋'] },
  { pattern: /요리|레시피|식품|급식|먹거리/, category: '식품', keywords: ['에어프라이어', '밀키트', '주방용품'] },
  { pattern: /수능|입시|개학|개강|학교/, category: '생활', keywords: ['스탠드 조명', '노트', '타이머'] },
  { pattern: /이사|부동산|전세|월세|청약/, category: '생활', keywords: ['수납장', '이사용 박스', '공구세트'] }
];

export function matchProductRule(keywords = []) {
  const joined = keywords.join(' ');
  for (const rule of PRODUCT_RULES) {
    if (rule.pattern.test(joined)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Briefing generation (one cheap LLM call per cluster, rule-based fallback)
// ---------------------------------------------------------------------------

export function buildFallbackBriefing(cluster) {
  const publishers = [...new Set(cluster.items.map((item) => item.publisher).filter(Boolean))];
  const keywordText = cluster.keywords.slice(0, 4).join(', ');
  const publisherText = publishers.length > 0 ? `${publishers.slice(0, 3).join(', ')} 등 ${publishers.length}개 매체` : '여러 매체';
  return `${keywordText} 관련 보도가 ${publisherText}에서 이어지고 있습니다. 자세한 내용은 아래 원문 기사에서 확인하세요.`;
}

function fallbackTitle(cluster) {
  return cluster.items[0]?.title || cluster.keywords.slice(0, 3).join(' ');
}

async function generateBriefing(cluster) {
  const fallback = () => ({
    title: fallbackTitle(cluster),
    briefing: buildFallbackBriefing(cluster),
    category: matchProductRule(cluster.keywords)?.category || '사회',
    product_keywords: matchProductRule(cluster.keywords)?.keywords || [cluster.keywords[0]].filter(Boolean)
  });
  const headlines = cluster.items.slice(0, 12)
    .map((item) => `- ${item.title}${item.publisher ? ` (${item.publisher})` : ''}`)
    .join('\n');
  const result = await getJson([
    {
      role: 'system',
      content: [
        '너는 뉴스 이슈 브리핑 에디터다. 아래 헤드라인 묶음을 보고 JSON으로만 답한다.',
        '규칙: briefing은 2~3문장, 원문 기사를 대체하지 않는 짧은 요약. 과장/추측 금지.',
        'category는 [생활, 경제, 사회, IT, 건강, 육아, 레저, 식품, 반려동물] 중 하나.',
        'product_keywords는 이 이슈를 본 사람이 지금 필요로 할 만한 쿠팡 검색어 1~3개 (한국어, 구체적인 상품명 위주).',
        '형식: {"title": string, "briefing": string, "category": string, "product_keywords": string[]}'
      ].join('\n')
    },
    { role: 'user', content: `이슈 키워드: ${cluster.keywords.join(', ')}\n헤드라인:\n${headlines}` }
  ], fallback, {
    temperature: 0.3,
    schemaName: 'issue_briefing',
    validate: (value) => Boolean(value?.title && value?.briefing && Array.isArray(value?.product_keywords))
  });
  return {
    title: String(result.title || fallbackTitle(cluster)).slice(0, 200),
    briefing: String(result.briefing || buildFallbackBriefing(cluster)).slice(0, 1000),
    category: String(result.category || '사회').slice(0, 20),
    productKeywords: (Array.isArray(result.product_keywords) ? result.product_keywords : [])
      .map((keyword) => String(keyword || '').trim())
      .filter(Boolean)
      .slice(0, 3)
  };
}

// ---------------------------------------------------------------------------
// Slug / dedupe helpers
// ---------------------------------------------------------------------------

export function slugifyIssue(keywords = [], date = new Date()) {
  const day = date.toISOString().slice(0, 10).replaceAll('-', '');
  const base = keywords.slice(0, 3)
    .map((keyword) => String(keyword).toLowerCase().replace(/[^0-9a-z가-힣]/g, ''))
    .filter(Boolean)
    .join('-');
  const hash = createHash('sha1').update(keywords.join('|') + day).digest('hex').slice(0, 6);
  return [day, base || 'issue', hash].join('-');
}

export function keywordSignatureOverlap(a = [], b = []) {
  const setB = new Set(b);
  const shared = a.filter((token) => setB.has(token)).length;
  return shared / Math.max(1, Math.min(a.length, b.length));
}

// ---------------------------------------------------------------------------
// Feed collection
// ---------------------------------------------------------------------------

async function fetchFeed(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'cujasa-issue-pipeline/1.0', Accept: 'application/rss+xml, application/xml, text/xml' }
    });
    if (!response.ok) throw new Error(`feed ${response.status}`);
    return parseRssItems(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

export async function collectNewsItems({ feeds, timeoutMs } = {}) {
  const cfg = config();
  const targetFeeds = feeds || cfg.feeds;
  const results = await Promise.allSettled(
    targetFeeds.map((url) => fetchFeed(url, timeoutMs || cfg.feedFetchTimeoutMs))
  );
  const seen = new Set();
  const items = [];
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') {
      console.warn('[issue_pipeline] feed failed:', targetFeeds[index], result.reason?.message);
      return;
    }
    for (const item of result.value) {
      const key = item.link;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  });
  return items;
}

// ---------------------------------------------------------------------------
// Product attachment
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attachProducts(issue, productKeywords, cfg) {
  const keyword = productKeywords[0];
  if (!keyword) return 0;
  const products = (await searchKeyword(keyword, cfg.productsPerIssue))
    .filter((product) => !product.is_fallback && product.product_url && product.partner_url);
  let rank = 0;
  for (const product of products) {
    rank += 1;
    await dbInsert('issue_products', {
      issue_id: issue.id,
      keyword,
      product_id: product.product_id,
      product_name: product.product_name,
      product_price: Number(product.product_price) || null,
      product_image: product.product_image || null,
      product_url: product.product_url,
      partner_url: product.partner_url,
      category_name: product.category_name || null,
      rank
    });
  }
  return products.length;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runIssuePipeline(options = {}) {
  const cfg = { ...config(), ...options };
  const startedAt = Date.now();
  const summary = { collected: 0, clusters: 0, createdIssues: 0, mergedIssues: 0, productsAttached: 0, errors: [] };

  const items = await collectNewsItems(cfg);
  summary.collected = items.length;
  if (items.length === 0) return summary;

  // Drop URLs we already ingested.
  const knownUrls = new Set();
  const windowStart = new Date(Date.now() - cfg.dedupeWindowHours * 3600_000).toISOString();
  const recentSources = await dbList('issue_sources', {}, { gte: { created_at: windowStart }, limit: 2000 }).catch(() => []);
  for (const source of recentSources) knownUrls.add(source.url);
  const freshItems = items.filter((item) => !knownUrls.has(item.link));

  const clusters = clusterNewsItems(freshItems)
    .filter((cluster) => cluster.items.length >= cfg.minSources)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, cfg.maxIssuesPerRun);
  summary.clusters = clusters.length;

  const recentIssues = await dbList('issues', {}, { gte: { created_at: windowStart }, limit: 200 }).catch(() => []);
  let searchedCount = 0;

  for (const cluster of clusters) {
    try {
      // Merge into an existing recent issue when keyword signatures overlap.
      const existing = recentIssues.find((issue) => keywordSignatureOverlap(cluster.keywords, issue.keywords || []) >= 0.6);
      if (existing) {
        for (const item of cluster.items) {
          await dbInsert('issue_sources', {
            issue_id: existing.id,
            publisher: item.publisher,
            title: item.title,
            url: item.link,
            published_at: item.publishedAt
          }).catch(() => null); // unique(url) violations are expected noise
        }
        const total = await dbList('issue_sources', { issue_id: existing.id }, { limit: 500 }).catch(() => []);
        await dbUpdate('issues', { id: existing.id }, { source_count: total.length, score: total.length });
        summary.mergedIssues += 1;
        continue;
      }

      const briefing = await generateBriefing(cluster);
      const slug = slugifyIssue(cluster.keywords);
      const issue = await dbInsert('issues', {
        slug,
        title: briefing.title,
        briefing: briefing.briefing,
        keywords: cluster.keywords,
        category: briefing.category,
        source_count: cluster.items.length,
        product_keyword: briefing.productKeywords[0] || null,
        score: cluster.items.length,
        status: 'published',
        published_at: new Date().toISOString()
      });
      recentIssues.push(issue);

      for (const item of cluster.items) {
        await dbInsert('issue_sources', {
          issue_id: issue.id,
          publisher: item.publisher,
          title: item.title,
          url: item.link,
          published_at: item.publishedAt
        }).catch(() => null);
      }

      await dbInsert('issue_threads', {
        issue_id: issue.id,
        title: `[토론] ${briefing.title}`,
        body: `${briefing.briefing}\n\n이 이슈에 대한 생각을 남겨주세요.`,
        auto_generated: true
      }).catch(() => null);

      summary.createdIssues += 1;

      if (searchedCount < cfg.productSearchLimit) {
        if (searchedCount > 0 && cfg.productSearchIntervalMs > 0) await sleep(cfg.productSearchIntervalMs);
        summary.productsAttached += await attachProducts(issue, briefing.productKeywords, cfg);
        searchedCount += 1;
      }
    } catch (error) {
      summary.errors.push({ keywords: cluster.keywords.slice(0, 3), message: error.message });
      console.warn('[issue_pipeline] cluster failed:', error.message);
    }
  }

  await safeLogActivity({
    action: 'issue_pipeline_completed',
    level: summary.errors.length > 0 ? 'warn' : 'info',
    message: `이슈 파이프라인 완료: 신규 ${summary.createdIssues}건, 병합 ${summary.mergedIssues}건, 상품 ${summary.productsAttached}건`,
    payload: { ...summary, durationMs: Date.now() - startedAt }
  });
  return summary;
}

// ---------------------------------------------------------------------------
// Read APIs (public site)
// ---------------------------------------------------------------------------

export async function listIssues({ limit = 20, category = null } = {}) {
  const filters = { status: 'published' };
  if (category) filters.category = category;
  return dbList('issues', filters, { order: 'published_at', ascending: false, limit: Math.min(50, limit) });
}

export async function getIssueBySlug(slug) {
  const issue = await dbGet('issues', { slug, status: 'published' });
  if (!issue) return null;
  const [sources, products, threads] = await Promise.all([
    dbList('issue_sources', { issue_id: issue.id }, { order: 'published_at', ascending: false, limit: 30 }),
    dbList('issue_products', { issue_id: issue.id }, { order: 'rank', ascending: true, limit: 10 }),
    dbList('issue_threads', { issue_id: issue.id }, { order: 'created_at', ascending: true, limit: 5 })
  ]);
  const thread = threads[0] || null;
  const comments = thread
    ? await dbList('issue_thread_comments', { thread_id: thread.id }, { order: 'created_at', ascending: false, limit: 50 })
    : [];
  return { issue, sources, products, thread, comments };
}

export async function listTopProducts({ limit = 20 } = {}) {
  const products = await dbList('issue_products', {}, { order: 'click_count', ascending: false, limit: Math.min(50, limit) });
  return products.filter((product) => product.partner_url);
}

export async function getIssueProduct(productId) {
  return dbGet('issue_products', { id: productId });
}

export async function recordProductClick(product, { ipHash = null, userAgent = null } = {}) {
  await dbInsert('issue_clicks', {
    issue_id: product.issue_id,
    issue_product_id: product.id,
    ip_hash: ipHash,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null
  }).catch(() => null);
  await dbUpdate('issue_products', { id: product.id }, { click_count: (Number(product.click_count) || 0) + 1 }).catch(() => null);
}

export async function addThreadComment(threadId, { nickname, body, ipHash = null }) {
  const thread = await dbGet('issue_threads', { id: threadId });
  if (!thread) {
    const error = new Error('Thread not found');
    error.status = 404;
    throw error;
  }
  const cleanBody = String(body || '').trim().slice(0, 2000);
  if (cleanBody.length < 2) {
    const error = new Error('내용을 입력해주세요.');
    error.status = 400;
    throw error;
  }
  const comment = await dbInsert('issue_thread_comments', {
    thread_id: threadId,
    nickname: String(nickname || '익명').trim().slice(0, 30) || '익명',
    body: cleanBody,
    ip_hash: ipHash
  });
  await dbUpdate('issue_threads', { id: threadId }, { comment_count: (Number(thread.comment_count) || 0) + 1 }).catch(() => null);
  return comment;
}
