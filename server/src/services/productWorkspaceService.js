import { PRODUCTS, productById } from '../config/products.js';
import AdmZip from 'adm-zip';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { productServiceClosedInProduction } from '../utils/productAvailability.js';
import {
  buildPolibotCatalog,
  buildPolibotCatalogItems,
  inferPolibotFileType,
  normalizePolibotKnowledgeItems,
  polibotSeedKnowledgeSources,
  rankPolibotEvidence
} from './polibotKnowledgeService.js';
import {
  getPolibotDbKnowledgeSummary,
  ingestPolibotKnowledge,
  listPolibotDbKnowledgeSources,
  searchPolibotCodeCandidates
} from './polibotKnowledgeDbService.js';

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread', 'polibot', 'infludex', 'auvibot', 'sublog']);
const DEFAULT_USAGE_LIMIT = 5;
const UNLIMITED_TEST_EMAILS = new Set(['test1@test.com']);
const UNLIMITED_USAGE_LIMIT = 999999;
const DEXOR_SCORE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const INFLUDEX_GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const DEXOR_CATEGORIES = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];

const EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY = {
  totalSources: 0,
  globalSources: 0,
  userSources: 0,
  importedSources: 0,
  statusCounts: {},
  sourceChannelCounts: {},
  recommendableSources: 0,
  reviewNeededSources: 0,
  excludedSources: 0,
  ocrNeededSources: 0,
  privacyRiskSources: 0,
  conflictSources: 0,
  highQualitySources: 0,
  mediumQualitySources: 0,
  lowQualitySources: 0,
  catalogItems: 0,
  importedCatalogItems: 0,
  recommendableCatalogItems: 0,
  reviewNeededCatalogItems: 0,
  excludedCatalogItems: 0,
  conflictCatalogItems: 0,
  chunks: 0,
  recommendableChunks: 0,
  conversationInsights: 0,
  latestMonth: '',
  companies: [],
  productGroups: [],
  latestJob: null
};

function now() {
  return new Date().toISOString();
}

function hashText(text = '') {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dexorScoreLabel(score) {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function dexorScoreComment(score) {
  if (score >= 90) return '최우선으로 볼 만한 후보예요.';
  if (score >= 80) return '우선 선정 후보에 가까워요.';
  if (score >= 70) return '조건을 확인하며 검토할 후보예요.';
  if (score >= 60) return '보조 후보로 보는 편이 좋아요.';
  return '제외하거나 다시 검토하는 편이 좋아요.';
}

function infludexGradeFromScore(score) {
  if (score >= 85) return 'S';
  if (score >= 72) return 'A';
  if (score >= 58) return 'B';
  if (score >= 42) return 'C';
  return 'D';
}

function scoreRange(value, ranges = []) {
  for (const [threshold, score] of ranges) {
    if (value >= threshold) return score;
  }
  return 0;
}

function analyzeInfludexCandidate(candidate = {}) {
  const followers = Math.max(0, Number(candidate.followerCount || 0));
  const likes = Math.max(0, Number(candidate.avgLikes || 0));
  const comments = Math.max(0, Number(candidate.avgComments || 0));
  const hasScoringData = followers > 0 && (likes > 0 || comments > 0);
  const engagementRate = followers > 0 ? ((likes + comments) / followers) * 100 : 0;
  const commentShare = likes + comments > 0 ? (comments / (likes + comments)) * 100 : 0;
  const recentTime = candidate.recentPostAt ? new Date(String(candidate.recentPostAt).replace(/[./]/g, '-')).getTime() : 0;
  const daysSinceRecent = recentTime ? Math.floor((Date.now() - recentTime) / (24 * 60 * 60 * 1000)) : null;
  const hasAdRisk = Boolean(candidate.adMemo);
  const riskFlags = [
    !candidate.category ? 'category_missing' : '',
    !followers ? 'followers_missing' : '',
    engagementRate <= 0 ? 'engagement_missing' : '',
    daysSinceRecent === null ? 'recent_post_missing' : '',
    daysSinceRecent !== null && daysSinceRecent > 60 ? 'inactive_over_60d' : '',
    hasAdRisk ? 'ad_memo_present' : ''
  ].filter(Boolean);

  if (!hasScoringData) {
    return {
      followers,
      likes,
      comments,
      engagementRate: 0,
      commentShare: 0,
      daysSinceRecent,
      score: null,
      grade: null,
      analysisStatus: 'data_missing',
      scoreBreakdown: {},
      gradeReason: [
        candidate.category ? `추정 카테고리 ${candidate.category}` : '카테고리 보강 필요',
        !followers ? '팔로워 수 필요' : `팔로워 ${followers.toLocaleString('ko-KR')}`,
        likes + comments <= 0 ? '좋아요/댓글 평균 필요' : '반응 지표 확인됨',
        daysSinceRecent === null ? '최근 게시일 필요' : daysSinceRecent <= 30 ? '최근 활동 양호' : '최근 활동 확인 필요'
      ],
      riskFlags
    };
  }

  const categoryFitScore = candidate.category ? 20 : 0;
  const engagementScore = scoreRange(engagementRate, [[6, 30], [3.5, 25], [2, 20], [1, 13], [0.5, 7]]);
  const commentScore = scoreRange(commentShare, [[8, 15], [5, 12], [2, 8], [0.5, 4]]);
  const followerScore = scoreRange(followers, [[100000, 15], [30000, 13], [10000, 10], [3000, 7], [1000, 4]]);
  const freshnessScore = daysSinceRecent === null ? 0 : daysSinceRecent <= 10 ? 10 : daysSinceRecent <= 30 ? 7 : daysSinceRecent <= 60 ? 3 : 0;
  const adPenalty = hasAdRisk ? 10 : 0;
  const score = Math.max(0, Math.min(100, Math.round(categoryFitScore + engagementScore + commentScore + followerScore + freshnessScore - adPenalty)));
  const grade = infludexGradeFromScore(score);
  const gradeReason = [
    categoryFitScore ? `카테고리 ${candidate.category}` : '카테고리 미입력',
    followers ? `팔로워 ${followers.toLocaleString('ko-KR')}` : '팔로워 미입력',
    engagementRate ? `반응률 ${engagementRate.toFixed(2)}%` : '반응 지표 미입력',
    commentShare ? `댓글 비중 ${commentShare.toFixed(1)}%` : '댓글 지표 미입력',
    daysSinceRecent === null ? '최근 게시일 미입력' : daysSinceRecent <= 30 ? '최근 활동 양호' : '최근 활동 확인 필요',
    hasAdRisk ? '광고/협찬 메모 감점' : '광고성 메모 없음'
  ];

  return {
    followers,
    likes,
    comments,
    engagementRate: Number(engagementRate.toFixed(2)),
    commentShare: Number(commentShare.toFixed(1)),
    daysSinceRecent,
    score,
    grade,
    analysisStatus: 'scored',
    scoreBreakdown: {
      categoryFitScore,
      engagementScore,
      commentScore,
      followerScore,
      freshnessScore,
      adPenalty
    },
    gradeReason,
    riskFlags
  };
}

function parseUrls(input = '') {
  return String(input)
    .split(/[\s,\n\r]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 500);
}

function splitCandidateLine(line = '') {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const char of String(line)) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if ((char === ',' || char === '\t') && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseNumberLike(value = '') {
  const number = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
}

function normalizeDexorCategory(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return DEXOR_CATEGORIES.find((category) => text.includes(category) || category.includes(text)) || text;
}

function deriveBlogNameFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || '').trim());
    if (/blog\.naver\.com$/i.test(parsed.hostname)) {
      const blogId = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return blogId ? `네이버:${blogId}` : '';
    }
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const firstPath = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return firstPath ? `${hostname}/${firstPath}` : hostname;
  } catch {
    return '';
  }
}

function parseCandidateRows(input = '', fileName = '') {
  const rows = String(input || '')
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];
  rows.forEach((line, index) => {
    const cells = splitCandidateLine(line);
    const joined = cells.join(' ');
    if (index === 0 && /url|주소|블로그|blog/i.test(joined) && !/^https?:\/\//i.test(cells[0] || '')) return;
    const url = cells.find((cell) => /^https?:\/\//i.test(cell)) || '';
    if (!url) return;
    const metaCells = cells.filter((cell) => cell !== url);
    const recentPostAt = metaCells.find((cell) => /\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cell)) || '';
    const numbers = metaCells.map(parseNumberLike).filter((value) => value !== null);
    const categoryCell = metaCells.find((cell) => DEXOR_CATEGORIES.some((category) => String(cell || '').includes(category))) || '';
    const blogName = metaCells.find((cell) => cell && cell !== recentPostAt && cell !== categoryCell && parseNumberLike(cell) === null && !/광고|협찬|체험단|스폰서/i.test(cell)) || deriveBlogNameFromUrl(url);
    const adMemo = metaCells.find((cell) => /광고|협찬|체험단|스폰서|상업/i.test(cell)) || '';
    candidates.push({
      id: `dexor-${hashText(`${url}-${index}`)}`,
      url,
      source: fileName ? 'file-or-manual' : 'manual',
      blogName,
      candidateCategory: normalizeDexorCategory(categoryCell),
      recentPostAt,
      visitEstimate: numbers[0] ?? null,
      reactionEstimate: numbers[1] ?? null,
      adMemo,
      createdAt: now()
    });
  });
  return candidates.filter((item, index, all) => all.findIndex((row) => row.url === item.url) === index).slice(0, 500);
}

function normalizeUsage(settings = {}, productId) {
  if (settings.unlimitedUsage === true) {
    return {
      limit: UNLIMITED_USAGE_LIMIT,
      used: 0,
      remaining: UNLIMITED_USAGE_LIMIT,
      unlimited: true
    };
  }
  const usageRoot = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const raw = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(0, Number(raw.limit)) : DEFAULT_USAGE_LIMIT;
  const used = Number.isFinite(Number(raw.used)) ? Math.max(0, Number(raw.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used)
  };
}

function withUsage(workspace = {}, settings = {}, productId) {
  return {
    ...workspace,
    usage: normalizeUsage(settings, productId)
  };
}

function productUsageFromGrant(grant = {}, productId = '') {
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  return normalizeUsage({ ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

function workspaceFromGrant(grant = {}) {
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  return settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
}

function actionForLockedProduct(product = {}) {
  return {
    health: product.status === 'preparing' || productServiceClosedInProduction(product.id) ? 'maintenance' : 'locked',
    summary: product.status === 'preparing' || productServiceClosedInProduction(product.id)
      ? '서비스 안정화 후 열릴 예정이에요.'
      : '시작하면 이 제품의 작업 메뉴가 열려요.',
    nextAction: product.status === 'preparing' || productServiceClosedInProduction(product.id) ? '준비중' : `${product.name} 시작하기`,
    actionKey: product.id
  };
}

function summarizeCujasaProduct({ product, grant, accounts = [], queue = [] } = {}) {
  const activeAccounts = accounts.filter((account) => account?.status !== 'archived');
  const selectedAccount = activeAccounts[0] || null;
  const scheduled = queue.filter((row) => row.status === 'scheduled').length;
  const posted = queue.filter((row) => row.status === 'posted').length;
  const needsReview = queue.filter((row) => ['failed', 'retry', 'manual_required', 'skipped'].includes(row.status)).length;
  const hasThreads = Boolean(selectedAccount?.has_threads_access_token)
    && (!selectedAccount?.threads_token_status || selectedAccount.threads_token_status === 'connected');
  const hasCoupang = Boolean(selectedAccount?.coupang_access_key && selectedAccount?.coupang_secret_key && selectedAccount?.coupang_partner_id);
  let health = 'ready';
  let summary = `${scheduled}개 예약 · ${posted}개 완료`;
  let nextAction = '포스팅 현황 보기';
  let actionKey = 'posts';

  if (activeAccounts.length === 0) {
    health = 'needs_setup';
    summary = 'Threads 계정을 먼저 연결해야 자동화가 시작돼요.';
    nextAction = 'CUJASA 설정 열기';
    actionKey = 'settings';
  } else if (!hasThreads || !hasCoupang) {
    health = 'needs_setup';
    summary = !hasThreads ? 'Threads 연결이 필요해요.' : '쿠팡 API 설정이 필요해요.';
    nextAction = '설정 확인';
    actionKey = 'settings';
  } else if (needsReview > 0) {
    health = 'needs_attention';
    summary = `${needsReview}개 포스팅 확인이 필요해요.`;
    nextAction = '포스팅 현황 보기';
    actionKey = 'posts';
  } else if (scheduled === 0) {
    health = 'empty';
    summary = '오늘 예약된 포스팅이 없어요.';
    nextAction = '자동화 실행';
    actionKey = 'run';
  }

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    granted: Boolean(grant),
    status: grant?.status || 'active',
    health,
    summary,
    nextAction,
    actionKey,
    usage: null,
    metrics: { accounts: activeAccounts.length, scheduled, posted, needsReview }
  };
}

function summarizeDexorProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates.length : 0;
  const results = Array.isArray(workspace.analysisResults) ? workspace.analysisResults.length : 0;
  if (results > 0) {
    return { health: 'ready', summary: `${results}개 후보 분석 결과가 준비됐어요.`, nextAction: '후보 다운로드', actionKey: 'dexor-download', usage };
  }
  if (candidates > 0) {
    return { health: usage.remaining <= 0 ? 'needs_attention' : 'needs_setup', summary: `${candidates}개 후보가 분석 대기 중이에요.`, nextAction: usage.remaining <= 0 ? '크레딧 충전' : '등급 분석', actionKey: usage.remaining <= 0 ? 'billing' : 'dexor-grade', usage };
  }
  return { health: 'empty', summary: '블로그 후보를 업로드하면 등급 분석을 시작할 수 있어요.', nextAction: '후보 업로드', actionKey: 'dexor-upload', usage };
}

function summarizeSpreadProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : (workspace.campaignDraft ? [workspace.campaignDraft] : []);
  const selected = campaigns[0] || {};
  if (selected.submissionReview || workspace.submissionReview) return { health: 'ready', summary: '제출물 검수 결과가 준비됐어요.', nextAction: '제출물 검수', actionKey: 'spread-review', usage };
  if (Array.isArray(selected.applicants || workspace.applicants) && (selected.applicants || workspace.applicants).length > 0) return { health: 'needs_setup', summary: '참여자 선정 다음 단계가 남아 있어요.', nextAction: '제출물 검수', actionKey: 'spread-review', usage };
  if (campaigns.length > 0) return { health: 'needs_setup', summary: `${campaigns.length}개 캠페인이 운영 대기 중이에요.`, nextAction: '참여자 선정', actionKey: 'spread-applicants', usage };
  return { health: 'empty', summary: '캠페인 초안을 만들면 운영 흐름이 시작돼요.', nextAction: '캠페인 추천', actionKey: 'spread-campaign', usage };
}

function summarizePolibotProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const knowledgeCount = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources.length : 0;
  const recommendationCount = Array.isArray(workspace.recommendations) ? workspace.recommendations.length : 0;
  const feedbackNeedsReview = Number(workspace.feedbackSummary?.needsReview || 0);
  if (feedbackNeedsReview > 0) return { health: 'needs_attention', summary: `${feedbackNeedsReview}개 추천 피드백 검토가 필요해요.`, nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
  if (recommendationCount > 0) return { health: 'ready', summary: `${recommendationCount}개 추천 초안이 준비됐어요.`, nextAction: '결과 다운로드', actionKey: 'polibot-download', usage };
  if (knowledgeCount === 0) return { health: 'needs_setup', summary: '추천 자료 준비 상태를 확인 중이에요. 고객 조건 입력은 계속 진행할 수 있어요.', nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
  return { health: 'empty', summary: '추천 준비가 완료됐어요. 고객 조건을 넣어 추천을 만들 수 있어요.', nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
}

function summarizeInfludexProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates.length : 0;
  const results = Array.isArray(workspace.infludexResults) ? workspace.infludexResults.length : 0;
  const missing = Array.isArray(workspace.infludexResults) ? workspace.infludexResults.filter((item) => item.analysisStatus === 'data_missing').length : 0;
  if (results > 0) return { health: missing > 0 ? 'needs_attention' : 'ready', summary: missing > 0 ? `${missing}개 후보 데이터 보강이 필요해요.` : `${results}개 인플루언서 분석 결과가 준비됐어요.`, nextAction: '결과 다운로드', actionKey: 'infludex-download', usage };
  if (candidates > 0) return { health: usage.remaining <= 0 ? 'needs_attention' : 'needs_setup', summary: `${candidates}개 후보가 분석 대기 중이에요.`, nextAction: usage.remaining <= 0 ? '크레딧 충전' : '링크 분석', actionKey: usage.remaining <= 0 ? 'billing' : 'infludex-grade', usage };
  return { health: 'empty', summary: '인스타그램 후보를 업로드하면 등급 분석을 시작할 수 있어요.', nextAction: '후보 업로드', actionKey: 'infludex-upload', usage };
}

function summarizeAuvibotProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const jobs = Array.isArray(workspace.jobs) ? workspace.jobs : [];
  const ready = jobs.filter((job) => ['ready', 'rendered', 'queued'].includes(job.status)).length;
  const running = jobs.filter((job) => ['running', 'sourcing', 'editing', 'rendering'].includes(job.status)).length;
  if (ready > 0) return { health: 'ready', summary: `${ready}개 쇼츠 작업이 포스팅 대기 중이에요.`, nextAction: '포스팅 현황', actionKey: 'auvibot-posts', usage };
  if (running > 0) return { health: 'needs_setup', summary: `${running}개 자동화 작업이 진행 중이에요.`, nextAction: '포스팅 현황', actionKey: 'auvibot-posts', usage };
  return { health: 'needs_setup', summary: '설정 확인 후 영상 자동화를 시작할 수 있어요.', nextAction: '자동화 실행', actionKey: 'auvibot-run', usage };
}

function summarizeGrantedProduct({ product, grant } = {}) {
  const base = {
    productId: product.id,
    name: product.name,
    description: product.description,
    granted: true,
    status: grant.status || 'active'
  };
  if (product.status === 'preparing' || productServiceClosedInProduction(product.id)) {
    return { ...base, ...actionForLockedProduct(product), granted: true };
  }
  if (product.id === 'dexor') return { ...base, ...summarizeDexorProduct({ product, grant }) };
  if (product.id === 'spread') return { ...base, ...summarizeSpreadProduct({ product, grant }) };
  if (product.id === 'polibot') return { ...base, ...summarizePolibotProduct({ product, grant }) };
  if (product.id === 'infludex') return { ...base, ...summarizeInfludexProduct({ product, grant }) };
  if (product.id === 'auvibot') return { ...base, ...summarizeAuvibotProduct({ product, grant }) };
  return { ...base, health: 'ready', summary: '제품을 사용할 수 있어요.', nextAction: `${product.name} 열기`, actionKey: product.id, usage: productUsageFromGrant(grant, product.id) };
}

export async function buildProductWorkspaceSummary({ userId, allowedAccountIds = [] } = {}) {
  const [rawGrants, user] = await Promise.all([
    dbList('user_products', { user_id: userId }).catch(() => []),
    dbGet('users', { id: userId }).catch(() => null)
  ]);
  const unlimitedUsage = UNLIMITED_TEST_EMAILS.has(String(user?.email || '').trim().toLowerCase());
  const grants = rawGrants.map((grant) => ({ ...grant, unlimitedUsage }));
  const grantByProductId = new Map(grants.map((grant) => [grant.product_id, grant]));
  const accountIds = Array.isArray(allowedAccountIds) ? allowedAccountIds.filter(Boolean) : [];
  const [accounts, queueGroups] = await Promise.all([
    Promise.all(accountIds.map((id) => dbGet('accounts', { id }).catch(() => null))),
    Promise.all(accountIds.map((id) => dbList('post_queue', { account_id: id }).catch(() => [])))
  ]);
  const cujasaGrant = grantByProductId.get('cujasa') || { status: 'active', settings: {}, unlimitedUsage };
  const products = PRODUCTS.map((product) => {
    const grant = product.id === 'cujasa' ? cujasaGrant : grantByProductId.get(product.id);
    if (product.id === 'cujasa') {
      return summarizeCujasaProduct({
        product,
        grant,
        accounts: accounts.filter(Boolean),
        queue: queueGroups.flat()
      });
    }
    if (!grant || grant.status === 'suspended' || grant.status === 'expired') {
      return {
        productId: product.id,
        name: product.name,
        description: product.description,
        granted: false,
        status: product.status || 'active',
        usage: null,
        ...actionForLockedProduct(product)
      };
    }
    return summarizeGrantedProduct({ product, grant });
  });
  const needsAttention = products.filter((item) => ['needs_attention', 'needs_setup'].includes(item.health)).length;
  const activeCount = products.filter((item) => item.granted && item.health !== 'maintenance').length;
  const cujasa = products.find((item) => item.productId === 'cujasa');
  return {
    products,
    overview: {
      activeCount,
      needsAttention,
      scheduled: cujasa?.metrics?.scheduled || 0,
      posted: cujasa?.metrics?.posted || 0,
      accounts: cujasa?.metrics?.accounts || 0
    },
    primaryAction: products.find((item) => ['needs_attention', 'needs_setup'].includes(item.health))
      || products.find((item) => item.granted && item.health === 'empty')
      || products.find((item) => item.granted)
      || products[0]
  };
}

export async function getProductWorkspaceStatus(userId, productId) {
  const product = productById(productId);
  const grant = await getGrant(userId, productId);
  return summarizeGrantedProduct({ product, grant });
}

function sortDexorResults(results = []) {
  return [...results].sort((a, b) => {
    const aLabel = a.scoreLabel || a.grade || '';
    const bLabel = b.scoreLabel || b.grade || '';
    const gradeDelta = (DEXOR_SCORE_ORDER[aLabel] ?? 99) - (DEXOR_SCORE_ORDER[bLabel] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
}

function sortInfludexResults(results = []) {
  return [...results].sort((a, b) => {
    const gradeDelta = (INFLUDEX_GRADE_ORDER[a.grade] ?? 99) - (INFLUDEX_GRADE_ORDER[b.grade] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.handle || a.url || '').localeCompare(String(b.handle || b.url || ''));
  });
}

function parseInfludexRows(input = '', fileName = '') {
  const rows = String(input || '')
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];
  let header = null;
  rows.forEach((line, index) => {
    const cells = splitCandidateLine(line);
    const joined = cells.join(' ');
    const looksLikeHeader = /url|계정|닉네임|핸들|handle|category|카테고리|followers|팔로워|likes|좋아요|댓글|이름\/설명|이메일\/문의/i.test(joined)
      && !/^https?:\/\//i.test(cells[0] || '')
      && !String(cells[0] || '').startsWith('@');
    if (looksLikeHeader) {
      header = cells.map((cell) => String(cell || '').trim().toLowerCase());
      return;
    }
    const byHeader = (patterns = []) => {
      if (!header) return '';
      const columnIndex = header.findIndex((name) => patterns.some((pattern) => pattern.test(name)));
      return columnIndex >= 0 ? cells[columnIndex] || '' : '';
    };
    const rawUrl = byHeader([/^url$/, /링크/]) || cells.find((cell) => /^https?:\/\//i.test(cell)) || '';
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
    const handle = byHeader([/handle/, /핸들/, /계정/, /닉네임/, /\bid\b/]) || cells.find((cell) => /^@?[a-zA-Z0-9._]{2,50}$/.test(cell) && !/^\d+$/.test(cell)) || (url.match(/instagram\.com\/([^/?#]+)/i)?.[1] || '');
    if (!url && !handle) return;
    const metaCells = cells.filter((cell) => cell !== url && cell !== handle);
    const recentPostAt = byHeader([/recent/, /최근/, /게시일/]) || metaCells.find((cell) => /\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cell)) || '';
    const followerCount = parseNumberLike(byHeader([/follower/, /팔로워/]));
    const avgLikes = parseNumberLike(byHeader([/avglike/, /likes?/, /좋아요/]));
    const avgComments = parseNumberLike(byHeader([/avgcomment/, /comments?/, /댓글/]));
    const numbers = metaCells.map(parseNumberLike).filter((value) => value !== null);
    const displayName = byHeader([/이름/, /설명/, /name/, /description/]) || '';
    const contactMemo = byHeader([/이메일/, /문의/, /contact/, /email/]) || metaCells.find((cell) => /@.+\.|010-|오픈톡|litt\.ly|linktr\.ee|카톡|문의/i.test(cell)) || '';
    const descriptionText = [displayName, contactMemo, fileName].filter(Boolean).join(' ');
    const inferredCategory = /부업|수익|n잡|n잡|n잡|재테크|머니/i.test(descriptionText) ? '부업/수익화'
      : /ai|인공지능|콘텐츠/i.test(descriptionText) ? 'AI/콘텐츠'
        : /마케팅|브랜딩|브랜드/i.test(descriptionText) ? '마케팅/브랜딩'
          : '';
    const category = byHeader([/category/, /카테고리/, /분야/]) || inferredCategory || metaCells.find((cell) => cell && cell !== recentPostAt && cell !== contactMemo && parseNumberLike(cell) === null && !/광고|협찬|체험단|스폰서|이동|-$/i.test(cell)) || '';
    const adMemo = byHeader([/admemo/, /광고/, /협찬/, /메모/]) || metaCells.find((cell) => /광고|협찬|체험단|스폰서|상업/i.test(cell)) || '';
    candidates.push({
      id: `infludex-${hashText(`${url || handle}-${index}`)}`,
      url,
      handle: String(handle || '').replace(/^@/, ''),
      displayName,
      description: displayName,
      category,
      followerCount: followerCount ?? numbers[0] ?? null,
      avgLikes: avgLikes ?? numbers[1] ?? null,
      avgComments: avgComments ?? numbers[2] ?? null,
      recentPostAt,
      contactMemo,
      adMemo,
      source: fileName ? 'file-or-manual' : 'manual',
      createdAt: now()
    });
  });
  return candidates
    .filter((item, index, all) => all.findIndex((row) => (row.url || row.handle) === (item.url || item.handle)) === index)
    .slice(0, 500);
}

function stripXmlText(xml = '') {
  return String(xml || '')
    .replace(/<\/w:tc>/g, ',')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>\s*,/g, ',')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/a:t>\s*<a:t[^>]*>/g, ' ')
    .replace(/<\/w:t>\s*<w:t[^>]*>\s*(?=(?:https?:\/\/|@?[a-zA-Z0-9._-]+,))/g, '\n')
    .replace(/<\/w:t>\s*<w:t[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t\f\v]*,[ \t\f\v]*/g, ',')
    .replace(/\n+,/g, ',')
    .replace(/,+\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t\f\v]*\n[ \t\f\v]*/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDocxTextFromBase64(base64 = '') {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) return '';
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.entryName))
    .map((entry) => stripXmlText(entry.getData().toString('utf8')))
    .filter(Boolean)
    .join('\n');
}

function infludexRowsFromFiles(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const fileName = file?.fileName || file?.name || '';
    const ext = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (ext === 'docx') return extractDocxTextFromBase64(file.base64 || '');
    if (ext === 'csv' || ext === 'txt') {
      return Buffer.from(String(file.base64 || ''), 'base64').toString('utf8');
    }
    return '';
  }).filter(Boolean).join('\n');
}

function normalizeList(input = '') {
  return String(input)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function formatPolibotMoneyAmount(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/원|만원|억|이하|이상|~/.test(text)) return text;
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}만원` : text;
}

function parsePolibotPremiumAmount(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, '');
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[2]);
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;
  return /원/.test(normalized) && !/만원/.test(normalized) ? amount / 10000 : amount;
}

function formatPolibotPremiumAmount(value) {
  if (!Number.isFinite(Number(value))) return '';
  return `${Number(value).toLocaleString('ko-KR')}만원`;
}

function polibotBudgetFitLevel(amount, target) {
  if (!Number.isFinite(Number(amount)) || !Number.isFinite(Number(target)) || Number(target) <= 0) {
    return { level: 'reference', ratio: null, overAmount: null, label: '예산 기준 확인' };
  }
  const ratio = Number(amount) / Number(target);
  const overAmount = Number(amount) - Number(target);
  if (ratio <= 1) return { level: 'within_budget', ratio, overAmount, label: '예산 내' };
  if (ratio <= 1.15) return { level: 'near_budget', ratio, overAmount, label: '예산 근접 초과' };
  if (ratio <= 1.5) return { level: 'over_budget', ratio, overAmount, label: '예산 초과' };
  return { level: 'severe_over_budget', ratio, overAmount, label: '예산 크게 초과' };
}

function polibotBudgetOverrunText(amount, target) {
  const fit = polibotBudgetFitLevel(amount, target);
  if (!Number.isFinite(fit.overAmount) || fit.overAmount <= 0) return '';
  const percent = Math.round((fit.ratio - 1) * 1000) / 10;
  return `${formatPolibotPremiumAmount(amount)}가 목표 ${formatPolibotPremiumAmount(target)}보다 ${formatPolibotPremiumAmount(fit.overAmount)} 초과 (${percent}%)`;
}

function buildPolibotPremiumPlan(profile = {}) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const remodel = /리모델링|보험료 절감/.test(profile.purpose || '');
  const targetPremium = Number.isFinite(target) ? formatPolibotPremiumAmount(target) : formatPolibotMoneyAmount(profile.budget);
  const currentPremium = Number.isFinite(current) ? formatPolibotPremiumAmount(current) : formatPolibotMoneyAmount(profile.existingPremium);
  let additionalBudgetMemo = '';
  if (Number.isFinite(target) && Number.isFinite(current)) {
    const diff = Math.round((target - current) * 10) / 10;
    if (remodel) additionalBudgetMemo = `기존 보험 조정 포함 · 목표 ${formatPolibotPremiumAmount(target)} / 현재 ${formatPolibotPremiumAmount(current)}`;
    else if (diff > 0) additionalBudgetMemo = `추가 가능 예산 약 ${formatPolibotPremiumAmount(diff)}`;
    else if (diff === 0) additionalBudgetMemo = '추가 여력 없음 · 기존 보험 조정 또는 보장 재배치 중심';
    else additionalBudgetMemo = `목표가 현재보다 약 ${formatPolibotPremiumAmount(Math.abs(diff))} 낮음 · 절감/리모델링 확인 필요`;
  } else if (remodel) {
    additionalBudgetMemo = '기존 보험 조정까지 포함해 목표 보험료 안에서 검토';
  } else {
    additionalBudgetMemo = '목표와 현재 납입 보험료 확인 시 추가 가능 예산 계산';
  }
  return { targetPremium, currentPremium, additionalBudgetMemo };
}

function polibotAgeValue(profile = {}) {
  const age = Number(String(profile.age || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(age) && age > 0 ? age : null;
}

function polibotAgeRangeStatus(item = {}, profile = {}) {
  const age = polibotAgeValue(profile);
  const rangeText = String(item.ageRange || '').trim();
  if (!age || !rangeText) return { status: 'unknown', label: '가입연령 확인 필요', reason: rangeText || '상품 자료에 가입연령이 명확하지 않아요.' };
  const numbers = rangeText.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (numbers.length >= 2) {
    const min = Math.min(numbers[0], numbers[1]);
    const max = Math.max(numbers[0], numbers[1]);
    if (age < min || age > max) return { status: 'blocked', label: '연령 조건 불리', reason: `${age}세는 자료상 가입연령 ${min}~${max}세 범위를 벗어날 수 있어요.` };
    return { status: 'ok', label: '연령 조건 부합', reason: `${age}세는 자료상 가입연령 ${min}~${max}세 범위 안에 있어요.` };
  }
  const only = numbers[0];
  if (Number.isFinite(only) && /이상|부터/.test(rangeText) && age < only) return { status: 'blocked', label: '연령 조건 불리', reason: `${only}세 이상 조건으로 보이며 현재 ${age}세예요.` };
  if (Number.isFinite(only) && /이하|까지/.test(rangeText) && age > only) return { status: 'blocked', label: '연령 조건 불리', reason: `${only}세 이하 조건으로 보이며 현재 ${age}세예요.` };
  return { status: 'unknown', label: '가입연령 확인 필요', reason: `${rangeText} 기준을 상담 시 확인해야 해요.` };
}

function polibotMedicalRisk(profile = {}) {
  const medical = String(profile.medicalHistory || '').trim();
  const family = String(profile.familyHistory || '').trim();
  const text = `${medical} ${family}`;
  if (!medical) return { level: 'unknown', label: '고지 확인 필요', reasons: ['최근 5년 입원/수술/투약/진단 여부를 확인해야 해요.'] };
  if (/없음|무|해당\s*없/i.test(medical)) {
    return {
      level: 'low',
      label: '고지 리스크 낮음',
      severity: 'low',
      underwritingBias: 'standard_first',
      routeHint: '표준심사 우선',
      reasons: ['입력상 병력/고지 이슈가 없어요.'],
      flags: [],
      questions: ['최근 건강검진에서 추가검사 소견이 없었는지만 최종 확인하세요.']
    };
  }
  const reasons = [];
  const flags = [];
  if (/고혈압|혈압/i.test(medical)) flags.push({ key: 'hypertension', label: '고혈압/혈압', risk: 'moderate', question: '최근 혈압 수치, 복용 약, 합병증 여부를 확인해야 합니다.' });
  if (/당뇨/i.test(medical)) flags.push({ key: 'diabetes', label: '당뇨', risk: 'high', question: '당화혈색소, 인슐린 사용 여부, 합병증 여부를 확인해야 합니다.' });
  if (/고지혈|콜레스테롤|지질/i.test(medical)) flags.push({ key: 'dyslipidemia', label: '고지혈/지질', risk: 'moderate', question: '복용 약과 심혈관 합병증 동반 여부를 확인해야 합니다.' });
  if (/입원|수술|시술/i.test(medical)) flags.push({ key: 'recent_admission_surgery', label: '입원/수술/시술', risk: 'high', question: '최근 5년 이력인지, 완치/추적관찰 여부를 확인해야 합니다.' });
  if (/검사|추적|관찰|재검|소견|결절/i.test(medical)) flags.push({ key: 'followup_exam', label: '추적검사/결절/소견', risk: 'high', question: '최근 3개월 추가검사 소견과 최종 진단명을 확인해야 합니다.' });
  if (/암|심근경색|협심증|뇌졸중|뇌출혈|뇌경색|심장|뇌/i.test(medical)) flags.push({ key: 'major_disease', label: '암/심뇌혈관 이력', risk: 'high', question: '진단 시점, 치료 종료일, 재발/전이/후유증 여부를 확인해야 합니다.' });
  if (/디스크|관절|허리|목/i.test(medical)) flags.push({ key: 'musculoskeletal', label: '근골격계', risk: 'moderate', question: '부담보 가능성이 있어 부위, 치료 기간, 현재 증상을 확인해야 합니다.' });
  if (/투약|복용|약|치료|진단/i.test(medical)) flags.push({ key: 'medication_treatment', label: '투약/치료/진단', risk: 'moderate', question: '투약 기간과 현재 치료 지속 여부를 확인해야 합니다.' });
  if (/암|심장|뇌|당뇨/i.test(family)) flags.push({ key: 'family_history', label: '가족력', risk: 'reference', question: '가족력은 본인 병력과 분리해 관련 담보 니즈와 고지 질문 해당 여부만 확인합니다.' });
  if (/수술|입원|치료|투약|약|진단|검사|추적|관찰|고혈압|당뇨|고지혈|디스크|결절|암|심장|뇌/i.test(text)) {
    reasons.push('병력/투약/검사 이력이 있어 표준체, 할증, 부담보, 간편심사 여부를 비교해야 해요.');
  }
  if (/암|심장|뇌|당뇨/i.test(family)) reasons.push('가족력 때문에 관련 담보 인수 기준을 확인하는 편이 좋아요.');
  const hasHigh = flags.some((item) => item.risk === 'high');
  const severity = hasHigh ? 'high' : flags.length ? 'moderate' : 'unknown';
  return {
    level: 'review',
    label: severity === 'high' ? '고지 심사 강함' : '고지 심사 필요',
    severity,
    underwritingBias: severity === 'high' ? 'simple_or_conditional' : 'standard_compare',
    routeHint: severity === 'high' ? '간편심사/조건부 인수 우선 비교' : '표준심사와 간편심사 동시 비교',
    reasons: reasons.length ? reasons : ['병력 상세가 있어 인수 가능 여부 확인이 필요해요.'],
    flags,
    questions: flags.map((item) => item.question).slice(0, 6)
  };
}

function polibotPriceStrategy(profile = {}) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const purpose = String(profile.purpose || '').trim();
  const renewal = String(profile.renewalPreference || '').trim();
  const wantsSaving = /보험료\s*절감/.test(purpose) || (Number.isFinite(target) && Number.isFinite(current) && target < current);
  const wantsUpgrade = /보장\s*강화|신규\s*가입|상속|노후|가족/.test(purpose) || (Number.isFinite(target) && Number.isFinite(current) && target > current);
  const remodel = /리모델링/.test(purpose);
  let mode = 'balanced';
  if (wantsSaving) mode = 'save';
  else if (wantsUpgrade) mode = 'upgrade';
  else if (remodel) mode = 'remodel';
  const label = {
    save: '보험료 절감 우선',
    upgrade: '보장 강화 우선',
    remodel: '기존 보험 재배치',
    balanced: '보장/보험료 균형'
  }[mode];
  const reasons = [
    Number.isFinite(target) && `목표 월 보험료 ${formatPolibotPremiumAmount(target)}`,
    Number.isFinite(current) && `현재 월 보험료 ${formatPolibotPremiumAmount(current)}`,
    renewal === '비갱신 선호' && '비갱신 선호로 초기 보험료 부담을 함께 봐야 해요.',
    renewal === '허용' && '갱신형 허용이라 같은 예산에서 보장 폭을 넓힐 수 있어요.',
    mode === 'save' && '비슷한 보장이면 보험료를 낮추는 후보를 우선 검토합니다.',
    mode === 'upgrade' && '보험료가 다소 높아도 핵심 진단비/간병/수술 보장을 두껍게 보는 후보를 우선 검토합니다.',
    mode === 'remodel' && '기존 보험과 중복되는 담보를 줄이고 부족 담보를 보완하는 관점입니다.'
  ].filter(Boolean);
  return { mode, label, targetPremium: Number.isFinite(target) ? formatPolibotPremiumAmount(target) : '', currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '', reasons };
}

function polibotPurposeAnalysis(profile = {}, { premiumFit = {}, medicalRisk = {}, coverageMatches = [], evidenceIntegrity = {} } = {}) {
  const purpose = String(profile.purpose || '').trim();
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const existingMedical = String(profile.existingMedicalPlan || '').trim();
  const renewal = String(profile.renewalPreference || '').trim();
  const matchedNeeds = coverageMatches.filter((item) => item.status === 'matched').length;
  const totalNeeds = coverageMatches.length;
  let mode = 'balanced';
  if (/보험료\s*절감/.test(purpose)) mode = 'save';
  else if (/리모델링/.test(purpose)) mode = 'remodel';
  else if (/신규\s*가입/.test(purpose)) mode = 'new';
  else if (/보장\s*강화/.test(purpose)) mode = 'upgrade';

  const blockers = [];
  const successCriteria = [];
  const tradeoffs = [];
  const nextQuestions = [];
  let score = 62;

  if (mode === 'save') {
    successCriteria.push('기존 보장 중 유지할 담보를 정한 뒤 월 보험료 절감 가능성을 비교합니다.');
    if (Number.isFinite(target) && Number.isFinite(current) && target < current) {
      score += 14;
      successCriteria.push(`현재 ${formatPolibotPremiumAmount(current)}에서 목표 ${formatPolibotPremiumAmount(target)}로 낮추는 기준이 확인됩니다.`);
    } else {
      score -= 10;
      blockers.push('절감 목표가 현재 보험료보다 낮은지 숫자로 확인되지 않았습니다.');
    }
    if (premiumFit.level === 'within_budget' || premiumFit.level === 'reference_within_budget') score += 8;
    if (premiumFit.level === 'severe_over_budget' || premiumFit.level === 'reference_severe_over_budget') {
      score -= 16;
      blockers.push('절감 목적 대비 추천 후보 보험료가 크게 초과됩니다.');
    }
    if (premiumFit.level === 'estimate_needed') blockers.push('비교 보험료가 없어 실제 절감액을 계산할 수 없습니다.');
    tradeoffs.push('보험료를 낮추면 진단비, 입원일당, 수술비 한도가 줄 수 있습니다.');
    nextQuestions.push('절감해도 절대 줄이면 안 되는 담보와 최소 가입금액은 얼마인가요?');
  } else if (mode === 'upgrade') {
    successCriteria.push('보험료보다 암/뇌/심장/간병/수술 등 핵심 담보 보강을 우선합니다.');
    if (matchedNeeds >= Math.max(1, Math.ceil(totalNeeds * 0.6))) score += 12;
    else {
      score -= 12;
      blockers.push('입력한 핵심 보장 중 추천 상품과 직접 연결되는 항목이 부족합니다.');
    }
    if (Number.isFinite(target) && Number.isFinite(current) && target > current) score += 6;
    if (renewal === '비갱신 선호') tradeoffs.push('비갱신 선호라 초기 보험료가 높아질 수 있습니다.');
    nextQuestions.push('보험료가 올라가도 반드시 보강하고 싶은 1순위 담보는 무엇인가요?');
  } else if (mode === 'remodel') {
    successCriteria.push('기존 실손/기존 보험과 중복되는 담보를 정리하고 부족한 담보만 보완합니다.');
    if (existingMedical && existingMedical !== '없음') score += 8;
    else {
      score -= 10;
      blockers.push('기존 실손 또는 기존 보험 상세가 없어 중복 담보 판단이 제한됩니다.');
    }
    if (matchedNeeds > 0) score += 6;
    if (premiumFit.level === 'estimate_needed') blockers.push('리모델링 전후 보험료 차액 산출이 필요합니다.');
    if (premiumFit.level === 'severe_over_budget' || premiumFit.level === 'reference_severe_over_budget') blockers.push('리모델링 목표 보험료와 추천 후보 보험료 차이가 큽니다.');
    tradeoffs.push('기존 계약 해지 전 면책기간, 감액기간, 재가입 가능성을 반드시 확인해야 합니다.');
    nextQuestions.push('기존 증권의 담보별 가입금액, 갱신 여부, 납입기간을 확인했나요?');
  } else if (mode === 'new') {
    successCriteria.push('기본 진단비/입원/수술/실손/운전자 등 생활 리스크 순서로 빈 보장을 채웁니다.');
    if (matchedNeeds >= Math.max(1, Math.ceil(totalNeeds * 0.5))) score += 10;
    else {
      score -= 8;
      blockers.push('신규 가입의 기본 보장 우선순위와 추천 상품 연결이 약합니다.');
    }
    if (medicalRisk.level === 'low') score += 8;
    if (medicalRisk.level === 'review') tradeoffs.push('병력 때문에 표준형보다 간편심사/조건부 인수 가능성을 함께 봐야 합니다.');
    nextQuestions.push('처음 가입이라면 사망/진단비/실손/운전자 중 월 예산 안에서 우선순위를 어떻게 둘까요?');
  } else {
    successCriteria.push('보장 공백과 보험료 부담을 균형 있게 비교합니다.');
    if (matchedNeeds > 0) score += 6;
    nextQuestions.push('절감과 보장 강화 중 어느 쪽이 더 중요한가요?');
  }

  if (evidenceIntegrity.score < 62) {
    score -= 16;
    blockers.push('근거 정확도가 낮아 목적별 판단을 확정하기 어렵습니다.');
  } else if (evidenceIntegrity.score < 82) {
    score -= 8;
    blockers.push('일부 근거는 검수 후 최종 목적 적합도를 판단해야 합니다.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    mode,
    label: {
      save: '목적 적합도: 보험료 절감',
      upgrade: '목적 적합도: 보장 강화',
      remodel: '목적 적합도: 리모델링',
      new: '목적 적합도: 신규 가입',
      balanced: '목적 적합도: 균형 검토'
    }[mode],
    score,
    level: score >= 78 ? '높음' : score >= 58 ? '검수 필요' : '낮음',
    successCriteria,
    blockers,
    tradeoffs,
    nextQuestions
  };
}

function polibotCoverageMatch(catalogItems = [], profile = {}) {
  const itemText = catalogItems.map((item) => [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [
      group.plan,
      group.linkedSummary,
      ...(Array.isArray(group.coverages) ? group.coverages.flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount]) : [])
    ]) : [])
  ].filter(Boolean).join(' ')).join(' ');
  return (profile.needs || []).map((need) => {
    const terms = polibotNeedTerms(need);
    const matchedTerms = terms.filter((term) => term && itemText.includes(term));
    return {
      need,
      status: matchedTerms.length ? 'matched' : 'unconfirmed',
      label: matchedTerms.length ? '매칭' : '확인 필요',
      reason: matchedTerms.length
        ? `${matchedTerms.slice(0, 4).join(', ')} 관련 상품/담보/가입금액 근거가 확인돼요.`
        : '확정 자료에서 이 니즈와 직접 연결되는 담보 키워드가 약해요.'
    };
  });
}

function polibotCoveragePriority(profile = {}) {
  const age = polibotAgeValue(profile);
  const needs = profile.needs || [];
  return needs.map((need) => {
    let priority = '보통';
    let reason = '입력한 필요 보장입니다.';
    if (/암|뇌|심장/.test(need)) {
      priority = '높음';
      reason = '진단비 중심 핵심 보장이라 기존 가입금액과 보장 범위를 우선 확인해야 해요.';
    }
    if (/간병|치매|요양/.test(need)) {
      priority = age && age >= 50 ? '높음' : '보통';
      reason = '장기 유지와 지급 조건 차이가 커서 보장 개시 조건과 인정 기준 확인이 중요해요.';
    }
    if (/실손|실비/.test(need)) {
      priority = '중복 확인';
      reason = '기존 실손이 있으면 중복 가입/전환 가능성을 먼저 확인해야 해요.';
    }
    if (/유병자|간편/.test(need)) {
      priority = '심사 전략';
      reason = '병력 여부에 따라 일반심사와 간편심사의 보험료/보장 차이를 비교해야 해요.';
    }
    if (/운전자/.test(need)) {
      priority = '생활 리스크';
      reason = '운전 빈도와 벌금/변호사비/사고처리지원금 담보 구성을 확인해야 해요.';
    }
    return { need, priority, reason };
  });
}

function polibotUnderwritingChecklist(profile = {}) {
  const medical = String(profile.medicalHistory || '').trim();
  const text = `${medical} ${profile.familyHistory || ''}`;
  const checks = [
    {
      key: 'recent_treatment',
      label: '최근 치료/투약',
      status: /수술|입원|치료|투약|약|진단|검사|추적|관찰/i.test(medical) ? '확인 필요' : medical ? '낮음' : '미확인',
      reason: medical ? `입력 병력: ${medical}` : '병력 입력이 없어 고지 질문을 먼저 확인해야 해요.'
    },
    {
      key: 'chronic_disease',
      label: '만성질환',
      status: /고혈압|당뇨|고지혈|심장|뇌|간염|신장|디스크/i.test(medical) ? '확인 필요' : '낮음',
      reason: /고혈압|당뇨|고지혈/i.test(medical)
        ? '복용 약, 조절 수치, 합병증 여부에 따라 인수 조건이 달라질 수 있어요.'
        : '만성질환 키워드는 뚜렷하지 않아요.'
    },
    {
      key: 'existing_medical',
      label: '기존 실손/중복',
      status: profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' ? '확인 필요' : profile.existingMedicalPlan === '없음' ? '낮음' : '미확인',
      reason: profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음'
        ? '기존 실손 가입 시기, 자기부담률, 전환 여부를 확인해야 해요.'
        : '기존 실손 여부가 없거나 미가입으로 입력됐어요.'
    },
    {
      key: 'family_history',
      label: '가족력',
      status: /암|심장|뇌|당뇨/i.test(profile.familyHistory || '') ? '확인 필요' : profile.familyHistory ? '낮음' : '미확인',
      reason: profile.familyHistory ? `입력 가족력: ${profile.familyHistory}` : '가족력이 미입력이라 주요 질환 가족력을 확인하면 좋아요.'
    }
  ];
  return checks;
}

function polibotDisclosureTimeline(profile = {}) {
  const medical = String(profile.medicalHistory || '').trim();
  const text = `${medical} ${profile.familyHistory || ''}`;
  const entries = [
    {
      key: '3m',
      label: '최근 3개월',
      status: /3개월|최근|의심|소견|추가검사|재검|검사|진단|치료|투약|입원|수술/i.test(text) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '질병확정진단, 질병의심소견, 치료, 입원, 수술, 투약, 추가검사 소견 여부를 확인합니다.'
    },
    {
      key: '1y',
      label: '최근 1년',
      status: /1년|재검|추가검사|검진|건강검진|추적/i.test(text) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '진찰 또는 건강검진 후 추가검사/재검사 이력이 있는지 확인합니다.'
    },
    {
      key: '2y',
      label: '최근 2년',
      status: /2년|입원|수술/i.test(text) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '간편심사에서 자주 보는 입원/수술 이력 기간입니다.'
    },
    {
      key: '5y',
      label: '최근 5년',
      status: /5년|입원|수술|30일|7일|장기|암|백혈병|고혈압|협심증|심근경색|심장판막|간경화|뇌졸중|당뇨|에이즈|HIV/i.test(text) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '입원, 수술, 7일 이상 치료, 30일 이상 투약, 주요 질병 이력을 확인합니다.'
    }
  ];
  return entries;
}

function polibotUnderwritingRoute(profile = {}, catalogItems = []) {
  const medical = String(profile.medicalHistory || '').trim();
  const text = `${medical} ${profile.familyHistory || ''}`;
  const age = polibotAgeValue(profile);
  const hasNoMedical = Boolean(medical) && /없음|무|해당\s*없/i.test(medical);
  const hasChronic = /고혈압|혈압|당뇨|고지혈|고지혈증|협심증|심근경색|뇌졸중|심장|간경화/i.test(text);
  const hasRecentRedFlag = /최근|3개월|의심|소견|추가검사|재검|입원|수술|치료|투약|30일|7일/i.test(text);
  const hasMajorDisease = /암|백혈병|협심증|심근경색|심장판막|간경화|뇌졸중|당뇨|에이즈|HIV/i.test(text);
  const productText = catalogItems.map((item) => `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')}`).join(' ');
  const hasSimpleProduct = /간편|유병|고지|325|335|355|310|3\.2\.5|3\.5\.5|3\.10/.test(productText);
  const hasSpecialProduct = /고혈압|당뇨|유병|간편/.test(productText);
  const hasNoUnderwritingProduct = /무심사|무고지|묻지\s*않/.test(productText);
  const routes = [];

  if (hasNoMedical) {
    routes.push({
      type: 'standard',
      label: '표준형/건강고지 우선',
      priority: 1,
      status: '우선 검토',
      reason: '입력상 병력 이슈가 없으므로 간편심사보다 일반/건강고지 상품을 먼저 비교해야 보험료 과다를 피할 수 있어요.'
    });
  } else if (hasChronic && !/입원|수술|암|심근경색|뇌졸중/i.test(text)) {
    routes.push({
      type: 'chronic_special',
      label: '고혈압/당뇨 등 특화 또는 간편심사',
      priority: 1,
      status: hasSpecialProduct || hasSimpleProduct ? '우선 검토' : '상품 확인 필요',
      reason: '만성질환 투약 이력이 있으면 일반심사 거절/할증 가능성이 있어 특화형이나 간편심사 후보를 먼저 봅니다.'
    });
    routes.push({
      type: 'standard',
      label: '표준형 재도전',
      priority: 2,
      status: '비교 검토',
      reason: '조절 수치가 안정적이고 합병증이 없으면 일반심사가 더 저렴할 수 있어 병행 비교가 필요해요.'
    });
  } else if (hasRecentRedFlag || hasMajorDisease) {
    routes.push({
      type: 'simple',
      label: '간편심사 우선',
      priority: 1,
      status: hasSimpleProduct ? '우선 검토' : '상품 확인 필요',
      reason: '최근 치료/투약/입원/수술 또는 주요 질병 이력이 있으면 표준형보다 간편고지 통과 가능성을 먼저 확인해야 해요.'
    });
    routes.push({
      type: 'conditional',
      label: '조건부 인수 검토',
      priority: 2,
      status: '부담보/할증/감액 가능',
      reason: '심사 결과에 따라 특정 질병 부담보, 보험료 할증, 감액기간 조건이 붙을 수 있어요.'
    });
  } else {
    routes.push({
      type: 'balanced',
      label: '표준형과 간편심사 동시 비교',
      priority: 1,
      status: '비교 검토',
      reason: '병력 상세가 불명확하므로 표준형 보험료와 간편심사 통과 가능성을 함께 비교합니다.'
    });
  }

  if ((age && age >= 70) || /거절|가입불가|중증|암|심근경색|뇌졸중/i.test(text)) {
    routes.push({
      type: 'no_underwriting',
      label: '무심사/제한형 후순위',
      priority: 3,
      status: hasNoUnderwritingProduct ? '후순위 검토' : '대체 상품 필요',
      reason: '고령 또는 중증 병력으로 심사형이 어렵다면 무심사/보장제한형을 마지막 대안으로 검토합니다.'
    });
  }

  return routes.sort((a, b) => a.priority - b.priority);
}

function polibotPremiumFit(profile = {}, catalogItems = [], premiumReferences = []) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const itemPremiums = catalogItems
    .flatMap((item) => [
      item.premiumExample,
      ...(Array.isArray(item.premiumExamples) ? item.premiumExamples.map((example) => example.premium) : []),
      ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => row.amount) : []),
      ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => row.amount)) : [])
    ])
    .map(parsePolibotPremiumAmount)
    .filter((value) => Number.isFinite(value) && value > 0);
  const referencePremiums = premiumReferences
    .map((item) => item.premium)
    .map(parsePolibotPremiumAmount)
    .filter((value) => Number.isFinite(value) && value > 0);
  const knownPremiums = itemPremiums.length ? itemPremiums : referencePremiums;
  if (!Number.isFinite(target)) {
    return { level: 'unknown', label: '예산 기준 부족', reason: '목표 월 보험료가 숫자로 확인되지 않아 보험료 적합도는 보류합니다.' };
  }
  if (!knownPremiums.length) {
    return {
      level: 'estimate_needed',
      label: '보험료 산출 필요',
      reason: `목표 ${formatPolibotPremiumAmount(target)} 기준으로 설계 보험료를 산출해야 해요.`,
      targetPremium: formatPolibotPremiumAmount(target),
      currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : ''
    };
  }
  const minPremium = Math.min(...knownPremiums);
  const budgetFit = polibotBudgetFitLevel(minPremium, target);
  if (!itemPremiums.length && referencePremiums.length) {
    return {
      level: budgetFit.level === 'within_budget' ? 'reference_within_budget'
        : budgetFit.level === 'severe_over_budget' ? 'reference_severe_over_budget' : 'reference_over_budget',
      label: '참고 보험료표 있음',
      reason: `문서 내 보험료표 최저 ${formatPolibotPremiumAmount(minPremium)} / 목표 ${formatPolibotPremiumAmount(target)}${budgetFit.overAmount > 0 ? ` · ${polibotBudgetOverrunText(minPremium, target)}` : ''}. 다만 상품 행 연결이 검수되지 않아 설계 보험료 확인이 필요합니다.`,
      targetPremium: formatPolibotPremiumAmount(target),
      currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '',
      examplePremium: formatPolibotPremiumAmount(minPremium),
      overBudgetRatio: budgetFit.ratio,
      overBudgetAmount: Number.isFinite(budgetFit.overAmount) ? formatPolibotPremiumAmount(budgetFit.overAmount) : '',
      confidence: 'reference'
    };
  }
  const level = budgetFit.level;
  return {
    level,
    label: level === 'within_budget' ? '예산 내 후보 있음'
      : level === 'near_budget' ? '예산 근접 초과'
        : level === 'severe_over_budget' ? '예산 크게 초과' : '예산 초과 가능',
    reason: `확인된 최저 예시 보험료 ${formatPolibotPremiumAmount(minPremium)} / 목표 ${formatPolibotPremiumAmount(target)}${budgetFit.overAmount > 0 ? ` · ${polibotBudgetOverrunText(minPremium, target)}` : ''}`,
    targetPremium: formatPolibotPremiumAmount(target),
    currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '',
    examplePremium: formatPolibotPremiumAmount(minPremium),
    overBudgetRatio: budgetFit.ratio,
    overBudgetAmount: Number.isFinite(budgetFit.overAmount) ? formatPolibotPremiumAmount(budgetFit.overAmount) : ''
  };
}

function selectPolibotPremiumExample(catalogItems = [], profile = {}, premiumReferences = []) {
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const itemCandidates = catalogItems.flatMap((item) => {
    const examples = Array.isArray(item.premiumExamples) && item.premiumExamples.length
      ? item.premiumExamples
      : item.premiumExample ? [{ premium: item.premiumExample, age: '', gender: '', confidence: item.premiumConfidence || 'unknown', matchScore: item.premiumConfidence === 'exact' ? 100 : 60 }]
        : Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => ({
          premium: row.amount,
          age: row.age || '',
          gender: row.gender || '',
          confidence: row.confidence || 'table_row',
          matchScore: row.score || 58
        }))
          : Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => ({
            premium: row.amount,
            age: row.age || '',
            gender: row.gender || '',
            confidence: row.confidence || group.linkConfidence || 'linked_group',
            matchScore: group.linkScore || 62
          }))) : [];
    return examples.map((example) => {
      const exampleAge = Number(String(example.age || '').replace(/[^\d.]/g, ''));
      let score = Number(example.matchScore || 0);
      if (Number.isFinite(exampleAge) && age) score += Math.max(0, 30 - Math.abs(exampleAge - age));
      if (gender && example.gender && String(example.gender).includes(gender.slice(0, 1))) score += 18;
      if (example.plan) score += 6;
      if (example.confidence === 'catalog_item' || item.premiumConfidence === 'catalog_item') score += 18;
      if (example.confidence === 'document_match') score += 8;
      return {
        productName: item.productName,
        company: item.company,
        premium: example.premium,
        age: example.age || '',
        gender: example.gender || '',
        plan: example.plan || '',
        confidence: example.confidence || item.premiumConfidence || 'unknown',
        matchQuality: polibotPremiumMatchQuality({ ...example, amount: parsePolibotPremiumAmount(example.premium) }, profile),
        score
      };
    });
  }).filter((item) => item.premium);
  const referenceCandidates = premiumReferences.map((reference) => {
    const exampleAge = Number(String(reference.age || '').replace(/[^\d.]/g, ''));
    let score = 28;
    if (Number.isFinite(exampleAge) && age) score += Math.max(0, 24 - Math.abs(exampleAge - age));
    if (gender && reference.gender && String(reference.gender).includes(gender.slice(0, 1))) score += 14;
    if (reference.productName) score += 10;
    if (reference.confidence === 'catalog_item') score += 18;
    const matchQuality = polibotPremiumMatchQuality({ ...reference, premium: reference.premium, amount: parsePolibotPremiumAmount(reference.premium) }, profile);
    return {
      productName: reference.productName || '문서 내 보험료표',
      company: reference.company || '',
      premium: reference.premium,
      age: reference.age || '',
      gender: reference.gender || '',
      plan: reference.plan || '',
      label: reference.label || '',
      sourcePage: reference.sourcePage || '',
      confidence: reference.confidence || 'document_reference',
      linkStatus: reference.linkStatus || 'unlinked_document_table',
      matchQuality,
      score,
      referenceOnly: true
    };
  }).filter((item) => item.premium);
  const candidates = itemCandidates.length ? itemCandidates : referenceCandidates;
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return { memo: '보험료 산출 필요', confidence: 'none', selected: null };
  const details = [best.company, best.productName, best.age ? `${best.age}세` : '', best.gender].filter(Boolean).join(' · ');
  if (best.referenceOnly) {
    return {
      memo: `${best.premium}${details ? ` (${details})` : ''} · 참고 보험료표, 상품별 설계 확인 필요`,
      confidence: 'reference',
      matchQuality: best.matchQuality || polibotPremiumMatchQuality({ ...best, amount: parsePolibotPremiumAmount(best.premium) }, profile),
      selected: best
    };
  }
  return {
    memo: `${best.premium}${details ? ` (${details})` : ''}`,
    confidence: best.confidence === 'catalog_item' ? 'confirmed' : 'estimated',
    matchQuality: best.matchQuality || polibotPremiumMatchQuality({ ...best, amount: parsePolibotPremiumAmount(best.premium) }, profile),
    selected: best
  };
}

function polibotItemDiagnostics(catalogItems = [], profile = {}) {
  return catalogItems.slice(0, 5).map((item) => {
    const age = polibotAgeRangeStatus(item, profile);
    const needHits = (profile.needs || []).filter((need) => catalogItemMatchesNeeds(item, [need]));
    const decisionBreakdown = polibotItemDecisionBreakdown(item, profile);
    const cautions = [
      age.status === 'blocked' && age.reason,
      age.status === 'unknown' && '가입연령 자료가 불완전합니다.',
      item.renewalType && /갱신/.test(item.renewalType) && profile.renewalPreference === '비갱신 선호' && '고객은 비갱신 선호라 갱신형 여부 확인이 필요합니다.',
      item.completeness !== '충분' && '상품 정보가 충분하지 않아 약관/설계서 확인이 필요합니다.',
      item.conditionRules?.underwritingTypes?.length && `심사 유형 확인: ${item.conditionRules.underwritingTypes.join(', ')}`,
      item.linkedBenefitGroups?.length && item.linkedBenefitGroups.every((group) => group.linkConfidence === 'weak') && '보험료-담보-조건 연결 강도가 낮아 검수 필요',
      ...(decisionBreakdown.blockers || []),
      ...(item.excludedAudience || []).map((value) => `제외 대상 확인: ${value}`)
    ].filter(Boolean);
    let fitScore = decisionBreakdown.score || (50 + Math.min(30, needHits.length * 10));
    if (age.status === 'ok') fitScore += 8;
    if (age.status === 'blocked') fitScore -= 45;
    if (decisionBreakdown.purposeMismatch) fitScore -= 24;
    if (item.premiumExample) fitScore += 5;
    if (item.completeness === '충분') fitScore += 7;
    if (cautions.length) fitScore -= Math.min(18, cautions.length * 4);
    fitScore = Math.max(0, Math.min(100, fitScore));
    return {
      productName: item.productName,
      company: item.company,
      fitScore,
      fitLevel: decisionBreakdown.level || (fitScore >= 78 ? '우선 검토' : fitScore >= 58 ? '검토 가능' : '주의 검토'),
      matchedNeeds: needHits,
      ageStatus: age.label,
      premiumStatus: decisionBreakdown.premium?.amount
        ? `${decisionBreakdown.premium.amount}${decisionBreakdown.premium.age ? ` · ${decisionBreakdown.premium.age}세` : ''}${decisionBreakdown.premium.gender ? ` · ${decisionBreakdown.premium.gender}` : ''}`
        : item.premiumExample ? `예시 ${item.premiumExample}` : item.premiumTableRows?.length ? `보험료표 ${item.premiumTableRows[0].amount}` : item.linkedBenefitGroups?.[0]?.premiums?.[0]?.amount ? `연결묶음 ${item.linkedBenefitGroups[0].premiums[0].amount}` : '보험료 산출 필요',
      decisionBreakdown,
      strengths: decisionBreakdown.strengths || [],
      blockers: decisionBreakdown.blockers || [],
      cautions
    };
  });
}

function polibotEvidenceIntegrity({ profile = {}, catalogItems = [], premiumCatalogItems = [], premiumReferences = [] } = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  const primaryItems = (premiumCatalogItems.length ? premiumCatalogItems : catalogItems).slice(0, 5);
  const checks = [];
  let score = 100;

  const namedProducts = primaryItems.filter((item) => item.productName && item.company && item.company !== '미분류');
  if (namedProducts.length) {
    checks.push({ key: 'product_identity', status: 'ok', label: '상품/보험사 식별', reason: `${namedProducts.length}개 대표 상품의 상품명과 보험사가 확인됩니다.` });
  } else {
    score -= 28;
    checks.push({ key: 'product_identity', status: 'weak', label: '상품/보험사 식별', reason: '대표 상품명 또는 보험사명이 부족해 추천 근거 검수가 필요합니다.' });
  }

  const ageChecks = primaryItems.map((item) => polibotAgeRangeStatus(item, profile));
  const knownAgeChecks = ageChecks.filter((item) => item.status !== 'unknown');
  const blockedAgeChecks = ageChecks.filter((item) => item.status === 'blocked');
  if (blockedAgeChecks.length) {
    score -= 30;
    checks.push({ key: 'age_rule', status: 'blocked', label: '가입연령', reason: blockedAgeChecks[0].reason || '고객 나이가 일부 상품 가입연령과 맞지 않을 수 있습니다.' });
  } else if (knownAgeChecks.length) {
    checks.push({ key: 'age_rule', status: 'ok', label: '가입연령', reason: '대표 상품의 가입연령 조건을 고객 나이와 대조했습니다.' });
  } else {
    score -= 14;
    checks.push({ key: 'age_rule', status: 'unknown', label: '가입연령', reason: '가입연령 자료가 비어 있어 약관 또는 설계 화면 확인이 필요합니다.' });
  }

  const matchedNeeds = needs.filter((need) => primaryItems.some((item) => catalogItemMatchesNeeds(item, [need])));
  if (!needs.length) {
    score -= 10;
    checks.push({ key: 'coverage_match', status: 'unknown', label: '보장 니즈', reason: '고객 필요 보장이 입력되지 않아 담보 매칭을 보류합니다.' });
  } else if (matchedNeeds.length) {
    checks.push({ key: 'coverage_match', status: matchedNeeds.length === needs.length ? 'ok' : 'partial', label: '보장 니즈', reason: `${matchedNeeds.length}/${needs.length}개 니즈가 대표 상품 담보 키워드와 연결됩니다.` });
    if (matchedNeeds.length < needs.length) score -= Math.min(14, (needs.length - matchedNeeds.length) * 5);
  } else {
    score -= 22;
    checks.push({ key: 'coverage_match', status: 'weak', label: '보장 니즈', reason: '대표 상품 담보 키워드와 고객 니즈의 직접 매칭이 약합니다.' });
  }

  const exactPremium = premiumCatalogItems.some((item) => item.premiumExample && ['exact', 'catalog_item'].includes(item.premiumConfidence));
  const tablePremium = premiumCatalogItems.some((item) => Array.isArray(item.premiumTableRows) && item.premiumTableRows.length > 0);
  const linkedPremium = premiumCatalogItems.some((item) => Array.isArray(item.linkedBenefitGroups) && item.linkedBenefitGroups.some((group) => (group.premiums || []).length && (group.coverages || []).length));
  const estimatedPremium = premiumCatalogItems.some((item) => item.premiumExample && !['exact', 'catalog_item', 'none'].includes(item.premiumConfidence));
  if (exactPremium) {
    checks.push({ key: 'premium_link', status: 'ok', label: '보험료 연결', reason: '상품 행에 직접 연결된 보험료 예시가 있습니다.' });
  } else if (linkedPremium) {
    score -= 8;
    checks.push({ key: 'premium_link', status: 'linked_group', label: '보험료-담보 묶음', reason: '상품/플랜 단위로 보험료와 담보가 함께 묶여 추천 근거로 사용할 수 있습니다.' });
  } else if (premiumReferences.length) {
    score -= 16;
    checks.push({ key: 'premium_link', status: 'reference', label: '보험료 연결', reason: '문서 내 보험료표는 있으나 상품 행 연결이 확정되지 않아 참고값으로만 사용합니다.' });
  } else if (tablePremium) {
    score -= 12;
    checks.push({ key: 'premium_link', status: 'table', label: '보험료표 행', reason: '상품 주변 보험료표 행은 있으나 최종 설계 보험료와 일치하는지 확인이 필요합니다.' });
  } else if (estimatedPremium) {
    score -= 18;
    checks.push({ key: 'premium_link', status: 'estimated', label: '보험료 연결', reason: '보험료 후보는 있으나 상품 직접 연결 근거가 약해 설계 보험료 확인이 필요합니다.' });
  } else {
    score -= 28;
    checks.push({ key: 'premium_link', status: 'missing', label: '보험료 연결', reason: '추천 대표 상품의 보험료 예시가 없어 설계 산출 전 최종 비교가 어렵습니다.' });
  }

  const weakCompleteness = primaryItems.filter((item) => item.completeness && item.completeness !== '충분').length;
  if (weakCompleteness) {
    score -= Math.min(14, weakCompleteness * 4);
    checks.push({ key: 'catalog_completeness', status: 'partial', label: '상품 정보 완성도', reason: `${weakCompleteness}개 대표 상품은 납입/갱신/가입조건 등 일부 항목 보강이 필요합니다.` });
  } else if (primaryItems.length) {
    checks.push({ key: 'catalog_completeness', status: 'ok', label: '상품 정보 완성도', reason: '대표 상품의 기본 카탈로그 정보가 충분한 편입니다.' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 82 ? '높음' : score >= 62 ? '검수 필요' : '자료 보강 필요';
  return {
    score,
    level,
    label: `근거 정확도 ${level}`,
    reason: score >= 82
      ? '상품/보험사/보장/가입조건/보험료 근거가 비교적 잘 연결되어 있습니다.'
      : score >= 62 ? '추천은 가능하지만 일부 근거는 상담 전 검수해야 합니다.' : '정확 추천을 위해 원문 또는 설계 데이터 보강이 우선입니다.',
    checks
  };
}

function polibotDecisionScore({ coverageMatches = [], medicalRisk = {}, premiumFit = {}, ageChecks = [], evidenceIntegrity = {}, purposeAnalysis = {} } = {}) {
  const matchedCoverageCount = coverageMatches.filter((item) => item.status === 'matched').length;
  const components = [
    { key: 'coverage', label: '보장 니즈 매칭', score: matchedCoverageCount * 10, reason: `${matchedCoverageCount}/${coverageMatches.length || 0}개 매칭` },
    { key: 'medical', label: '병력 리스크', score: medicalRisk.level === 'low' ? 12 : medicalRisk.level === 'review' ? -8 : 0, reason: medicalRisk.label || medicalRisk.level || '미확인' },
    {
      key: 'premium',
      label: '보험료 적합도',
      score: premiumFit.level === 'within_budget' ? 10
        : premiumFit.level === 'near_budget' ? -4
          : premiumFit.level === 'over_budget' ? -10
            : premiumFit.level === 'severe_over_budget' ? -22
          : premiumFit.level === 'reference_within_budget' ? 4
            : premiumFit.level === 'reference_over_budget' ? -4
              : premiumFit.level === 'reference_severe_over_budget' ? -14
                : premiumFit.level === 'estimate_needed' ? -8 : 0,
      reason: premiumFit.label || premiumFit.level || '미확인'
    },
    {
      key: 'age',
      label: '가입연령',
      score: ageChecks.some((item) => item.status === 'blocked') ? -20 : ageChecks.some((item) => item.status === 'ok') ? 6 : 0,
      reason: ageChecks.some((item) => item.status === 'blocked') ? '연령 조건 불리 후보 있음' : ageChecks.some((item) => item.status === 'ok') ? '연령 조건 부합 후보 있음' : '가입연령 미확인'
    },
    {
      key: 'evidence',
      label: '근거 정확도',
      score: evidenceIntegrity.score < 62 ? -20 : evidenceIntegrity.score < 82 ? -10 : 4,
      reason: evidenceIntegrity.label || ''
    },
    {
      key: 'purpose',
      label: '목적 적합도',
      score: purposeAnalysis.score >= 78 ? 8 : purposeAnalysis.score < 58 ? -12 : purposeAnalysis.score < 70 ? -4 : 0,
      reason: purposeAnalysis.label || purposeAnalysis.level || ''
    }
  ];
  const rawScore = 45 + components.reduce((sum, component) => sum + Number(component.score || 0), 0);
  const score = Math.max(0, Math.min(100, rawScore));
  return {
    score,
    scoreFormula: {
      base: 45,
      rawTotal: rawScore,
      total: score,
      components
    },
    level: score >= 80 ? '높음' : score >= 60 ? '보통' : '주의',
    reason: score >= 80
      ? '고객 니즈와 자료 근거가 비교적 잘 맞습니다.'
      : score >= 60 ? '추천 가능하지만 가입조건/보험료 확인이 필요합니다.' : '상담 전 추가 정보 확인이 우선입니다.'
  };
}

function polibotCompanyOutlook(catalogItems = [], profile = {}, underwritingRoute = [], itemDiagnostics = []) {
  const byCompany = new Map();
  catalogItems.forEach((item) => {
    const company = item.company || '미분류';
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(item);
  });
  const diagnosticKey = (item = {}) => `${item.company || ''}-${item.productName || ''}`;
  const diagnosticsByKey = new Map(itemDiagnostics.map((item) => [diagnosticKey(item), item]));
  const primaryRoute = underwritingRoute[0] || {};
  return [...byCompany.entries()].slice(0, 6).map(([company, items]) => {
    const diagnostics = items
      .map((item) => diagnosticsByKey.get(diagnosticKey(item)))
      .filter(Boolean);
    const bestScore = diagnostics.length ? Math.max(...diagnostics.map((item) => Number(item.fitScore || 0))) : 0;
    const matchedNeeds = [...new Set(diagnostics.flatMap((item) => item.matchedNeeds || []))];
    const hasSimple = items.some((item) => /간편|유병|고지|325|335|355|3\.2\.5|3\.5\.5|3\.10/.test(`${item.productName || ''} ${item.productGroup || ''}`));
    const hasStandardLike = items.some((item) => !/간편|유병|무심사|무고지/.test(`${item.productName || ''} ${item.productGroup || ''}`));
    const cautions = [...new Set(diagnostics.flatMap((item) => item.cautions || []))].slice(0, 4);
    let status = bestScore >= 78 ? '우선 검토' : bestScore >= 58 ? '비교 검토' : '확인 필요';
    if (primaryRoute.type === 'chronic_special' && hasSimple) status = '우선 검토';
    if (primaryRoute.type === 'standard' && hasStandardLike) status = '우선 검토';
    if (primaryRoute.type === 'simple' && !hasSimple) status = '간편심사 상품 확인 필요';
    return {
      company,
      status,
      fitScore: bestScore,
      route: hasSimple ? '간편/유병자 후보 포함' : hasStandardLike ? '표준형 후보 중심' : primaryRoute.label || '심사 경로 확인',
      products: [...new Set(items.map((item) => item.productName).filter(Boolean))].slice(0, 4),
      matchedNeeds,
      reasons: [
        matchedNeeds.length ? `${matchedNeeds.join(', ')} 니즈와 연결됩니다.` : '직접 매칭되는 니즈가 약해 추가 확인이 필요합니다.',
        hasSimple && '간편/유병자형 후보가 있어 병력 고객의 대안으로 검토할 수 있습니다.',
        hasStandardLike && primaryRoute.type !== 'simple' && '표준형 후보가 있어 보험료 비교 가치가 있습니다.',
        ...cautions
      ].filter(Boolean).slice(0, 5)
    };
  }).sort((a, b) => b.fitScore - a.fitScore);
}

function buildPolibotDecisionAnalysis({ profile = {}, catalogItems = [], premiumCatalogItems = catalogItems, premiumReferences = [], keywordText = '', name = '' } = {}) {
  const medicalRisk = polibotMedicalRisk(profile);
  const priceStrategy = polibotPriceStrategy(profile);
  const disclosureTimeline = polibotDisclosureTimeline(profile);
  const underwritingRoute = polibotUnderwritingRoute(profile, catalogItems);
  const ageChecks = catalogItems.slice(0, 4).map((item) => ({
    productName: item.productName,
    company: item.company,
    ...polibotAgeRangeStatus(item, profile)
  }));
  const blockedByAge = ageChecks.some((item) => item.status === 'blocked');
  const hasUnknownAge = ageChecks.some((item) => item.status === 'unknown');
  const eligibilityLevel = blockedByAge
    ? '확인 필요'
    : medicalRisk.level === 'review'
      ? '고지 심사 필요'
      : hasUnknownAge ? '조건 확인 필요' : '검토 가능';
  const coverageMatches = polibotCoverageMatch(catalogItems, profile);
  const coveragePriority = polibotCoveragePriority(profile);
  const underwritingChecklist = polibotUnderwritingChecklist(profile);
  const premiumFit = polibotPremiumFit(profile, premiumCatalogItems, premiumReferences);
  const evidenceIntegrity = polibotEvidenceIntegrity({ profile, catalogItems, premiumCatalogItems, premiumReferences });
  const purposeAnalysis = polibotPurposeAnalysis(profile, { premiumFit, medicalRisk, coverageMatches, evidenceIntegrity });
  const itemDiagnostics = polibotItemDiagnostics(catalogItems, profile);
  const decisionScore = polibotDecisionScore({ coverageMatches, medicalRisk, premiumFit, ageChecks, evidenceIntegrity, purposeAnalysis });
  const companyOutlook = polibotCompanyOutlook(catalogItems, profile, underwritingRoute, itemDiagnostics);
  const itemDecisionSummary = {
    priorityItems: itemDiagnostics
      .filter((item) => ['우선 추천', '우선 검토'].includes(item.fitLevel) || Number(item.fitScore || 0) >= 82)
      .map((item) => `${item.company || ''} ${item.productName || ''}`.trim())
      .filter(Boolean)
      .slice(0, 3),
    holdItems: itemDiagnostics
      .filter((item) => (item.blockers || []).length || Number(item.fitScore || 0) < 64)
      .map((item) => ({
        productName: item.productName,
        company: item.company,
        reasons: (item.blockers || item.cautions || []).slice(0, 3)
      }))
      .slice(0, 5),
    premiumUnknownItems: itemDiagnostics
      .filter((item) => item.decisionBreakdown?.premium?.status === 'unknown')
      .map((item) => `${item.company || ''} ${item.productName || ''}`.trim())
      .filter(Boolean)
      .slice(0, 5)
  };
  const matchedCount = coverageMatches.filter((item) => item.status === 'matched').length;
  const why = [
    `${name}은(는) ${keywordText || '상품 자료'} 기준으로 고객 니즈 ${matchedCount}/${coverageMatches.length || 0}개와 연결됩니다.`,
    itemDecisionSummary.priorityItems.length && `우선 후보: ${itemDecisionSummary.priorityItems.join(', ')}`,
    itemDecisionSummary.holdItems.length && `보류/검수 후보 ${itemDecisionSummary.holdItems.length}개는 가입조건, 보험료, 심사 조건 확인이 필요합니다.`,
    priceStrategy.mode === 'save' && '고객 목적이 보험료 절감 쪽이라 중복 담보 정리와 월 보험료 비교가 핵심입니다.',
    priceStrategy.mode === 'upgrade' && '고객 목적이 보장 강화 쪽이라 보험료보다 핵심 담보 두께와 보장 범위를 우선 봅니다.',
    priceStrategy.mode === 'remodel' && '리모델링 목적이라 기존 실손/기존 보험과 중복되는 담보를 먼저 대조해야 합니다.',
    medicalRisk.level === 'review' && '병력 이력이 있어 일반심사 상품과 간편심사 상품을 함께 비교해야 합니다.',
    medicalRisk.level === 'low' && '입력상 병력 이슈가 없어 표준 심사 가능성을 우선 검토할 수 있습니다.',
    underwritingRoute[0]?.reason,
    premiumFit.level === 'estimate_needed' && '상품별 보험료 예시가 부족해 실제 설계 보험료 산출 후 최종 순위를 정해야 합니다.',
    premiumFit.confidence === 'reference' && '문서 안에 보험료표는 있지만 상품 행과 정확히 연결되지 않아 참고값으로만 사용합니다.',
    evidenceIntegrity.score < 82 && `${evidenceIntegrity.label}: ${evidenceIntegrity.reason}`,
    `${purposeAnalysis.label} ${purposeAnalysis.score}점: ${purposeAnalysis.level}`
  ].filter(Boolean);
  const nextQuestions = [
    medicalRisk.level !== 'low' && '최근 5년 내 입원, 수술, 30일 이상 투약, 추가검사 소견이 있었나요?',
    ...(medicalRisk.questions || []),
    disclosureTimeline.some((item) => item.key === '3m' && item.status === '확인 필요') && '최근 3개월 내 건강검진 의심소견이나 추가검사 소견이 청약서 질문에 해당하나요?',
    underwritingRoute.some((item) => item.type === 'standard' && item.status.includes('비교')) && '표준형으로 먼저 심사했을 때 예상 보험료와 간편심사 보험료를 비교했나요?',
    profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' && '기존 실손 가입 시기와 보장 형태를 확인했나요?',
    priceStrategy.mode === 'save' && '절감 목표가 월 몇 만원인지, 줄이면 안 되는 담보가 무엇인지 확인했나요?',
    priceStrategy.mode === 'upgrade' && '보험료가 올라가도 유지 가능한 상한선이 얼마인지 확인했나요?',
    ...(purposeAnalysis.nextQuestions || []),
    coverageMatches.some((item) => item.status !== 'matched') && '미매칭 니즈는 별도 특약이나 다른 상품으로 보완해야 하나요?',
    hasUnknownAge && '상품별 정확한 가입연령과 납입기간을 확인했나요?'
  ].filter(Boolean);
  return {
    eligibilityLevel,
    decisionScore,
    medicalRisk,
    disclosureTimeline,
    underwritingRoute,
    priceStrategy,
    purposeAnalysis,
    premiumFit,
    evidenceIntegrity,
    premiumReferences: premiumReferences.slice(0, 8),
    ageChecks,
    coverageMatches,
    coveragePriority,
    underwritingChecklist,
    itemDiagnostics,
    itemDecisionSummary,
    companyOutlook,
    why,
    nextQuestions
  };
}

async function getGrant(userId, productId) {
  const product = productById(productId);
  if (!product || !ALLOWED_PRODUCTS.has(product.id)) {
    const error = new Error('지원하지 않는 제품입니다.');
    error.status = 404;
    throw error;
  }
  const grant = await dbGet('user_products', { user_id: userId, product_id: product.id });
  if (!grant || grant.status === 'suspended' || grant.status === 'expired') {
    const error = new Error('제품 사용 권한이 필요합니다.');
    error.status = 403;
    throw error;
  }
  const user = await dbGet('users', { id: userId }).catch(() => null);
  return {
    ...grant,
    unlimitedUsage: UNLIMITED_TEST_EMAILS.has(String(user?.email || '').trim().toLowerCase())
  };
}

async function updateWorkspace(userId, productId, patch) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  const next = {
    ...current,
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

async function updateWorkspaceAndConsume(userId, productId, patch) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, productId);
  if (usage.remaining <= 0) {
    const error = new Error('사용 가능 횟수가 남아 있지 않습니다.');
    error.status = 402;
    throw error;
  }
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  if (grant.unlimitedUsage) {
    const next = {
      ...current,
      workspace: {
        ...workspace,
        ...patch,
        updatedAt: now()
      }
    };
    const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
    const settings = updated?.settings || next;
    return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: true }, productId);
  }
  const nextUsage = {
    limit: usage.limit,
    used: usage.used + 1
  };
  const next = {
    ...current,
    usage: {
      ...usageRoot,
      [productId]: nextUsage
    },
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, settings, productId);
}

async function updateWorkspaceAndConsumeCount(userId, productId, patchBuilder, consumeCount = 1) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, productId);
  const count = Math.max(1, Number(consumeCount || 1));
  if (!grant.unlimitedUsage && usage.remaining < count) {
    const error = new Error('사용 가능 횟수가 부족합니다.');
    error.status = 402;
    error.remaining = usage.remaining;
    throw error;
  }
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  const patch = typeof patchBuilder === 'function' ? patchBuilder(workspace, usage) : patchBuilder;
  const next = {
    ...current,
    ...(grant.unlimitedUsage ? {} : {
      usage: {
        ...usageRoot,
        [productId]: {
          limit: usage.limit,
          used: usage.used + count
        }
      }
    }),
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

export async function getProductWorkspace(userId, productId) {
  const grant = await getGrant(userId, productId);
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const next = { ...workspace };
  if (Array.isArray(next.analysisResults)) next.analysisResults = sortDexorResults(next.analysisResults);
  if (Array.isArray(next.infludexResults)) next.infludexResults = sortInfludexResults(next.infludexResults);
  if (productId === 'polibot') {
    const rawCurrentKnowledge = Array.isArray(next.knowledgeSources) ? next.knowledgeSources : [];
    const dbKnowledge = await listPolibotDbKnowledgeSources(userId).catch((error) => {
      console.warn('[polibot_workspace_knowledge_load_failed]', error?.message || error);
      return [];
    });
    const currentKnowledge = dbKnowledge.length ? [] : rawCurrentKnowledge;
    const seedKnowledge = dbKnowledge.length ? [] : polibotSeedKnowledgeSources();
    const catalogReviews = normalizeCatalogReviews(next.catalogReviews);
    const merged = [...dbKnowledge, ...currentKnowledge, ...seedKnowledge];
    next.knowledgeSources = merged
      .filter((item, index, all) => all.findIndex((row) => row.id === item.id || `${row.month}-${row.fileName}` === `${item.month}-${item.fileName}`) === index)
      .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
      .slice(0, 500)
      .map((source) => ({
        ...source,
        catalogItems: sourceCatalogItems(source, catalogReviews)
      }));
    next.catalogReviews = catalogReviews;
    next.latestKnowledgeMonth = next.knowledgeSources[0]?.month || next.latestKnowledgeMonth || '';
    next.catalog = buildPolibotCatalog(next.knowledgeSources);
    next.qualityReport = next.knowledgeSources.length && next.knowledgeSources.every((source) => source.dbSourceId)
      ? buildPolibotDbQualityReport(next.knowledgeSources)
      : buildPolibotQualityReport(next.knowledgeSources, catalogReviews);
    next.knowledgeDbSummary = await getPolibotDbKnowledgeSummary(userId).catch((error) => {
      console.warn('[polibot_workspace_summary_load_failed]', error?.message || error);
      return EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY;
    });
    next.monthlyChangeReport = buildPolibotMonthlyChangeReport(next.knowledgeSources, catalogReviews);
  }
  return withUsage(next, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

export async function startAuvibotAutomationRun(userId, input = {}) {
  if (process.env.AUVIBOT_RENDER_WORKER_ENABLED !== 'true') {
    const error = new Error('AUVIBOT 영상 렌더 자동화는 관리자 테스트 중입니다. 고객용 실행은 렌더 워커 배포 후 사용할 수 있습니다.');
    error.status = 503;
    error.code = 'AUVIBOT_RENDER_WORKER_NOT_READY';
    throw error;
  }
  const grant = await getGrant(userId, 'auvibot');
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, 'auvibot');
  const requestedCount = Math.max(1, Math.min(10, Number(input.count || 1)));
  const count = grant.unlimitedUsage ? requestedCount : Math.min(requestedCount, usage.remaining);
  if (count <= 0) {
    const error = new Error('무료 사용이 종료되었습니다. 결제 후 계속 이용할 수 있습니다.');
    error.status = 402;
    error.code = 'AUVIBOT_FREE_USAGE_ENDED';
    throw error;
  }
  const nowIso = now();
  const sourceMode = ['mixed', 'product-first', 'trend-first'].includes(input.sourceMode) ? input.sourceMode : 'mixed';
  const quality = ['conversion', 'trend', 'safe'].includes(input.quality) ? input.quality : 'conversion';
  const category = String(input.category || '전체').trim() || '전체';
  const workspace = await updateWorkspaceAndConsumeCount(userId, 'auvibot', (currentWorkspace = {}) => {
    const jobs = Array.isArray(currentWorkspace.jobs) ? currentWorkspace.jobs : [];
    const nextJobs = Array.from({ length: count }).map((_, index) => ({
      id: `auvibot-${Date.now()}-${index}`,
      status: 'queued',
      sourceMode,
      quality,
      category,
      createdAt: nowIso,
      title: category === '전체' ? '자동 주제 쇼츠' : `${category} 쇼츠`
    }));
    return {
      jobs: [...nextJobs, ...jobs].slice(0, 50),
      lastRunAt: nowIso,
      lastRun: {
        sourceMode,
        quality,
        category,
        requestedCount,
        acceptedCount: count
      }
    };
  }, count);
  return {
    ok: true,
    status: 'queued',
    workspace
  };
}

export async function searchPolibotCoverageCodes(userId, params = {}) {
  await getGrant(userId, 'polibot');
  const query = String(params.query || params.q || '').trim();
  const company = String(params.company || '').trim();
  const coverage = String(params.coverage || '').trim();
  const results = await searchPolibotCodeCandidates(userId, {
    query,
    company,
    coverage,
    limit: params.limit || 30
  });
  return {
    query,
    company,
    coverage,
    count: results.length,
    results,
    notice: results.length
      ? '검수 상태가 함께 표시됩니다. 추천 가능 상태가 아닌 근거는 고객 제시 전 확인이 필요합니다.'
      : '일치하는 코드 후보를 찾지 못했습니다. 보장명, 보험사, 숫자 코드를 바꿔 다시 검색해 주세요.'
  };
}

const SUBLOG_CATEGORIES = new Set(['AI', '영상', '음악', '생산성', '클라우드', '업무', '마케팅', '개발', '기타']);
const SUBLOG_CURRENCIES = new Set(['KRW', 'USD']);

function mapSublogSubscription(row = {}) {
  return {
    id: row.id,
    name: row.name || '',
    amount: Number(row.amount || 0),
    currency: row.currency || 'KRW',
    billingDay: Number(row.billing_day || 1),
    category: row.category || '기타',
    memo: row.memo || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null
  };
}

function normalizeSublogPayload(input = {}) {
  const name = String(input.name || '').trim();
  const amount = Number(String(input.amount ?? '').replace(/,/g, ''));
  const currency = SUBLOG_CURRENCIES.has(String(input.currency || '').toUpperCase())
    ? String(input.currency).toUpperCase()
    : 'KRW';
  const billingDay = Math.min(31, Math.max(1, Number(input.billingDay || input.billing_day || 1) || 1));
  const rawCategory = String(input.category || '기타').trim();
  const category = SUBLOG_CATEGORIES.has(rawCategory) ? rawCategory : '기타';
  const memo = String(input.memo || '').trim().slice(0, 500);
  if (!name) {
    const error = new Error('구독 이름을 입력해주세요.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('구독 금액을 입력해주세요.');
    error.status = 400;
    throw error;
  }
  return {
    name: name.slice(0, 120),
    amount,
    currency,
    billing_day: billingDay,
    category,
    memo
  };
}

export async function listSublogSubscriptions(userId) {
  await getGrant(userId, 'sublog');
  const rows = await dbList('sublog_subscriptions', { user_id: userId }, { order: 'created_at', ascending: false });
  return { items: rows.map(mapSublogSubscription) };
}

export async function saveSublogSubscription(userId, input = {}) {
  await getGrant(userId, 'sublog');
  const payload = normalizeSublogPayload(input);
  const id = String(input.id || '').trim();
  if (id) {
    const existing = await dbGet('sublog_subscriptions', { id, user_id: userId });
    if (!existing) {
      const error = new Error('구독 항목을 찾을 수 없습니다.');
      error.status = 404;
      throw error;
    }
    const [updated] = await dbUpdate('sublog_subscriptions', { id, user_id: userId }, payload);
    return { item: mapSublogSubscription(updated) };
  }
  const inserted = await dbInsert('sublog_subscriptions', { user_id: userId, ...payload });
  return { item: mapSublogSubscription(inserted) };
}

export async function deleteSublogSubscription(userId, subscriptionId) {
  await getGrant(userId, 'sublog');
  const id = String(subscriptionId || '').trim();
  const existing = id ? await dbGet('sublog_subscriptions', { id, user_id: userId }) : null;
  if (!existing) {
    const error = new Error('구독 항목을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  await dbDelete('sublog_subscriptions', { id, user_id: userId });
  return { ok: true };
}

export async function saveDexorCandidates(userId, { urls = '', fileName = '', targetCategory = '' } = {}) {
  const parsed = parseCandidateRows(urls, fileName);
  const normalizedTargetCategory = normalizeDexorCategory(targetCategory) || '기타';
  const candidates = parsed.length > 0
    ? parsed
    : parseUrls(urls).map((url, index) => ({
      id: `dexor-${hashText(`${url}-${index}`)}`,
      url,
      source: fileName ? 'file-or-manual' : 'manual',
      blogName: deriveBlogNameFromUrl(url),
      candidateCategory: '',
      createdAt: now()
    }));
  return updateWorkspace(userId, 'dexor', {
    candidates,
    targetCategory: normalizedTargetCategory,
    fileName: String(fileName || '').trim(),
    analysisResults: []
  });
}

export async function analyzeDexorCandidates(userId) {
  const workspace = await getProductWorkspace(userId, 'dexor');
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  if (candidates.length === 0) {
    const error = new Error('분석할 후보가 없습니다.');
    error.status = 400;
    throw error;
  }
  const analysisResults = sortDexorResults(candidates.map((candidate) => {
    const hash = hashText(candidate.url);
    const targetCategory = normalizeDexorCategory(workspace.targetCategory) || '기타';
    const candidateCategory = normalizeDexorCategory(candidate.candidateCategory) || '미입력';
    const naverBonus = /blog\.naver\.com/i.test(candidate.url) ? 12 : 0;
    const longUrlPenalty = candidate.url.length > 120 ? 6 : 0;
    const recentTime = candidate.recentPostAt ? new Date(candidate.recentPostAt.replace(/[./]/g, '-')).getTime() : 0;
    const daysSinceRecent = recentTime ? Math.floor((Date.now() - recentTime) / (24 * 60 * 60 * 1000)) : null;
    const freshnessBonus = daysSinceRecent === null ? 0 : daysSinceRecent <= 14 ? 10 : daysSinceRecent <= 45 ? 5 : daysSinceRecent <= 90 ? 0 : -8;
    const visitBonus = Number(candidate.visitEstimate || 0) >= 10000 ? 8 : Number(candidate.visitEstimate || 0) >= 3000 ? 5 : Number(candidate.visitEstimate || 0) >= 1000 ? 2 : 0;
    const reactionBonus = Number(candidate.reactionEstimate || 0) >= 100 ? 7 : Number(candidate.reactionEstimate || 0) >= 30 ? 4 : Number(candidate.reactionEstimate || 0) >= 10 ? 2 : 0;
    const adPenalty = candidate.adMemo ? 10 : 0;
    const categoryBonus = candidateCategory === '미입력' || targetCategory === '기타'
      ? 0
      : candidateCategory === targetCategory ? 9 : -7;
    const score = Math.max(20, Math.min(98, 46 + (hash % 35) + naverBonus + freshnessBonus + visitBonus + reactionBonus + categoryBonus - longUrlPenalty - adPenalty));
    const scoreLabel = dexorScoreLabel(score);
    const scoreComment = dexorScoreComment(score);
    const summaryReasons = [
      /blog\.naver\.com/i.test(candidate.url) ? '네이버' : '외부',
      candidateCategory !== '미입력' && targetCategory !== '기타' ? (candidateCategory === targetCategory ? '카테고리 일치' : '카테고리 다름') : '',
      daysSinceRecent === null ? '' : daysSinceRecent <= 45 ? '최근 활동 양호' : '최근 활동 확인',
      candidate.visitEstimate ? `조회 ${candidate.visitEstimate}` : '',
      candidate.reactionEstimate ? `반응 ${candidate.reactionEstimate}` : '',
      candidate.adMemo ? '광고성 확인' : ''
    ].filter(Boolean);
    const reasonSummary = summaryReasons.join(' · ') || '기본 지표 기준';
    return {
      id: candidate.id,
      url: candidate.url,
      blogName: candidate.blogName || deriveBlogNameFromUrl(candidate.url) || '미입력',
      targetCategory,
      candidateCategory,
      score,
      grade: scoreLabel,
      scoreLabel,
      scoreComment,
      visitEstimate: candidate.visitEstimate ?? null,
      reactionEstimate: candidate.reactionEstimate ?? null,
      recentPostAt: candidate.recentPostAt || '',
      reasonSummary,
      reasons: [reasonSummary],
      analyzedAt: now()
    };
  }));
  return updateWorkspaceAndConsume(userId, 'dexor', { analysisResults });
}

export async function resetDexorWorkspace(userId) {
  return updateWorkspace(userId, 'dexor', {
    candidates: [],
    targetCategory: '기타',
    fileName: '',
    analysisResults: []
  });
}

export async function saveInfludexCandidates(userId, { rows = '', fileName = '', files = [] } = {}) {
  const current = await getProductWorkspace(userId, 'infludex');
  const fileRows = infludexRowsFromFiles(files);
  const mergedRows = [String(rows || '').trim(), fileRows.trim()].filter(Boolean).join('\n');
  const selectedFileName = String(fileName || files?.[0]?.fileName || files?.[0]?.name || '').trim();
  if (!mergedRows.trim() && Array.isArray(current.candidates) && current.candidates.length > 0) {
    return current;
  }
  const candidates = parseInfludexRows(mergedRows, selectedFileName);
  if (candidates.length === 0) {
    const error = new Error('인스타그램 후보를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  return updateWorkspace(userId, 'infludex', {
    candidates,
    candidateRows: mergedRows,
    fileName: selectedFileName,
    infludexResults: []
  });
}

export async function analyzeInfludexCandidates(userId) {
  const workspace = await getProductWorkspace(userId, 'infludex');
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  if (candidates.length === 0) {
    const error = new Error('분석할 인스타그램 후보가 없습니다.');
    error.status = 400;
    throw error;
  }
  const infludexResults = sortInfludexResults(candidates.map((candidate) => {
    const analysis = analyzeInfludexCandidate(candidate);
    return {
      id: candidate.id,
      url: candidate.url,
      handle: candidate.handle,
      category: candidate.category || '카테고리 미입력',
      followerCount: candidate.followerCount,
      avgLikes: candidate.avgLikes,
      avgComments: candidate.avgComments,
      recentPostAt: candidate.recentPostAt || '',
      displayName: candidate.displayName || '',
      description: candidate.description || '',
      contactMemo: candidate.contactMemo || '',
      adMemo: candidate.adMemo || '',
      engagementRate: analysis.engagementRate,
      commentShare: analysis.commentShare,
      score: analysis.score,
      grade: analysis.grade,
      analysisStatus: analysis.analysisStatus,
      scoreBreakdown: analysis.scoreBreakdown,
      gradeReason: analysis.gradeReason,
      riskFlags: analysis.riskFlags,
      reasons: analysis.gradeReason,
      analyzedAt: now()
    };
  }));
  return updateWorkspaceAndConsume(userId, 'infludex', { infludexResults });
}

export async function resetInfludexWorkspace(userId) {
  return updateWorkspace(userId, 'infludex', {
    candidates: [],
    candidateRows: '',
    fileName: '',
    infludexResults: []
  });
}

export async function savePolibotUpload(userId, { fileName = '', note = '' } = {}) {
  const cleanFileName = String(fileName || '').trim();
  const cleanNote = String(note || '').trim();
  if (!cleanFileName && !cleanNote) {
    const error = new Error('보험 상품 PDF 또는 메모를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  return updateWorkspace(userId, 'polibot', {
    upload: {
      fileName: cleanFileName,
      note: cleanNote,
      parsedProducts: cleanFileName ? 8 + (hashText(cleanFileName) % 17) : 0,
      uploadedAt: now()
    }
  });
}

export async function savePolibotKnowledge(userId, { files = [], month = '', note = '' } = {}) {
  const items = await normalizePolibotKnowledgeItems({ files, month, note });
  if (items.length === 0) {
    const error = new Error('월별 자료 파일명 또는 메모를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  await ingestPolibotKnowledge({
    userId,
    scope: 'user',
    sourceChannel: 'web_upload',
    sourceLabel: month || 'POLIBOT 웹 업로드',
    files,
    month,
    note
  });
  const grant = await getGrant(userId, 'polibot');
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const rawWorkspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const current = Array.isArray(rawWorkspace.knowledgeSources) ? rawWorkspace.knowledgeSources : [];
  const knowledgeSources = [...items, ...current]
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, 500);
  return updateWorkspace(userId, 'polibot', {
    knowledgeSources,
    latestKnowledgeMonth: knowledgeSources[0]?.month || ''
  });
}

function polibotEvidencePayload(source = {}, reviews = {}) {
  const catalogItems = sourceCatalogItems(source, reviews);
  return {
    sourceId: source.dbSourceId || source.id || '',
    dbSourceId: source.dbSourceId || '',
    fileName: source.fileName,
    month: source.month,
    company: source.company,
    companies: source.companies || [],
    productGroup: source.productGroup,
    productNames: catalogItems.map((item) => item.productName),
    catalogItems,
    premiumReferences: Array.isArray(source.premiumReferences) ? source.premiumReferences : [],
    keywords: source.keywordHits?.length ? source.keywordHits : source.keywords || [],
    matchScore: source.matchScore || 0,
    sourceChannel: source.sourceChannel || '',
    knowledgeStatus: source.knowledgeStatus || '',
    evidenceQualityScore: Number(source.evidenceQualityScore || 0),
    evidenceQualityLevel: source.evidenceQualityLevel || '',
    evidenceQualityReasons: source.evidenceQualityReasons || [],
    targetAudience: source.targetAudience || [],
    cautions: source.cautions || [],
    summary: source.summary || ''
  };
}

function compactPolibotDbSummary(summary = {}) {
  return {
    totalSources: summary.totalSources || 0,
    globalSources: summary.globalSources || 0,
    userSources: summary.userSources || 0,
    latestMonth: summary.latestMonth || '',
    recommendableCatalogItems: summary.recommendableCatalogItems || 0,
    importedSources: summary.importedSources || 0,
    importedCatalogItems: summary.importedCatalogItems || 0,
    reviewNeededCatalogItems: summary.reviewNeededCatalogItems || 0,
    conflictCatalogItems: summary.conflictCatalogItems || 0,
    privacyRiskSources: summary.privacyRiskSources || 0,
    highQualitySources: summary.highQualitySources || 0
  };
}

function polibotCatalogItemVersionKey(item = {}) {
  return [
    item.company || '미분류',
    String(item.productName || '').replace(/\s+/g, '')
  ].join('|');
}

function polibotCatalogComparableSnapshot(item = {}) {
  const coverages = [
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => group.coverages || []) : [])
  ];
  const premiums = [
    item.premiumExample,
    ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => row.amount || row.premium) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((premium) => premium.amount)) : [])
  ].filter(Boolean);
  return {
    company: item.company || '',
    productName: item.productName || '',
    productGroup: item.productGroup || '',
    premium: premiums[0] || '',
    premiumSet: [...new Set(premiums)].sort(),
    ageRange: item.ageRange || item.conditionDetails?.ageRange || '',
    renewalType: item.renewalType || item.conditionDetails?.renewalType || '',
    paymentTerm: item.paymentTerm || item.conditionDetails?.paymentTerm || '',
    coverageSet: [...new Set(coverages
      .map((coverage) => [
        coverage.fineCategory || coverage.category || '',
        coverage.title || '',
        coverage.amount || ''
      ].join(' '))
      .filter(Boolean))].sort(),
    underwritingTypes: [...new Set(item.conditionRules?.underwritingTypes || item.conditionDetails?.conditionRules?.underwritingTypes || [])].sort()
  };
}

function firstComparablePremium(snapshot = {}) {
  const value = parsePolibotPremiumAmount(snapshot.premium);
  return Number.isFinite(value) ? value : null;
}

function changedPolibotFields(current = {}, previous = {}) {
  const checks = [
    ['premium', '보험료'],
    ['ageRange', '가입연령'],
    ['renewalType', '갱신/비갱신'],
    ['paymentTerm', '납입/만기'],
    ['coverageSet', '담보/가입금액'],
    ['underwritingTypes', '심사조건']
  ];
  return checks
    .filter(([key]) => JSON.stringify(current[key] || '') !== JSON.stringify(previous[key] || ''))
    .map(([, label]) => label);
}

function polibotChangeDetails(current = {}, previous = {}) {
  const details = [];
  const currentPremium = firstComparablePremium(current);
  const previousPremium = firstComparablePremium(previous);
  if (Number.isFinite(currentPremium) && Number.isFinite(previousPremium) && previousPremium > 0 && currentPremium !== previousPremium) {
    const delta = Math.round((currentPremium - previousPremium) * 10) / 10;
    const rate = Math.round(((currentPremium - previousPremium) / previousPremium) * 1000) / 10;
    details.push(`보험료 ${delta > 0 ? '+' : ''}${formatPolibotPremiumAmount(delta)} (${rate > 0 ? '+' : ''}${rate}%)`);
  }
  const addedCoverages = (current.coverageSet || []).filter((item) => !(previous.coverageSet || []).includes(item));
  const removedCoverages = (previous.coverageSet || []).filter((item) => !(current.coverageSet || []).includes(item));
  if (addedCoverages.length) details.push(`추가 담보 ${addedCoverages.slice(0, 3).join(', ')}`);
  if (removedCoverages.length) details.push(`삭제 담보 ${removedCoverages.slice(0, 3).join(', ')}`);
  if (current.ageRange !== previous.ageRange) details.push(`가입연령 ${previous.ageRange || '-'} → ${current.ageRange || '-'}`);
  if (current.renewalType !== previous.renewalType) details.push(`갱신조건 ${previous.renewalType || '-'} → ${current.renewalType || '-'}`);
  if (JSON.stringify(current.underwritingTypes || []) !== JSON.stringify(previous.underwritingTypes || [])) {
    details.push(`심사조건 ${(previous.underwritingTypes || []).join('/') || '-'} → ${(current.underwritingTypes || []).join('/') || '-'}`);
  }
  return details.slice(0, 8);
}

function buildPolibotMonthlyChangeReport(knowledgeSources = [], reviews = {}) {
  const months = [...new Set(knowledgeSources.map((source) => source.month).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const [latestMonth, previousMonth] = months;
  if (!latestMonth) {
    return { latestMonth: '', previousMonth: '', added: [], removed: [], changed: [], unchangedCount: 0, summary: '월별 비교할 자료가 아직 없습니다.' };
  }
  if (!previousMonth) {
    return { latestMonth, previousMonth: '', added: [], removed: [], changed: [], unchangedCount: 0, summary: `${latestMonth} 자료만 있어 전월 비교는 대기 중입니다.` };
  }
  const byMonth = (month) => new Map(knowledgeSources
    .filter((source) => source.month === month)
    .flatMap((source) => sourceAllCatalogItems(source, reviews))
    .filter((item) => item.productName)
    .map((item) => [polibotCatalogItemVersionKey(item), polibotCatalogComparableSnapshot(item)]));
  const latest = byMonth(latestMonth);
  const previous = byMonth(previousMonth);
  const added = [...latest.entries()]
    .filter(([key]) => !previous.has(key))
    .map(([, item]) => item)
    .slice(0, 30);
  const removed = [...previous.entries()]
    .filter(([key]) => !latest.has(key))
    .map(([, item]) => item)
    .slice(0, 30);
  const changed = [...latest.entries()]
    .filter(([key]) => previous.has(key))
    .map(([key, item]) => ({
      ...item,
      previous: previous.get(key),
      changedFields: changedPolibotFields(item, previous.get(key)),
      changeDetails: polibotChangeDetails(item, previous.get(key))
    }))
    .filter((item) => item.changedFields.length)
    .slice(0, 30);
  const unchangedCount = [...latest.keys()].filter((key) => previous.has(key) && !changed.some((item) => polibotCatalogItemVersionKey(item) === key)).length;
  return {
    latestMonth,
    previousMonth,
    added,
    removed,
    changed,
    unchangedCount,
    summary: `${latestMonth} vs ${previousMonth}: 신규 ${added.length}개, 변경 ${changed.length}개, 제외 ${removed.length}개`
  };
}

function buildPolibotKnowledgeSnapshot({ workspace = {}, evidence = [], recommendations = [], recommendationNotice = '' } = {}) {
  const usedSources = [...new Map(evidence
    .map((source) => [source.dbSourceId || source.id || source.fileName, source])
    .filter(([key]) => key)
  ).values()].slice(0, 20);
  const usedCatalogItems = recommendations
    .flatMap((recommendation) => recommendation.catalogItems || [])
    .map((item) => ({
      sourceId: item.sourceId || '',
      company: item.company || '',
      productName: item.productName || '',
      evidenceFile: item.evidenceFile || ''
    }))
    .filter((item, index, all) => item.productName && all.findIndex((row) => `${row.company}-${row.productName}-${row.sourceId}` === `${item.company}-${item.productName}-${item.sourceId}`) === index)
    .slice(0, 30);
  return {
    createdAt: now(),
    latestKnowledgeMonth: workspace.latestKnowledgeMonth || '',
    dbSummary: compactPolibotDbSummary(workspace.knowledgeDbSummary || {}),
    usedSources: usedSources.map((source) => ({
      sourceId: source.dbSourceId || source.id || '',
      fileName: source.fileName || '',
      month: source.month || '',
      scope: source.scope || '',
      sourceChannel: source.sourceChannel || '',
      knowledgeStatus: source.knowledgeStatus || '',
      evidenceQualityScore: Number(source.evidenceQualityScore || 0)
    })),
    usedCatalogItems,
    recommendationCount: recommendations.length,
    failureReason: recommendations.length ? '' : recommendationNotice
  };
}

const POLIBOT_GENERIC_PRODUCT_NAMES = new Set([
  '생명보험', '손해보험', '보험상품', '보장성 보험', '보장성보험', '종신보험', '정기보험',
  '건강보험', '암보험', '실손보험', '치매보험', '연금보험', '변액보험', '저축성보험',
  '장기종합보험', '치매간병보험', '어린이보험', '태아보험', '간편건강보험'
]);

const POLIBOT_BAD_PRODUCT_PATTERN = /가이드북|자료이용|상품비교|자료모음|상품전략|금융환경|관심상품|영업이슈|보험의\s*A|상품의\s*기본|간추린|상품\s*안내|본\s*내용|예시된|따라서|고객\s*조건|보장분석|가입담보|님의\s*상품별|판매되고\s*있는|자료는\s*상품|보험이\s*어려운|알쓸신통|주요국가|기준금리|세계\s*경제뉴스|국내\s*경제뉴스|보험시장|비급여|데이터로\s*읽는|2030\s*보험|보험영업에서|반드시\s*챙겨야|사내\s*교육용|교육\s*목적|무단배포|경제뉴스|시장\s*선점|pdf|pptx|xlsx|csv|https?:/i;
const POLIBOT_PURPOSES = ['보장 강화', '보험료 절감', '리모델링', '신규 가입'];

function normalizePolibotProductName(value = '') {
  return String(value || '')
    .normalize('NFC')
    .replace(/\.(pdf|pptx?|docx|xlsx|csv|txt)$/ig, ' ')
    .replace(/상품명|구\s*분|보험료|변경월|변경일|작성기준일/gi, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/^\s*\d+(?:[,.\d]*원|\s*세)?\s*/g, ' ')
    .replace(/^(?:남성|여성|보장|담보|합계|월납|기준|순위)\s*/g, ' ')
    .replace(/[{}[\]←→󰀲︙]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPolibotProductText(value = '') {
  const normalized = normalizePolibotProductName(value);
  if (!normalized) return [];
  const matches = normalized.match(/(?:[A-Za-z가-힣0-9+·()ⅡⅢⅣⅤ-]+\s*){1,6}(?:보험|플랜|특약|담보|진단비|수술비|입원비|간병비)(?:\s*(?:Plus|PLUS|플러스|더드림|원픽|하이픽|세븐|Q|Ⅱ|Ⅲ|IV|V|260\d(?:\.\d)?))?/g) || [];
  const direct = normalized.length <= 44 ? [normalized] : [];
  return [...direct, ...matches].map(normalizePolibotProductName);
}

function sourceProductNameCandidates(source = {}) {
  return [
    ...(Array.isArray(source.productNames) ? source.productNames : []),
    String(source.textSnippet || '').slice(0, 2500),
    String(source.summary || '').slice(0, 500)
  ];
}

function normalizeCatalogReviews(reviews = {}) {
  if (!reviews || typeof reviews !== 'object') return {};
  const toList = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
    return String(value || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  };
  return Object.fromEntries(Object.entries(reviews)
    .filter(([key, value]) => key && value && typeof value === 'object')
    .slice(0, 1000)
    .map(([key, value]) => [key, {
      status: ['confirmed', 'auto', 'review', 'excluded'].includes(value.status) ? value.status : 'review',
      productName: String(value.productName || '').trim(),
      company: String(value.company || '').trim(),
      productGroup: String(value.productGroup || '').trim(),
      coverageKeywords: toList(value.coverageKeywords),
      ageRange: String(value.ageRange || '').trim(),
      paymentTerm: String(value.paymentTerm || '').trim(),
      renewalType: String(value.renewalType || '').trim(),
      disclosureMemo: String(value.disclosureMemo || '').trim(),
      reductionMemo: String(value.reductionMemo || '').trim(),
      premiumExample: String(value.premiumExample || '').trim(),
      refundRate: String(value.refundRate || '').trim(),
      targetAudience: toList(value.targetAudience),
      excludedAudience: toList(value.excludedAudience),
      cautionMemo: String(value.cautionMemo || '').trim(),
      reason: String(value.reason || '').trim(),
      reviewedAt: value.reviewedAt || now()
    }]));
}

function sourceCatalogItems(source = {}, reviews = {}) {
  const dbCatalogItems = Array.isArray(source.catalogItems) && source.dbSourceId
    ? source.catalogItems
    : [];
  const items = dbCatalogItems.length
    ? dbCatalogItems
    : buildPolibotCatalogItems([source], { reviews });
  return items
    .filter((item) => item.status === 'confirmed'
      && Number(item.confidence || 0) >= 80
      && ['충분', '보통'].includes(item.completeness || '부족')
      && isPolibotCatalogItemUsable(item));
}

function sourceAllCatalogItems(source = {}, reviews = {}) {
  if (Array.isArray(source.catalogItems) && source.catalogItems.length && source.dbSourceId) return source.catalogItems;
  return buildPolibotCatalogItems([source], { includeReview: true, reviews });
}

function catalogItemMatchesNeeds(item = {}, needs = []) {
  if (!Array.isArray(needs) || needs.length === 0) return true;
  const haystack = [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [group.plan, group.linkedSummary, ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount])]) : [])
  ].filter(Boolean).join(' ');
  return needs.some((need) => polibotNeedTerms(need)
    .some((term) => term && (haystack.includes(term) || String(need || '').includes(item.productGroup || ''))));
}

function catalogItemTitleMatchesNeeds(item = {}, needs = []) {
  if (!Array.isArray(needs) || needs.length === 0) return true;
  const productName = String(item.productName || '');
  if (needs.includes('운전자')) return /운전자|오토바이|자동차|교통/.test(productName);
  const haystack = [
    productName,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [group.plan, group.linkedSummary, ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title])]) : [])
  ].filter(Boolean).join(' ');
  return needs.some((need) => polibotNeedTerms(need)
    .some((term) => term && haystack.includes(term)));
}

function polibotIsDriverItem(item = {}) {
  return /운전자|오토바이|자동차|교통|사고처리|벌금|변호사선임/.test([
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : [])
  ].filter(Boolean).join(' '));
}

function polibotPurposeMismatch(item = {}, profile = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  if (polibotIsDriverItem(item) && !needs.some((need) => /운전자|교통|자동차/.test(String(need || '')))) {
    return {
      type: 'driver_without_need',
      label: '운전자 니즈 없음',
      reason: '고객 필요 보장에 운전자/교통사고 보장이 없어 운전자보험은 전용 추천보다 후순위 대체 후보입니다.'
    };
  }
  return null;
}

function polibotNeedTerms(need = '') {
  const value = String(need || '').trim();
  const aliases = {
    실손: ['실손', '실비', '의료비', '통원'],
    실비: ['실손', '실비', '의료비', '통원'],
    암: ['암', '항암', '표적', '유방암', '갑상선'],
    뇌: ['뇌', '뇌혈관', '뇌졸중'],
    심장: ['심장', '허혈', '급성심근', '순환계'],
    간병: ['간병', '요양', '장기요양'],
    치매: ['치매', '인지'],
    간편: ['간편', '유병', '고지', '355', '335', '333'],
    유병자: ['간편', '유병', '고지', '355', '335', '333'],
    운전자: ['운전자', '교통', '자동차'],
    상해: ['상해', '골절', '후유장해'],
    수술: ['수술', '시술'],
    입원: ['입원', '입원일당'],
    종신: ['종신', '사망', '상속'],
    사망: ['종신', '사망', '정기', '상속'],
    연금: ['연금', '노후', '은퇴', '저축'],
    생활비: ['생활비', '소득', '진단비', '일당']
  };
  return [...new Set([value, ...(aliases[value] || [])].filter(Boolean))];
}

function isPolibotCatalogItemUsable(item = {}) {
  const name = String(item.productName || '').trim();
  const compact = name.replace(/\s+/g, '');
  const company = String(item.company || '').replace(/\s+/g, '');
  if (!name || name.length < 3) return false;
  if (company && (compact === company || compact === company.replace(/생명|화재|손해보험|손보/g, ''))) return false;
  if (/^(?:손해보험|생명보험|화재보험|보험|상품|플랜)$/.test(compact)) return false;
  if (/보험금|보험금\s*청구|보험금\s*서류|보험금\/해약환급금|보전\s*서류|고객센터|헬프데스크|전화\s*문의|필수\s*서류|유의사항|금융소비자|개인정보|신용정보|청약|환전|해외송금|서비스|수수료|기준금리|시가총액|총\s*자산|가입고객|외화보험상품|보험차익|보험\s*가입\s*기간|하였으며|보장\s*한도|보험\s*한도|보험\s*소식/i.test(name)) return false;
  if (/비교|현황|전략상품|소식지?|간추린|가이드|자료|안내|기준|목록|요약|실태|재정\s*위기|플랜\s*비교|일부상품\s*제외|대응\s*방안|제안하세요|제안가능|저렴|운영담보|동일|확대|축소/i.test(name)) return false;
  if (/우대\s*플랜은|플랜은|보험료는|보장은|담보는|특징은|보상\s*예시|우대플랜.*예시|각\s*[\d,]+(?:천|만)?만원|치료생활비\s*[\d,]+|월\s*\d+\s*원/i.test(name)) return false;
  if (/보장\s*내용|가입\s*예시|보험료\s*예시|납입\s*예시|해약\s*환급|해지\s*환급|만기\s*환급|가입\s*한도|보장\s*금액|산출\s*기준|가입\s*기준/i.test(name)) return false;
  if (/(?:보험료\s*)?납입\s*면제|납입면제대상|후유장해|장해지급률|장해분류표/i.test(name) && !/(?:보험|플랜).{0,8}$/.test(name.replace(/보험료/g, ''))) return false;
  if (name.length > 46 && !/(?:무배당|무\)|보험|플랜|종신보험|연금보험).{0,16}$/.test(name)) return false;
  return true;
}

function cleanPolibotRecommendationName(value = '', company = '') {
  const companyText = String(company || '').trim();
  const companyCompact = companyText.replace(/\s+/g, '');
  const companyPattern = companyCompact
    ? new RegExp(`^${companyCompact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i')
    : null;
  const rawName = String(value || '').trim();
  const compactName = rawName.replace(/\s+/g, '');
  return rawName
    .normalize('NFC')
    .replace(/^(?:월호|실효|정상)\s+/g, '')
    .replace(/^[▶①-⑳⓵-⓾🅽\-\s·:]+/g, '')
    .replace(companyPattern || /^$/, '')
    .replace(/^무\)/g, '(무)')
    .replace(/\s무\)/g, ' (무)')
    .replace(/\s+/g, ' ')
    .replace(/추천\s*플랜\s*추천\s*플랜/g, '추천플랜')
    .replace(/플랜\s*추천\s*플랜/g, '플랜')
    .replace(/추천\s*플랜$/g, '플랜')
    .replace(/보험\s*보험/g, '보험')
    .replace(/\s+/g, ' ')
    .trim() || compactName;
}

function polibotCatalogItemKind(item = {}) {
  const name = cleanPolibotRecommendationName(item.productName, item.company);
  if (!name) return 'document';
  const compact = name.replace(/\s+/g, '');
  if (/^(?:손해보험|생명보험|화재보험|보험|상품|플랜)$/.test(compact)) return 'document';
  if (/보험금|서류|유의사항|안내|자료|목록|요약|기준|현황|비교|실태|재정\s*위기|대응\s*방안|제안하세요|제안가능|저렴|운영담보|동일|확대|축소|한도|가입\s*예시|보험료\s*예시|환급|공시|약관/i.test(name)) return 'document';
  if (/우대\s*플랜은|플랜은|보험료는|보장은|담보는|특징은|보상\s*예시|우대플랜.*예시|각\s*[\d,]+(?:천|만)?만원|치료생활비\s*[\d,]+|월\s*\d+\s*원/i.test(name)) return 'document';
  if (/(?:보험료\s*)?납입\s*면제|납입면제대상|후유장해|장해지급률|장해분류표/i.test(name) && !/(?:보험|플랜).{0,8}$/.test(name.replace(/보험료/g, ''))) return 'rider';
  if (/특약|담보/.test(name)) return 'rider';
  if (/(진단비|수술비|입원일당|치료비|생활비|간병비|보장비)$/.test(name) && !/보험/.test(name)) return 'rider';
  if (/플랜/.test(name) && !/보험/.test(name)) return 'plan';
  if (/보험/.test(name) || /종신|연금|운전자|치매|간병|실손|암/.test(name)) return 'product';
  return 'plan';
}

function polibotItemPremiumRows(item = {}) {
  return [
    item.premiumExample && { premium: item.premiumExample, confidence: item.premiumConfidence || 'example' },
    ...(Array.isArray(item.premiumExamples) ? item.premiumExamples.map((row) => ({
      premium: row.premium,
      age: row.age || '',
      gender: row.gender || '',
      confidence: row.confidence || 'premium_example'
    })) : []),
    ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => ({
      premium: row.amount,
      age: row.age || '',
      gender: row.gender || '',
      plan: row.plan || '',
      confidence: row.confidence || 'premium_table'
    })) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => ({
      premium: row.amount,
      age: row.age || '',
      gender: row.gender || '',
      plan: row.plan || group.plan || '',
      confidence: row.confidence || group.linkConfidence || 'linked_group',
      linkConfidence: group.linkConfidence || '',
      linkScore: group.linkScore || 0
    }))) : [])
  ].filter((row) => row && row.premium);
}

function polibotBestPremiumForProfile(item = {}, profile = {}) {
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const target = parsePolibotPremiumAmount(profile.budget);
  const candidates = polibotItemPremiumRows(item)
    .map((row) => {
      const amount = parsePolibotPremiumAmount(row.premium);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const rowAge = Number(String(row.age || '').replace(/[^\d.]/g, ''));
      let score = 40;
      if (Number.isFinite(rowAge) && age) score += Math.max(0, 24 - Math.abs(rowAge - age));
      if (gender && row.gender && String(row.gender).includes(gender.slice(0, 1))) score += 16;
      if (row.linkConfidence === 'strong') score += 16;
      else if (row.linkConfidence === 'usable') score += 8;
      if (row.confidence === 'catalog_item' || row.confidence === 'product_table_row' || row.confidence === 'product_premium_matrix') score += 10;
      if (Number.isFinite(target)) {
        if (amount <= target) score += 12;
        else if (amount <= target * 1.15) score += 4;
        else score -= 10;
      }
      return { ...row, amount, score };
    })
    .filter(Boolean);
  return candidates.sort((a, b) => b.score - a.score || a.amount - b.amount)[0] || null;
}

function polibotPremiumMatchQuality(bestPremium = null, profile = {}) {
  if (!bestPremium) {
    return {
      level: 'missing',
      label: '보험료 없음',
      reason: '상품과 연결된 보험료 행이 없어 설계 산출이 필요합니다.'
    };
  }
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const rowAge = Number(String(bestPremium.age || '').replace(/[^\d.]/g, ''));
  const ageDelta = Number.isFinite(rowAge) && age ? Math.abs(rowAge - age) : null;
  const genderMatched = Boolean(gender && bestPremium.gender && String(bestPremium.gender).includes(gender.slice(0, 1)));
  const planMatched = Boolean(bestPremium.plan);
  let score = 45;
  if (ageDelta === 0) score += 22;
  else if (ageDelta !== null && ageDelta <= 5) score += 14;
  else if (ageDelta !== null && ageDelta <= 10) score += 6;
  else if (ageDelta !== null) score -= 8;
  if (genderMatched) score += 18;
  if (planMatched) score += 8;
  if (bestPremium.linkConfidence === 'strong') score += 14;
  else if (bestPremium.linkConfidence === 'usable') score += 8;
  if (/catalog_item|product|exact/i.test(bestPremium.confidence || '')) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    level: score >= 78 ? 'high' : score >= 58 ? 'medium' : 'low',
    label: score >= 78 ? '고객 조건 근접 보험료' : score >= 58 ? '참고 가능 보험료' : '참고 보험료',
    reason: [
      bestPremium.age ? `보험료표 나이 ${bestPremium.age}` : '나이 행 없음',
      bestPremium.gender ? `성별 ${bestPremium.gender}${genderMatched ? ' 매칭' : ' 확인'}` : '성별 행 없음',
      bestPremium.plan ? `플랜 ${bestPremium.plan}` : '',
      bestPremium.linkConfidence && `연결 ${bestPremium.linkConfidence}`
    ].filter(Boolean).join(' · '),
    ageDelta,
    genderMatched,
    planMatched
  };
}

function polibotUnderwritingClassification(item = {}, profile = {}) {
  const medical = String(profile.medicalHistory || '').trim();
  const text = `${medical} ${profile.familyHistory || ''}`;
  const itemText = `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')} ${item.disclosureMemo || ''} ${item.cautionMemo || ''}`;
  const hasMedical = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(text);
  const noMedical = Boolean(medical) && /없음|무|해당\s*없/i.test(medical);
  const simple = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(itemText);
  const noUnderwriting = /무심사|무고지|묻지\s*않/.test(itemText);
  const exclusion = /가입\s*불가|인수\s*거절|제외|제한/.test(`${itemText} ${(item.excludedAudience || []).join(' ')}`);
  const age = polibotAgeRangeStatus(item, profile);
  if (age.status === 'blocked') return { level: 'blocked', label: '연령 초과 가능', reason: age.reason };
  if (exclusion) return { level: 'blocked', label: '인수 어려움', reason: '상품 자료에 가입 제한/제외 문구가 있습니다.' };
  if (hasMedical && simple) return { level: 'preferred', label: '간편심사 우선', reason: '병력 키워드가 있어 간편/유병자형을 우선 비교합니다.' };
  if (hasMedical && noUnderwriting) return { level: 'fallback', label: '무심사 후순위', reason: '심사형이 어려울 때 마지막 대안으로 검토합니다.' };
  if (hasMedical) return { level: 'review', label: '표준심사 가능성 검수', reason: '병력/투약/검사 이력 때문에 표준심사, 할증, 부담보 여부 확인이 필요합니다.' };
  if (noMedical && simple) return { level: 'caution', label: '표준심사 우선', reason: '병력 이슈가 없으면 간편형보다 표준형 보험료를 먼저 비교합니다.' };
  if (noMedical) return { level: 'preferred', label: '표준심사 가능', reason: '입력상 병력 이슈가 없어 표준심사 가능성을 우선 봅니다.' };
  return { level: 'unknown', label: '고지 확인 필요', reason: '최근 치료/투약/검사 이력 확인 후 심사 경로를 확정합니다.' };
}

function polibotItemEvidenceQuality(item = {}) {
  const anchors = Array.isArray(item.evidenceAnchors) ? item.evidenceAnchors : [];
  const coverageAnchors = [
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows : [])
  ].filter((row) => row.evidenceAnchor);
  const linked = polibotLinkedGroupStrength(item);
  let score = 35;
  if (item.productName && item.company && item.company !== '미분류') score += 14;
  if (anchors.length) score += 12;
  if (coverageAnchors.length) score += Math.min(18, coverageAnchors.length * 4);
  if (item.premiumExample || item.premiumTableRows?.length) score += 12;
  if (linked === 'strong') score += 14;
  else if (linked === 'usable') score += 8;
  if (item.ageRange || item.conditionRules?.underwritingTypes?.length) score += 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
    reasons: [
      item.productName && item.company && '상품명/보험사 확인',
      anchors.length && `원문 앵커 ${anchors.length}개`,
      coverageAnchors.length && `담보 원문 ${coverageAnchors.length}개`,
      item.premiumExample || item.premiumTableRows?.length ? '보험료 근거 있음' : '',
      linked && `보험료-담보 연결 ${linked}`
    ].filter(Boolean)
  };
}

function polibotLinkedGroupStrength(item = {}) {
  const groups = Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups : [];
  if (groups.some((group) => group.linkConfidence === 'strong')) return 'strong';
  if (groups.some((group) => group.linkConfidence === 'usable')) return 'usable';
  if (groups.length) return 'weak';
  return '';
}

function polibotItemDecisionBreakdown(item = {}, profile = {}) {
  const age = polibotAgeRangeStatus(item, profile);
  const needHits = (profile.needs || []).filter((need) => catalogItemMatchesNeeds(item, [need]));
  const bestPremium = polibotBestPremiumForProfile(item, profile);
  const target = parsePolibotPremiumAmount(profile.budget);
  const medicalText = `${profile.medicalHistory || ''} ${profile.familyHistory || ''}`;
  const hasNoMedical = Boolean(profile.medicalHistory) && /없음|무|해당\s*없/i.test(profile.medicalHistory);
  const hasMedicalRisk = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(medicalText);
  const productText = `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')}`;
  const simpleProduct = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(productText);
  const noUnderwritingProduct = /무심사|무고지|묻지\s*않/.test(productText);
  const linkedStrength = polibotLinkedGroupStrength(item);
  const premiumLevel = !bestPremium
    ? 'unknown'
    : polibotBudgetFitLevel(bestPremium.amount, target).level;
  const premiumMatchQuality = polibotPremiumMatchQuality(bestPremium, profile);
  const underwritingClassification = polibotUnderwritingClassification(item, profile);
  const itemEvidenceQuality = polibotItemEvidenceQuality(item);
  const purposeMismatch = polibotPurposeMismatch(item, profile);
  const coverageScore = Math.min(30, needHits.length * 10);
  const ageScore = age.status === 'ok' ? 18 : age.status === 'blocked' ? -30 : -8;
  const premiumScore = premiumLevel === 'within_budget' ? 18
    : premiumLevel === 'near_budget' ? 8
      : premiumLevel === 'over_budget' ? -18
        : premiumLevel === 'severe_over_budget' ? -32
          : premiumLevel === 'reference' ? 4 : -8;
  const underwritingScore = hasNoMedical && simpleProduct ? -12
    : hasMedicalRisk && simpleProduct ? 16
      : hasMedicalRisk && noUnderwritingProduct ? 4
        : hasMedicalRisk ? -6
          : hasNoMedical ? 8 : 0;
  const evidenceScore = linkedStrength === 'strong' ? 18
    : linkedStrength === 'usable' ? 10
      : linkedStrength === 'weak' ? -4
        : item.premiumExample || item.coverageDetails?.length ? 4 : -8;
  const evidenceQualityBonus = itemEvidenceQuality.level === 'high' ? 6 : itemEvidenceQuality.level === 'low' ? -6 : 0;
  const renewalScore = item.renewalType && profile.renewalPreference === '비갱신 선호' && /비갱신/.test(item.renewalType) ? 8
    : item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType) ? -10 : 0;
  const purposeScore = purposeMismatch ? -24 : 0;
  const scoreComponents = [
    { key: 'coverage', label: '보장 니즈', score: coverageScore, reason: needHits.length ? `${needHits.join(', ')} 매칭` : (profile.needs || []).length ? '입력 니즈 직접 매칭 약함' : '니즈 미입력' },
    { key: 'age', label: '가입연령', score: ageScore, reason: age.reason || age.label },
    { key: 'premium', label: '보험료', score: premiumScore, reason: bestPremium ? `${formatPolibotPremiumAmount(bestPremium.amount)} · ${premiumLevel}` : '보험료 근거 없음' },
    {
      key: 'underwriting',
      label: '심사 적합도',
      score: underwritingScore,
      reason: hasMedicalRisk
        ? simpleProduct ? '병력 고객에게 간편/유병자형 적합' : noUnderwritingProduct ? '무심사/제한형 후순위 대안' : '병력 고객 표준심사 검수 필요'
        : hasNoMedical ? '병력 이슈 없음' : '병력 미확인'
    },
    { key: 'evidence', label: '근거 연결', score: evidenceScore + evidenceQualityBonus, reason: `${linkedStrength || (item.premiumExample || item.coverageDetails?.length ? 'partial' : 'weak')} · ${itemEvidenceQuality.level}` },
    { key: 'renewal', label: '갱신 선호', score: renewalScore, reason: item.renewalType || '갱신 정보 없음' },
    { key: 'purpose_mismatch', label: '목적 불일치', score: purposeScore, reason: purposeMismatch?.reason || '목적 불일치 없음' }
  ];
  const rawTotal = 50 + scoreComponents.reduce((sum, component) => sum + Number(component.score || 0), 0);
  const total = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const blockers = [
    age.status === 'blocked' && age.reason,
    premiumLevel === 'over_budget' && bestPremium && Number.isFinite(target) && `확인 보험료 ${formatPolibotPremiumAmount(bestPremium.amount)}가 목표 ${formatPolibotPremiumAmount(target)}를 초과합니다.`,
    premiumLevel === 'severe_over_budget' && bestPremium && Number.isFinite(target) && `예산 크게 초과: ${polibotBudgetOverrunText(bestPremium.amount, target)}`,
    premiumMatchQuality.level === 'low' && '고객 나이/성별과 보험료 행 연결이 약합니다.',
    purposeMismatch?.reason,
    ['blocked', 'review'].includes(underwritingClassification.level) && underwritingClassification.reason,
    hasMedicalRisk && !simpleProduct && !noUnderwritingProduct && '병력 입력이 있어 표준심사 인수/할증/부담보 가능성 확인이 필요합니다.',
    linkedStrength === 'weak' && '보험료-담보-조건 연결 강도가 약합니다.',
    !needHits.length && (profile.needs || []).length > 0 && '입력 니즈와 직접 연결되는 담보 근거가 약합니다.',
    item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType) && '비갱신 선호 고객에게 갱신형 부담이 있습니다.'
  ].filter(Boolean);
  const strengths = [
    needHits.length > 0 && `${needHits.join(', ')} 니즈와 연결됩니다.`,
    age.status === 'ok' && age.reason,
    bestPremium && `고객 조건과 가장 가까운 보험료 예시 ${formatPolibotPremiumAmount(bestPremium.amount)}${bestPremium.age ? ` / ${bestPremium.age}세` : ''}${bestPremium.gender ? ` / ${bestPremium.gender}` : ''}`,
    premiumMatchQuality.level === 'high' && premiumMatchQuality.reason,
    underwritingClassification.level === 'preferred' && underwritingClassification.reason,
    hasMedicalRisk && simpleProduct && '병력 고객에게 간편/유병자형 대안으로 볼 수 있습니다.',
    hasNoMedical && !simpleProduct && '병력 이슈가 없어 표준형 후보로 먼저 비교할 수 있습니다.',
    linkedStrength === 'strong' && '보험료와 담보가 강하게 연결된 근거가 있습니다.',
    linkedStrength === 'usable' && '보험료-담보 묶음을 추천 근거로 사용할 수 있습니다.'
  ].filter(Boolean);
  const level = age.status === 'blocked' ? '연령 초과 후보'
    : purposeMismatch ? '대체 후보'
      : premiumLevel === 'severe_over_budget' ? '예산 초과 후보'
        : blockers.length && total < 68 ? '보류 검토' : total >= 82 ? '우선 추천' : total >= 64 ? '비교 후보' : '주의 후보';
  return {
    level,
    score: total,
    scoreFormula: {
      base: 50,
      rawTotal,
      total,
      components: scoreComponents
    },
    coverage: {
      status: needHits.length ? 'matched' : (profile.needs || []).length ? 'weak' : 'unknown',
      score: coverageScore,
      matchedNeeds: needHits
    },
    age: { status: age.status, label: age.label, score: ageScore, reason: age.reason },
    premium: {
      status: premiumLevel,
      score: premiumScore,
      amount: bestPremium ? formatPolibotPremiumAmount(bestPremium.amount) : '',
      rawAmount: bestPremium?.premium || '',
      age: bestPremium?.age || '',
      gender: bestPremium?.gender || '',
      plan: bestPremium?.plan || '',
      matchQuality: premiumMatchQuality,
      confidence: bestPremium?.confidence || ''
    },
    underwriting: {
      status: hasMedicalRisk ? (simpleProduct ? 'simple_fit' : noUnderwritingProduct ? 'limited_fallback' : 'review_needed') : hasNoMedical ? 'standard_first' : 'unknown',
      score: underwritingScore,
      classification: underwritingClassification,
      reason: hasMedicalRisk
        ? simpleProduct ? '병력 키워드와 간편/유병자 상품 성격이 맞습니다.' : '병력 키워드가 있어 심사 조건 확인이 필요합니다.'
        : hasNoMedical ? '병력 이슈 없음 입력으로 표준심사 우선 비교가 적절합니다.' : '병력 정보가 부족합니다.'
    },
    evidence: {
      status: linkedStrength || (item.premiumExample || item.coverageDetails?.length ? 'partial' : 'weak'),
      score: evidenceScore + evidenceQualityBonus,
      quality: itemEvidenceQuality,
      reason: linkedStrength === 'strong' ? '연결 근거 강함' : linkedStrength === 'usable' ? '연결 근거 사용 가능' : linkedStrength === 'weak' ? '연결 근거 약함' : '일부 상품 정보만 확인됨'
    },
    renewal: {
      status: renewalScore > 0 ? 'preferred' : renewalScore < 0 ? 'mismatch' : 'neutral',
      score: renewalScore,
      reason: item.renewalType || ''
    },
    purposeMismatch,
    strengths: strengths.slice(0, 5),
    blockers: blockers.slice(0, 6)
  };
}

function polibotCatalogItemScore(item = {}, profile = {}) {
  const haystack = [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [
      group.plan,
      group.linkedSummary,
      ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount])
    ]) : [])
  ].filter(Boolean).join(' ');
  const terms = (profile.needs || []).flatMap(polibotNeedTerms);
  let score = 0;
  const kind = polibotCatalogItemKind(item);
  const ageStatus = polibotAgeRangeStatus(item, profile);
  const bestPremium = polibotBestPremiumForProfile(item, profile);
  const linkedStrength = polibotLinkedGroupStrength(item);
  if (kind === 'product') score += 18;
  if (kind === 'plan') score += 8;
  if (kind === 'rider') score -= 10;
  if (kind === 'document') score -= 40;
  const medicalText = `${profile.medicalHistory || ''} ${profile.familyHistory || ''}`;
  const hasNoMedical = profile.medicalHistory && /없음|무|해당\s*없/i.test(profile.medicalHistory);
  const hasMedicalRisk = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(medicalText);
  const simpleProduct = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(`${item.productName || ''} ${item.productGroup || ''}`);
  if (hasNoMedical && simpleProduct) score -= 12;
  if (hasMedicalRisk && simpleProduct) score += 14;
  if ((profile.needs || []).includes('운전자')) {
    if (/운전자|오토바이|자동차|교통/.test(item.productName || '')) score += 16;
    else if (/종신|암보험|건강보험/.test(item.productName || '')) score -= 18;
  }
  if (polibotPurposeMismatch(item, profile)) score -= 32;
  terms.forEach((term) => {
    if (term && haystack.includes(term)) score += 8;
  });
  if (ageStatus.status === 'ok') score += 8;
  if (ageStatus.status === 'blocked') score -= 48;
  if (ageStatus.status === 'unknown') score -= 3;
  if (linkedStrength === 'strong') score += 14;
  else if (linkedStrength === 'usable') score += 8;
  else if (linkedStrength === 'weak') score -= 4;
  if (item.premiumExample) score += 5;
  if (Array.isArray(item.premiumExamples) && item.premiumExamples.length) score += 6;
  if (Array.isArray(item.premiumTableRows) && item.premiumTableRows.length) score += 5;
  if (bestPremium) score += 5;
  if (item.ageRange) score += 3;
  if (Array.isArray(item.coverageDetails) && item.coverageDetails.length) score += Math.min(8, item.coverageDetails.length);
  if (Array.isArray(item.coverageTableRows) && item.coverageTableRows.length) score += Math.min(6, item.coverageTableRows.length);
  if (item.renewalType && profile.renewalPreference === '비갱신 선호' && /비갱신/.test(item.renewalType)) score += 6;
  if (item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType)) score -= 8;
  if (/보험|플랜$/.test(item.productName || '')) score += 4;
  if (String(item.productName || '').length > 34) score -= 4;
  if (/특약|담보|한도/.test(item.productName || '')) score -= 6;
  if (/추천\s*플랜|추천플랜/.test(item.productName || '')) score -= 3;
  const target = parsePolibotPremiumAmount(profile.budget);
  const itemPremium = bestPremium?.amount ?? parsePolibotPremiumAmount(item.premiumExample || item.premiumExamples?.[0]?.premium || '');
  if (Number.isFinite(target) && Number.isFinite(itemPremium)) {
    if (itemPremium <= target) score += 8;
    else if (itemPremium <= target * 1.2) score += 2;
    else score -= 8;
  }
  return score;
}

function representativePolibotCatalogItems(items = [], profile = {}) {
  const deduped = [];
  const seen = new Set();
  [...items]
    .sort((a, b) => polibotCatalogItemScore(b, profile) - polibotCatalogItemScore(a, profile))
    .forEach((item) => {
      const productName = cleanPolibotRecommendationName(item.productName, item.company);
      const key = `${item.company || ''}-${productName.replace(/\s+/g, '')}`;
      if (!productName || seen.has(key)) return;
      seen.add(key);
      deduped.push({
        ...item,
        productName,
        displayKind: polibotCatalogItemKind({ ...item, productName })
      });
    });
  const primary = deduped.filter((item) => item.displayKind === 'product');
  const plans = deduped.filter((item) => item.displayKind === 'plan');
  const riders = deduped.filter((item) => item.displayKind === 'rider');
  return [...primary, ...plans, ...riders].slice(0, 8);
}

function normalizePolibotCautions(values = [], profile = {}) {
  const existingMedicalPlan = String(profile.existingMedicalPlan || '').trim();
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => existingMedicalPlan !== '없음' || !/실손|중복/.test(value))
  )].slice(0, 6);
}

function cleanPolibotProductNames(names = []) {
  return [...new Set((Array.isArray(names) ? names : [])
    .flatMap(splitPolibotProductText)
    .map((name) => name.replace(/\s+보험$/, '보험').trim())
    .filter((name) => name.length >= 4 && name.length <= 36)
    .filter((name) => /(보험|플랜|특약|담보|진단비|수술비|입원비|간병비)/.test(name))
    .filter((name) => !POLIBOT_GENERIC_PRODUCT_NAMES.has(name.replace(/\s+/g, '')))
    .filter((name) => !POLIBOT_BAD_PRODUCT_PATTERN.test(name))
    .filter((name) => !/^\d|[,]{2,}|[?]{2,}|[|]/.test(name))
  )].slice(0, 5);
}

function classifyPolibotProducts(source = {}, reviews = {}) {
  const rawCandidates = sourceProductNameCandidates(source).flatMap(splitPolibotProductText);
  const allItems = sourceAllCatalogItems(source, reviews);
  const catalogItems = allItems.filter((item) => item.status === 'confirmed');
  const cleanNames = catalogItems.map((item) => item.productName);
  const cleanSet = new Set(cleanNames);
  const productCandidates = Array.isArray(source.productCandidates) ? source.productCandidates : [];
  const excluded = [...new Set(rawCandidates
    .map(normalizePolibotProductName)
    .filter((name) => name && !cleanSet.has(name))
    .filter((name) => POLIBOT_BAD_PRODUCT_PATTERN.test(name) || POLIBOT_GENERIC_PRODUCT_NAMES.has(name.replace(/\s+/g, ''))))]
    .concat(productCandidates.filter((item) => item.status === 'excluded').map((item) => item.name))
    .slice(0, 8);
  const status = catalogItems.some((item) => item.status === 'confirmed')
    ? 'confirmed'
    : allItems.some((item) => item.status === 'auto')
      ? 'auto'
      : (rawCandidates.length > 0 || productCandidates.some((item) => item.status === 'review') ? 'review' : 'none');
  return {
    sourceId: source.id || `${source.month}-${source.fileName}`,
    fileName: source.fileName,
    month: source.month,
    company: source.company,
    companies: source.companies || [],
    productGroup: source.productGroup,
    status,
    statusLabel: {
      confirmed: '확정 상품',
      auto: '자동 추출',
      review: '검토 필요',
      none: '상품명 부족'
    }[status],
    productNames: cleanNames,
    excludedPhrases: excluded,
    catalogItems,
    candidates: allItems
  };
}

function buildPolibotQualityReport(knowledgeSources = [], reviews = {}) {
  const catalog = knowledgeSources.map((source) => classifyPolibotProducts(source, reviews));
  const allCatalogItems = knowledgeSources.flatMap((source) => sourceAllCatalogItems(source, reviews));
  const catalogItems = allCatalogItems.filter((item) => item.status === 'confirmed' && item.productName);
  const reviewItems = allCatalogItems.filter((item) => ['auto', 'review'].includes(item.status));
  const excludedItems = allCatalogItems.filter((item) => item.status === 'excluded');
  const recommended = catalogItems.filter((item) => ['충분', '보통'].includes(item.completeness || '부족'));
  const insufficientItems = catalogItems.filter((item) => item.completeness === '부족');
  const review = catalog.filter((item) => item.status === 'review');
  const ocrNeeded = knowledgeSources.filter((item) => item.fileType === 'image').length;
  const excludedPhrases = [
    ...catalog.flatMap((item) => item.excludedPhrases || []),
    ...excludedItems.map((item) => item.productName)
  ];
  const companies = [...new Set(knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set(knowledgeSources.map((item) => item.productGroup).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set(knowledgeSources.flatMap((item) => item.keywords || []))]
    .slice(0, 20);
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(recommended.map((item) => `${item.company}-${item.productName}`)).size,
    insufficientProducts: insufficientItems.length,
    reviewNeededProducts: review.length + reviewItems.length,
    excludedPhrases: excludedPhrases.length,
    ocrNeeded,
    companies,
    productGroups,
    keywords,
    catalogItems: allCatalogItems.slice(0, 160),
    recommendableCatalogItems: catalogItems.slice(0, 120),
    catalog: catalog.slice(0, 80)
  };
}

function buildPolibotDbQualityReport(knowledgeSources = []) {
  const allCatalogItems = knowledgeSources.flatMap((source) => Array.isArray(source.catalogItems) ? source.catalogItems : []);
  const allPremiumReferences = knowledgeSources.flatMap((source) => Array.isArray(source.premiumReferences) ? source.premiumReferences : []);
  const documentAnalyses = knowledgeSources.map((source) => source.documentAnalysis).filter(Boolean);
  const catalogItems = allCatalogItems.filter((item) => item.status === 'confirmed' && item.productName);
  const insufficientItems = catalogItems.filter((item) => item.completeness === '부족');
  const reviewItems = allCatalogItems.filter((item) => ['auto', 'review'].includes(item.status));
  const excludedItems = allCatalogItems.filter((item) => item.status === 'excluded');
  const companies = [...new Set([
    ...knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]),
    ...catalogItems.map((item) => item.company)
  ].filter((company) => company && company !== '미분류'))].sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set([
    ...knowledgeSources.map((item) => item.productGroup),
    ...catalogItems.map((item) => item.productGroup)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set([
    ...knowledgeSources.flatMap((item) => item.keywords || []),
    ...catalogItems.flatMap((item) => item.coverageKeywords || [])
  ].filter(Boolean))].slice(0, 20);
  const catalog = knowledgeSources.slice(0, 80).map((source) => {
    const sourceItems = Array.isArray(source.catalogItems) ? source.catalogItems.filter((item) => item.status === 'confirmed') : [];
    return {
      sourceId: source.id || source.dbSourceId || '',
      fileName: source.fileName,
      month: source.month,
      company: source.company,
      companies: source.companies || [],
      productGroup: source.productGroup,
      status: sourceItems.length ? 'confirmed' : 'none',
      statusLabel: sourceItems.length ? '확정 상품' : '상품명 부족',
      productNames: sourceItems.map((item) => item.productName).filter(Boolean).slice(0, 12),
      analysisQuality: source.documentAnalysis?.analysisQuality || {},
      premiumReferenceCount: Array.isArray(source.premiumReferences) ? source.premiumReferences.length : 0,
      excludedPhrases: [],
      catalogItems: sourceItems,
      candidates: sourceItems
    };
  });
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(catalogItems
      .filter((item) => ['충분', '보통'].includes(item.completeness || '부족'))
      .map((item) => `${item.company}-${item.productName}`)).size,
    insufficientProducts: insufficientItems.length,
    reviewNeededProducts: reviewItems.length,
    excludedPhrases: excludedItems.length,
    ocrNeeded: knowledgeSources.filter((item) => item.fileType === 'image').length,
    companies,
    productGroups,
    keywords,
    analysisSummary: {
      premiumReferenceCount: allPremiumReferences.length,
      linkedPremiumReferenceCount: allPremiumReferences.filter((item) => item.linkStatus === 'linked').length,
      documentAnalysisCount: documentAnalyses.length,
      coverageDetailCount: documentAnalyses.reduce((sum, item) => sum + Number(item.analysisQuality?.coverageDetailCount || 0), 0),
      conditionDetailDocuments: documentAnalyses.filter((item) => item.analysisQuality?.hasConditionDetails).length
    },
    catalogItems: allCatalogItems.slice(0, 160),
    recommendableCatalogItems: catalogItems.slice(0, 120),
    catalog
  };
}

function isPolibotRecommendationEligibleSource(source = {}) {
  return source.recommendationEligible !== false
    && !['privacy_risk', 'ocr_needed', 'excluded', 'conflict'].includes(source.knowledgeStatus);
}

function buildPolibotConsultationDraft(profile = {}, qualityReport = {}) {
  const needs = profile.needs || [];
  const missing = [];
  if (!profile.age) missing.push('나이');
  if (!profile.gender) missing.push('성별');
  if (needs.length === 0) missing.push('필요 보장');
  if (!profile.budget) missing.push('예산');
  if (!profile.existingPremium) missing.push('현재 보험료');
  if (!profile.existingMedicalPlan) missing.push('기존 실손 여부');
  if (!profile.medicalHistory) missing.push('병력/고지 이슈');
  const nextQuestions = [
    !profile.existingMedicalPlan && '기존 실손보험이 있나요?',
    !profile.medicalHistory && '최근 5년 내 입원, 수술, 투약이나 고지 이슈가 있나요?',
    !profile.existingPremium && '현재 월 보험료는 얼마인가요?',
    !profile.renewalPreference && '갱신형 상품도 괜찮나요?',
    needs.includes('암') && '암 진단비 목표 금액이 있나요?',
    needs.some((need) => ['뇌', '심장'].includes(need)) && '뇌/심장 진단비를 각각 어느 정도로 보고 있나요?'
  ].filter(Boolean).slice(0, 6);
  const cautions = [
    '고지사항 확인 필요',
    !profile.existingMedicalPlan && '실손 중복 여부 확인 필요',
    !profile.medicalHistory && '병력/부담보 가능성 확인 필요',
    profile.renewalPreference === '비갱신 선호' && '비갱신형 보험료 부담 확인 필요',
    qualityReport.recommendableProducts === 0 && '자동 확정 상품 자료 부족'
  ].filter(Boolean);
  const completeness = missing.length <= 1 ? '충분' : missing.length <= 4 ? '보통' : '부족';
  return {
    summary: [
      profile.name || '고객명 미입력',
      profile.age ? `${profile.age}세` : '',
      profile.gender || '',
      profile.purpose || ''
    ].filter(Boolean).join(' · ') || '고객 조건 미입력',
    needs,
    missing,
    completeness,
    nextQuestions,
    cautions,
    memo: missing.length
      ? `${missing.slice(0, 3).join(', ')} 정보를 확인하면 상품 추천 정확도가 올라가요.`
      : '분석에 필요한 기본 정보가 비교적 충분해요.',
    createdAt: now()
  };
}

function polibotConfidence({ profile, sources, keywordHits, productNames, qualityReport }) {
  let score = 0;
  if (profile.age) score += 12;
  if (profile.gender) score += 8;
  if ((profile.needs || []).length > 0) score += 18;
  if (profile.budget) score += 8;
  if (profile.existingMedicalPlan) score += 8;
  if (profile.medicalHistory) score += 8;
  if (profile.renewalPreference) score += 5;
  score += Math.min(16, keywordHits.length * 4);
  score += Math.min(12, productNames.length * 4);
  score += Math.min(5, sources.filter((source) => source.month).length);
  const catalogItems = sources.flatMap((source) => sourceCatalogItems(source, profile.catalogReviews));
  if (catalogItems.some((item) => item.completeness === '충분')) score += 8;
  if (catalogItems.some((item) => item.completeness === '부족')) score -= 8;
  if ((qualityReport?.recommendableProducts || 0) < 3) score -= 12;
  const level = score >= 72 ? '높음' : score >= 48 ? '보통' : '낮음';
  const reasons = normalizePolibotCautions([
    level === '낮음' && '고객 정보 또는 상품 근거 보강 필요',
    !profile.medicalHistory && '최종 가입 전 고지 확인 필요',
    ...(Array.isArray(profile.riskHoldReasons) ? profile.riskHoldReasons.map((reason) => `${reason} 확인 필요`) : []),
    catalogItems.some((item) => item.completeness === '부족') && '확정 상품의 가입조건/주의사항 정보가 부족해요.',
    (qualityReport?.recommendableProducts || 0) < 3 && '추천 가능한 상품 카탈로그가 아직 적어요.'
  ].filter(Boolean), profile);
  return { level, score, reasons };
}

function buildPolibotRecommendationReview({ decisionAnalysis = {}, evidenceIntegrity = {}, catalogCautions = [], selectedPremium = {} } = {}) {
  const blockers = [];
  const reviewReasons = [];
  const routineChecks = [];
  const addUnique = (target, value) => {
    const text = String(value || '').trim();
    if (text && !target.includes(text)) target.push(text);
  };
  const premiumFit = decisionAnalysis.premiumFit || {};
  const medicalRisk = decisionAnalysis.medicalRisk || {};
  const ageChecks = Array.isArray(decisionAnalysis.ageChecks) ? decisionAnalysis.ageChecks : [];
  const itemSummary = decisionAnalysis.itemDecisionSummary || {};
  const integrityScore = Number(evidenceIntegrity.score || 0);
  const lowPremiumMatch = (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.matchQuality?.level === 'low');
  const purposeMismatchItems = (decisionAnalysis.itemDiagnostics || [])
    .filter((item) => item.decisionBreakdown?.purposeMismatch);

  if (decisionAnalysis.eligibilityLevel && decisionAnalysis.eligibilityLevel !== '검토 가능') {
    addUnique(blockers, `가입 가능성: ${decisionAnalysis.eligibilityLevel}`);
  }
  if (ageChecks.some((item) => item.status === 'blocked')) {
    addUnique(blockers, '가입연령 범위 초과 가능');
  }
  if (purposeMismatchItems.length) {
    addUnique(reviewReasons, purposeMismatchItems[0].decisionBreakdown.purposeMismatch.reason);
  }
  if (integrityScore > 0 && integrityScore < 62) {
    addUnique(blockers, `근거 정확도 낮음: ${integrityScore}점`);
  } else if (integrityScore > 0 && integrityScore < 82) {
    addUnique(reviewReasons, `근거 검수 필요: ${integrityScore}점`);
  }
  if (['severe_over_budget', 'reference_severe_over_budget'].includes(premiumFit.level)) {
    addUnique(reviewReasons, premiumFit.reason || '고객 예산을 크게 초과합니다.');
  } else if (['over_budget', 'reference_over_budget', 'near_budget'].includes(premiumFit.level)) {
    addUnique(reviewReasons, premiumFit.reason || '고객 예산 초과 가능');
  }
  if (premiumFit.level === 'estimate_needed') {
    addUnique(reviewReasons, '설계 보험료 산출 후 최종 비교 필요');
  }
  if (selectedPremium.confidence === 'reference') {
    addUnique(reviewReasons, '보험료가 상품 행과 직접 연결되지 않은 참고값입니다.');
  }
  if (lowPremiumMatch) {
    addUnique(reviewReasons, '고객 나이/성별과 보험료표 행 매칭이 약한 후보가 있습니다.');
  }
  if (medicalRisk.level === 'review') {
    addUnique(reviewReasons, medicalRisk.label || '고지 심사 필요');
  }
  if ((itemSummary.holdItems || []).length > 0) {
    addUnique(reviewReasons, `보류/검수 상품 ${itemSummary.holdItems.length}개 확인 필요`);
  }
  if ((itemSummary.premiumUnknownItems || []).length > 0) {
    addUnique(reviewReasons, `보험료 미확정 상품 ${itemSummary.premiumUnknownItems.length}개`);
  }

  catalogCautions.forEach((caution) => {
    const text = String(caution || '').trim();
    if (!text) return;
    if (/가입\s*불가|제외|제한|인수\s*거절|연령|초과|부담보|할증|감액|고지\s*상세|예산|보험료\s*산출|보험료\s*확인|근거|연결\s*강도|부족|검수|확정/.test(text)) {
      addUnique(reviewReasons, text);
      return;
    }
    addUnique(routineChecks, text);
  });

  const status = blockers.length || reviewReasons.length ? 'needs_review' : 'ready';
  const label = status === 'ready'
    ? '추천 초안 준비'
    : blockers.length ? '검수 후 제안' : '상담 확인 필요';
  const mainReasons = [...blockers, ...reviewReasons].slice(0, 6);
  const summary = status === 'ready'
    ? '핵심 가입조건, 보장 니즈, 보험료 근거가 상담 초안으로 사용할 수 있는 수준입니다.'
    : mainReasons.slice(0, 3).join(' · ') || '상담 전 확인할 조건이 있습니다.';

  return {
    status,
    label,
    summary,
    blockers: blockers.slice(0, 6),
    reasons: reviewReasons.slice(0, 8),
    routineChecks: routineChecks.slice(0, 8)
  };
}

function buildPolibotAdvisorExplanation({ profile = {}, name = '', decisionAnalysis = {}, selectedPremium = {}, catalogItems = [] } = {}) {
  const priceStrategy = decisionAnalysis.priceStrategy || {};
  const medicalRisk = decisionAnalysis.medicalRisk || {};
  const coverageMatches = decisionAnalysis.coverageMatches || [];
  const matched = coverageMatches.filter((item) => item.status === 'matched').map((item) => item.need);
  const unmatched = coverageMatches.filter((item) => item.status !== 'matched').map((item) => item.need);
  const holdItems = decisionAnalysis.itemDecisionSummary?.holdItems || [];
  const itemDiagnostics = decisionAnalysis.itemDiagnostics || [];
  const sorted = [...itemDiagnostics].sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
  const first = sorted[0];
  const second = sorted[1];
  const excluded = sorted.filter((item) => (item.blockers || []).length).slice(0, 2);
  const primary = catalogItems[0] || {};
  return [
    `${name}은(는) ${matched.length ? `${matched.join(', ')} 보장과 직접 연결` : '입력 니즈와 연결 검토'}되어 우선 후보로 잡았습니다.`,
    first && `1순위 근거: ${[first.company, first.productName].filter(Boolean).join(' ')} · ${first.fitLevel} ${first.fitScore}점 · ${(first.strengths || []).slice(0, 2).join(', ') || first.premiumStatus}`,
    second && `2순위 비교: ${[second.company, second.productName].filter(Boolean).join(' ')} · ${second.fitLevel} ${second.fitScore}점 · ${(second.blockers || second.cautions || []).slice(0, 2).join(', ') || '조건 비교 후보'}`,
    selectedPremium?.memo && `보험료 판단: ${selectedPremium.memo}`,
    selectedPremium?.matchQuality?.label && `보험료 행 매칭: ${selectedPremium.matchQuality.label} · ${selectedPremium.matchQuality.reason}`,
    priceStrategy.label && `고객 목적은 ${priceStrategy.label} 기준으로 해석했습니다.`,
    medicalRisk.routeHint && `심사 방향은 ${medicalRisk.routeHint}입니다.`,
    primary.renewalType && `갱신 조건은 ${primary.renewalType}로 표시되어 장기 보험료 변동을 상담 때 확인해야 합니다.`,
    unmatched.length && `직접 연결이 약한 보장: ${unmatched.join(', ')}. 별도 특약 또는 다른 상품으로 보완 여부를 봅니다.`,
    holdItems.length && `비교 제외/보류 후보는 ${holdItems.length}개이며 주된 사유는 ${(holdItems[0].reasons || []).join(', ') || '가입조건 확인'}입니다.`,
    excluded.length && `제외/후순위 사유: ${excluded.map((item) => `${item.productName}: ${(item.blockers || []).slice(0, 2).join(', ')}`).join(' / ')}`
  ].filter(Boolean).slice(0, 7);
}

function buildPolibotExcludedCandidates(evidence = [], profile = {}) {
  return evidence
    .map((source) => {
      const items = sourceAllCatalogItems(source, profile.catalogReviews);
      const usable = sourceCatalogItems(source, profile.catalogReviews);
      return { source, items, usable };
    })
    .filter(({ usable }) => usable.length === 0)
    .slice(0, 6)
    .map(({ source, items }) => ({
      name: source.fileName || '자료명 미입력',
      reason: items.some((item) => item.status === 'excluded')
        ? '상품명 후보가 제외 처리됐거나 문서/담보 조각으로 판단됐습니다.'
        : items.some((item) => item.status === 'review')
          ? '상품 후보는 있으나 자동 확정 점수나 정보 완성도가 부족합니다.'
          : source.fileType === 'image'
        ? 'OCR 전 이미지 자료라 상품명을 확인하지 못했어요.'
        : source.keywordHits?.length ? '니즈 키워드는 있지만 실제 상품명이 부족해요.' : '고객 니즈와 직접 연결되는 근거가 약해요.',
      details: items.slice(0, 3).map((item) => `${item.productName || '상품명 미확인'} · ${item.status || '상태 미확인'} · ${item.completeness || '완성도 미확인'}`),
      fileName: source.fileName,
      month: source.month
    }));
}

function buildPolibotRecommendation({ profile, evidence, label, type, index, seed }) {
  const sources = evidence.slice(index, index + (type === 'bundle' ? 3 : 1));
  const primary = sources[0] || {};
  const keywordHits = [...new Set(sources.flatMap((source) => source.keywordHits || []).filter(Boolean))].slice(0, 6);
  const productGroup = primary.productGroup || label;
  const selectedCompany = String(profile.company || '').trim();
  const rawCatalogItems = sources.flatMap((source) => sourceCatalogItems(source, profile.catalogReviews))
    .filter((item) => !selectedCompany || selectedCompany === '전체 보험사' || item.company === selectedCompany || (item.companies || []).includes(selectedCompany))
    .sort((a, b) => polibotCatalogItemScore(b, profile) - polibotCatalogItemScore(a, profile));
  const needMatchedItems = rawCatalogItems.filter((item) => catalogItemMatchesNeeds(item, profile.needs));
  const candidateItems = needMatchedItems.length ? needMatchedItems : rawCatalogItems;
  const representativeItems = representativePolibotCatalogItems(candidateItems, profile);
  const supportItems = candidateItems
    .filter((item) => !representativeItems.some((representative) => representative.id && representative.id === item.id))
    .slice(0, 6);
  const catalogItems = [...representativeItems, ...supportItems].slice(0, 10);
  const titleItems = representativeItems.filter((item) => ['product', 'plan'].includes(item.displayKind || polibotCatalogItemKind(item)));
  const needMatchedTitleItems = titleItems.filter((item) => catalogItemTitleMatchesNeeds(item, profile.needs));
  const titleSourceItems = needMatchedTitleItems.length ? needMatchedTitleItems : titleItems;
  const eligibleTitleItems = titleSourceItems.filter((item) => polibotAgeRangeStatus(item, profile).status !== 'blocked' && !polibotPurposeMismatch(item, profile));
  const nameTitleItems = eligibleTitleItems.length ? eligibleTitleItems : titleSourceItems;
  const productNames = [...new Set(nameTitleItems.map((item) => cleanPolibotRecommendationName(item.productName, item.company)).filter(Boolean))];
  if (productNames.length === 0) return null;
  if (type === 'bundle' && productNames.length < 2) return null;
  const recommendationNameSet = new Set(productNames);
  const recommendationProductItems = titleItems
    .filter((item) => recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)));
  const recommendationCompanies = new Set(recommendationProductItems.map((item) => item.company).filter(Boolean));
  const sourceCompanies = [...new Set(catalogItems.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))];
  const mainName = productNames[0];
  const prefix = sourceCompanies[0] && !mainName.includes(sourceCompanies[0]) ? `${sourceCompanies[0]} ` : '';
  const name = type === 'bundle'
    ? `${productNames.slice(0, 2).join(' + ')} 조합`
    : `${prefix}${mainName}`;
  const premiumCatalogItems = catalogItems
    .filter((item) => recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)))
    .slice(0, 4);
  const baseScore = Math.max(...sources.map((source) => Number(source.matchScore || 0)), 0);
  const score = Math.min(96, 70 + Math.min(18, baseScore) + Math.min(6, sources.length * 2));
  const coveredNeeds = (profile.needs || []).filter((need) => keywordHits.some((keyword) => need.includes(keyword) || keyword.includes(need))).slice(0, 5);
  const gapText = coveredNeeds.length ? coveredNeeds.join(', ') : (profile.needs || []).slice(0, 3).join(', ') || productGroup;
  const itemKeywords = [...new Set(catalogItems.flatMap((item) => item.coverageKeywords || []).filter(Boolean))].slice(0, 8);
  const keywordText = keywordHits.length ? keywordHits.join(', ') : itemKeywords.length ? itemKeywords.join(', ') : productGroup;
  const riskCautions = Array.isArray(profile.riskHoldReasons)
    ? profile.riskHoldReasons.map((reason) => `${reason} 확인 필요`)
    : [];
  const catalogCautions = normalizePolibotCautions([
    ...riskCautions,
    ...catalogItems.flatMap((item) => [
    ...(item.cautions || []),
    item.cautionMemo,
    item.disclosureMemo,
    item.reductionMemo,
    ...(item.excludedAudience || []).map((value) => `제외/제한: ${value}`)
    ])
  ].filter(Boolean), profile);
  const sourcePremiumReferences = sources
    .flatMap((source) => Array.isArray(source.premiumReferences) ? source.premiumReferences : [])
    .filter((item) => !recommendationCompanies.size || recommendationCompanies.has(item.company))
    .filter((item) => !item.productName || recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)))
    .filter((item) => item && item.premium)
    .slice(0, 60);
  const selectedPremium = selectPolibotPremiumExample(premiumCatalogItems, profile, sourcePremiumReferences);
  const premiumMemo = selectedPremium.memo;
  const premiumPlan = buildPolibotPremiumPlan(profile);
  const decisionAnalysis = buildPolibotDecisionAnalysis({
    profile,
    catalogItems,
    premiumCatalogItems,
    premiumReferences: sourcePremiumReferences,
    keywordText,
    name
  });
  const evidenceIntegrity = decisionAnalysis.evidenceIntegrity || {};
  const reviewSummary = buildPolibotRecommendationReview({
    decisionAnalysis,
    evidenceIntegrity,
    catalogCautions,
    selectedPremium
  });
  const advisorExplanation = buildPolibotAdvisorExplanation({
    profile,
    name,
    decisionAnalysis,
    selectedPremium,
    catalogItems
  });
  const decisionScoreValue = Number(decisionAnalysis.decisionScore?.score || 0);
  const integrityScoreValue = Number(evidenceIntegrity.score || 0);
  const purposeScoreValue = Number(decisionAnalysis.purposeAnalysis?.score || 0);
  const blendedScore = Math.round((score * 0.34) + (decisionScoreValue * 0.28) + (integrityScoreValue * 0.2) + (purposeScoreValue * 0.18));
  const severeBudgetOverrun = ['severe_over_budget', 'reference_severe_over_budget'].includes(decisionAnalysis.premiumFit?.level)
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.status === 'severe_over_budget');
  const moderateBudgetOverrun = ['over_budget', 'reference_over_budget'].includes(decisionAnalysis.premiumFit?.level)
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.status === 'over_budget');
  const ageBlocked = (decisionAnalysis.ageChecks || []).some((item) => item.status === 'blocked')
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.age?.status === 'blocked');
  const purposeMismatch = (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.purposeMismatch);
  const adjustedScore = Math.max(0, Math.min(
    evidenceIntegrity.score < 62 ? 58 : evidenceIntegrity.score < 82 ? 78 : 96,
    ageBlocked ? 58 : 96,
    purposeMismatch ? 68 : 96,
    severeBudgetOverrun ? 72 : moderateBudgetOverrun ? 84 : 96,
    blendedScore
  ));
  return {
    id: `polibot-rec-${hashText(`${type}-${name}-${index}-${Date.now()}`)}`,
    type,
    name,
    score: adjustedScore,
    headline: type === 'bundle' ? '근거 자료를 묶어 만든 추천 조합이에요.' : '근거 자료에서 찾은 단품 추천이에요.',
    reason: `${keywordText} 자료가 고객 니즈와 맞아요.`,
    advisorExplanation,
    coverageGap: gapText ? `${gapText} 공백 점검` : '보장 공백 확인',
    decisionAnalysis,
    premium: premiumMemo,
    targetPremium: premiumPlan.targetPremium,
    currentPremium: premiumPlan.currentPremium,
    additionalBudgetMemo: premiumPlan.additionalBudgetMemo,
    premiumConfidence: selectedPremium.confidence,
    selectedPremiumExample: selectedPremium.selected,
    cautions: catalogCautions.length ? catalogCautions : normalizePolibotCautions(sources.flatMap((source) => source.cautions || []), profile),
    recommendationStatus: reviewSummary.status,
    recommendationStatusLabel: reviewSummary.label,
    reviewSummary,
    reviewReasons: [...reviewSummary.blockers, ...reviewSummary.reasons].slice(0, 8),
    routineChecks: reviewSummary.routineChecks,
    keywords: keywordHits.length ? keywordHits : itemKeywords,
    catalogItems: catalogItems.map((item) => ({
      id: item.id || '',
      sourceId: item.sourceId || '',
      productName: item.productName,
      company: item.company,
      productGroup: item.productGroup,
      coverageKeywords: item.coverageKeywords || [],
      ageRange: item.ageRange || '',
      paymentTerm: item.paymentTerm || '',
      renewalType: item.renewalType || '',
      disclosureMemo: item.disclosureMemo || '',
      reductionMemo: item.reductionMemo || '',
      premiumExample: item.premiumExample || '',
      premiumExamples: item.premiumExamples || [],
      premiumTableRows: item.premiumTableRows || [],
      premiumConfidence: item.premiumConfidence || '',
      refundRate: item.refundRate || '',
      coverageDetails: item.coverageDetails || [],
      coverageTableRows: item.coverageTableRows || [],
      conditionDetails: item.conditionDetails || {},
      conditionRules: item.conditionRules || item.conditionDetails?.conditionRules || {},
      linkedBenefitGroups: item.linkedBenefitGroups || [],
      evidenceAnchors: item.evidenceAnchors || [],
      decisionBreakdown: polibotItemDecisionBreakdown(item, profile),
      targetAudience: item.targetAudience || [],
      excludedAudience: item.excludedAudience || [],
      cautionMemo: item.cautionMemo || '',
      completeness: item.completeness || '부족',
      displayKind: item.displayKind || polibotCatalogItemKind(item),
      evidenceFile: item.evidenceFile || '',
      evidenceMonth: item.evidenceMonth || '',
      conflictReasons: item.conflictReasons || []
    })),
    sourceCompanies,
    evidence: sources.map((source) => polibotEvidencePayload(source, profile.catalogReviews)),
    confidence: polibotConfidence({ profile, sources, keywordHits, productNames, qualityReport: profile.qualityReport }),
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    nextQuestions: [...new Set([
      ...(decisionAnalysis.nextQuestions || []),
      ...(profile.consultationDraft?.nextQuestions || [])
    ])].slice(0, 8),
    createdAt: now()
  };
}

export async function savePolibotRecommendation(userId, {
  name = '',
  age = '',
  gender = '',
  needs = '',
  budget = '',
  company = '',
  existingMedicalPlan = '',
  existingPremium = '',
  medicalHistory = '',
  familyHistory = '',
  driving = '',
  renewalPreference = '',
  purpose = ''
} = {}) {
  const profile = {
    name: String(name || '').trim(),
    age: String(age || '').trim(),
    gender: String(gender || '').trim(),
    needs: normalizeList(needs),
    budget: String(budget || '').trim(),
    company: String(company || '').trim() || '전체 보험사',
    existingMedicalPlan: String(existingMedicalPlan || '').trim(),
    existingPremium: String(existingPremium || '').trim(),
    medicalHistory: String(medicalHistory || '').trim(),
    familyHistory: String(familyHistory || '').trim(),
    driving: String(driving || '').trim(),
    renewalPreference: String(renewalPreference || '').trim(),
    purpose: POLIBOT_PURPOSES.includes(String(purpose || '').trim()) ? String(purpose || '').trim() : String(purpose || '').trim()
  };
  const premiumPlan = buildPolibotPremiumPlan(profile);
  profile.targetPremium = premiumPlan.targetPremium;
  profile.currentPremium = premiumPlan.currentPremium;
  profile.additionalBudgetMemo = premiumPlan.additionalBudgetMemo;
  if (!profile.age && profile.needs.length === 0 && !profile.budget) {
    const error = new Error('고객 나이, 니즈, 예산 중 하나 이상을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const seed = hashText(JSON.stringify(profile));
  const workspace = await getProductWorkspace(userId, 'polibot');
  const knowledgeSources = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [];
  const recommendationKnowledgeSources = knowledgeSources.filter(isPolibotRecommendationEligibleSource);
  const catalogReviews = normalizeCatalogReviews(workspace.catalogReviews);
  const qualityReport = knowledgeSources.length && knowledgeSources.every((source) => source.dbSourceId)
    ? buildPolibotDbQualityReport(knowledgeSources)
    : buildPolibotQualityReport(knowledgeSources, catalogReviews);
  const consultationDraft = buildPolibotConsultationDraft(profile, qualityReport);
  const missingForRecommendation = [
    !profile.age && '나이',
    !profile.gender && '성별',
    profile.needs.length === 0 && '필요 보장',
    !profile.budget && '예산',
    !profile.existingMedicalPlan && '기존 실손 여부',
    !profile.medicalHistory && '병력/고지 이슈'
  ].filter(Boolean);
  const riskHoldReasons = [
    !profile.existingMedicalPlan && '기존 실손 여부',
    profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' && '실손 중복 여부',
    !profile.medicalHistory && '병력/고지 이슈',
    /있음|예|확인|수술|입원|투약|치료|진단/i.test(profile.medicalHistory) && '고지 상세',
    profile.budget && Number(String(profile.budget).replace(/[^\d.]/g, '')) > 0 && Number(String(profile.budget).replace(/[^\d.]/g, '')) < 5 && '예산 조건'
  ].filter(Boolean);
  const hardMissing = [
    !profile.age && '나이',
    profile.needs.length === 0 && '필요 보장',
    !profile.budget && '예산'
  ].filter(Boolean);
  if (hardMissing.length > 0) {
    const patch = {
      customerProfile: profile,
      consultationDraft,
      qualityReport,
      recommendations: [],
      excludedCandidates: [],
    recommendationNotice: `추천 전에 ${(hardMissing.length ? hardMissing : missingForRecommendation).slice(0, 4).join(', ')} 정보를 먼저 확인해 주세요. 고객 조건이 부족해서 사용 횟수는 차감하지 않았어요.`
    };
    patch.knowledgeSnapshot = buildPolibotKnowledgeSnapshot({
      workspace,
      evidence: [],
      recommendations: [],
      recommendationNotice: patch.recommendationNotice
    });
    return updateWorkspace(userId, 'polibot', patch);
  }
  const enrichedProfile = { ...profile, qualityReport, consultationDraft, catalogReviews, riskHoldReasons };
  const rankedEvidence = rankPolibotEvidence(recommendationKnowledgeSources, profile);
  const evidence = rankedEvidence
    .filter((source) => Number(source.matchScore || 0) >= 9
      || (source.keywordHits || []).length > 0
      || sourceCatalogItems(source, catalogReviews).some((item) => catalogItemMatchesNeeds(item, profile.needs)))
    .slice(0, 12);
  const productEvidence = rankedEvidence
    .filter((source) => sourceCatalogItems(source, catalogReviews).some((item) => catalogItemMatchesNeeds(item, profile.needs)))
    .slice(0, 6);
  const recommendationEvidence = productEvidence;
  const labels = recommendationEvidence.map((source) => source.productGroup || '보장 검토');
  const singleRecommendations = labels.slice(0, 4).map((label, index) => buildPolibotRecommendation({
    profile: enrichedProfile,
    evidence: recommendationEvidence,
    label,
    type: 'single',
    index,
    seed
  }));
  const bundleRecommendations = recommendationEvidence.length >= 2 ? [0, 1].map((offset) => buildPolibotRecommendation({
    profile: enrichedProfile,
    evidence: recommendationEvidence,
    label: offset === 0 ? '질병/실손' : '생활비/간병',
    type: 'bundle',
    index: offset,
    seed: seed + 17
  })) : [];
  const recommendations = [...singleRecommendations, ...bundleRecommendations]
    .filter((item) => item && item.evidence.length > 0)
    .sort((a, b) => b.score - a.score)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index)
    .slice(0, 3);
  const recommendationNotice = recommendations.length
    ? (riskHoldReasons.length ? `${riskHoldReasons.slice(0, 3).join(', ')} 확인이 필요해요. 추천 후보의 주의 조건에 표시했어요.` : '')
    : (qualityReport.recommendableProducts > 0
      ? '추천 가능한 상품은 있지만 입력한 고객 조건과 직접 맞는 조합을 찾지 못했어요. 니즈, 예산, 보험사 조건을 조금 더 구체화해 주세요.'
      : '추천 가능한 확정 상품 데이터가 부족해요. 상품 비교표나 설계 자료를 추가하거나 검토 필요 후보를 먼저 정리해 주세요.');
  const knowledgeSnapshot = buildPolibotKnowledgeSnapshot({
    workspace,
    evidence: recommendationEvidence.length ? recommendationEvidence : evidence,
    recommendations,
    recommendationNotice
  });
  const recommendationsWithSnapshot = recommendations.map((recommendation) => ({
    ...recommendation,
    knowledgeSnapshot: {
      createdAt: knowledgeSnapshot.createdAt,
      latestKnowledgeMonth: knowledgeSnapshot.latestKnowledgeMonth,
      dbSummary: knowledgeSnapshot.dbSummary,
      usedSourceIds: knowledgeSnapshot.usedSources.map((source) => source.sourceId).filter(Boolean),
      usedCatalogItems: knowledgeSnapshot.usedCatalogItems
        .filter((item) => (recommendation.catalogItems || []).some((candidate) => candidate.productName === item.productName && candidate.company === item.company))
        .slice(0, 10)
    }
  }));
  const patch = {
    customerProfile: profile,
    consultationDraft,
    qualityReport,
    recommendations: recommendationsWithSnapshot,
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    recommendationNotice,
    knowledgeSnapshot
  };
  return recommendationsWithSnapshot.length
    ? updateWorkspaceAndConsume(userId, 'polibot', patch)
    : updateWorkspace(userId, 'polibot', patch);
}

export async function listPolibotCatalogReview(userId) {
  const workspace = await getProductWorkspace(userId, 'polibot');
  return {
    qualityReport: workspace.qualityReport || {},
    catalogReviews: normalizeCatalogReviews(workspace.catalogReviews)
  };
}

export async function savePolibotCatalogReviews(userId, reviews = {}) {
  const workspace = await getProductWorkspace(userId, 'polibot');
  const currentReviews = normalizeCatalogReviews(workspace.catalogReviews);
  const nextReviews = normalizeCatalogReviews({
    ...currentReviews,
    ...reviews
  });
  return updateWorkspace(userId, 'polibot', {
    catalogReviews: nextReviews
  });
}

export async function savePolibotCustomer(userId, { id = '', name = '', age = '', memo = '', recommendationId = '', selectedRecommendation = null, profile = null } = {}) {
  const workspace = await getProductWorkspace(userId, 'polibot');
  const currentProfile = profile && typeof profile === 'object'
    ? profile
    : {
      ...(workspace.customerProfile || {}),
      name,
      age
    };
  const recommendation = selectedRecommendation && typeof selectedRecommendation === 'object'
    ? selectedRecommendation
    : (workspace.recommendations || []).find((item) => item.id === recommendationId);
  const customers = Array.isArray(workspace.customers) ? workspace.customers : [];
  const existing = customers.find((item) => item.id === id);
  const customer = {
    id: String(id || '').trim() || `polibot-customer-${hashText(`${currentProfile.name || name}-${currentProfile.age || age}-${Date.now()}`)}`,
    name: String(name || currentProfile.name || '').trim() || '이름 미입력',
    age: String(age || currentProfile.age || '').trim(),
    gender: String(currentProfile.gender || '').trim(),
    needs: Array.isArray(currentProfile.needs) ? currentProfile.needs : [],
    budget: String(currentProfile.budget || '').trim(),
    existingMedicalPlan: String(currentProfile.existingMedicalPlan || '').trim(),
    existingPremium: String(currentProfile.existingPremium || '').trim(),
    medicalHistory: String(currentProfile.medicalHistory || '').trim(),
    familyHistory: String(currentProfile.familyHistory || '').trim(),
    driving: String(currentProfile.driving || '').trim(),
    renewalPreference: String(currentProfile.renewalPreference || '').trim(),
    purpose: String(currentProfile.purpose || '').trim(),
    memo: String(memo || '').trim(),
    selectedRecommendation: recommendation || existing?.selectedRecommendation || null,
    recommendations: Array.isArray(workspace.recommendations) && workspace.recommendations.length ? workspace.recommendations : existing?.recommendations || [],
    consultationDraft: workspace.consultationDraft || existing?.consultationDraft || null,
    excludedCandidates: workspace.excludedCandidates || existing?.excludedCandidates || [],
    knowledgeSnapshot: workspace.knowledgeSnapshot || recommendation?.knowledgeSnapshot || existing?.knowledgeSnapshot || null,
    updatedAt: now(),
    createdAt: existing?.createdAt || now()
  };
  const withoutCurrent = customers.filter((item) => item.id !== customer.id);
  return updateWorkspace(userId, 'polibot', {
    customers: [customer, ...withoutCurrent].slice(0, 100)
  });
}

const POLIBOT_FEEDBACK_MAP = {
  '좋음': 'good',
  good: 'good',
  '애매함': 'unclear',
  unclear: 'unclear',
  '틀림': 'wrong',
  wrong: 'wrong'
};

function normalizePolibotFeedback(value = '') {
  const key = String(value || '').trim();
  return POLIBOT_FEEDBACK_MAP[key] || '';
}

function buildPolibotFeedbackLearningSignal({ target = {}, normalizedRating = '', reason = '', memo = '' } = {}) {
  const reasonText = `${reason || ''} ${memo || ''}`;
  const flags = [
    /상품명/.test(reasonText) && '상품명 추출/확정 규칙 검수',
    /보장|담보|매칭/.test(reasonText) && '담보 매칭 가중치 보정',
    /조건|가입|연령|고지|병력|심사/.test(reasonText) && '가입조건/고지 판단 보정',
    /보험료|가격|예산/.test(reasonText) && '보험료 연결/예산 판단 보정',
    /설명|이유|근거/.test(reasonText) && '상담 설명문 보강'
  ].filter(Boolean);
  return {
    rating: normalizedRating,
    shouldReview: normalizedRating !== 'good',
    productNames: [...new Set((target.catalogItems || []).map((item) => item.productName).filter(Boolean))].slice(0, 6),
    companies: [...new Set((target.catalogItems || []).map((item) => item.company).filter(Boolean))].slice(0, 6),
    evidenceFiles: [...new Set((target.evidence || []).map((item) => item.fileName).filter(Boolean))].slice(0, 6),
    reasonFlags: flags.length ? flags : [normalizedRating === 'good' ? '정상 추천 패턴' : '상담사 검수 필요'],
    memo: String(memo || '').trim().slice(0, 400)
  };
}

export async function savePolibotRecommendationFeedback(userId, {
  recommendationId = '',
  feedback = '',
  rating = '',
  reason = '',
  memo = '',
  customerId = ''
} = {}) {
  const normalizedRating = normalizePolibotFeedback(rating || feedback);
  if (!recommendationId || !normalizedRating) {
    const error = new Error('recommendationId와 feedback은 필수입니다.');
    error.status = 400;
    throw error;
  }
  const workspace = await getProductWorkspace(userId, 'polibot');
  const recommendations = Array.isArray(workspace.recommendations) ? workspace.recommendations : [];
  const target = recommendations.find((item) => item.id === recommendationId);
  if (!target) {
    const error = new Error('추천 항목을 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  const labelByRating = { good: '좋음', unclear: '애매함', wrong: '틀림' };
  const learningSignal = buildPolibotFeedbackLearningSignal({ target, normalizedRating, reason, memo });
  const feedbackPatch = {
    feedback: labelByRating[normalizedRating],
    feedbackRating: normalizedRating,
    feedbackReason: String(reason || '').trim(),
    feedbackMemo: String(memo || '').trim(),
    feedbackSavedAt: now()
  };
  const nextRecommendations = recommendations.map((item) => item.id === recommendationId
    ? { ...item, ...feedbackPatch }
    : item);
  const feedbackRow = await dbInsert('polibot_recommendation_feedback', {
    user_id: userId,
    recommendation_id: recommendationId,
    customer_id: String(customerId || '').trim() || null,
    rating: normalizedRating,
    reason: feedbackPatch.feedbackReason,
    memo: feedbackPatch.feedbackMemo,
    recommendation_snapshot: {
      id: target.id,
      name: target.name,
      type: target.type,
      score: target.score,
      reviewReasons: target.reviewReasons || [],
      advisorExplanation: target.advisorExplanation || [],
      learningSignal,
      cautions: target.cautions || [],
      catalogItems: target.catalogItems || [],
      evidence: target.evidence || []
    },
    knowledge_snapshot: target.knowledgeSnapshot || workspace.knowledgeSnapshot || {},
    routed_to_review: normalizedRating !== 'good'
  });
  const nextWorkspace = await updateWorkspace(userId, 'polibot', {
    recommendations: nextRecommendations,
    feedbackSummary: {
      ...(workspace.feedbackSummary || {}),
      lastFeedbackAt: feedbackPatch.feedbackSavedAt,
      lastFeedback: normalizedRating,
      lastLearningFlags: learningSignal.reasonFlags,
      total: Number(workspace.feedbackSummary?.total || 0) + 1,
      needsReview: Number(workspace.feedbackSummary?.needsReview || 0) + (normalizedRating === 'good' ? 0 : 1)
    }
  });
  return {
    ...nextWorkspace,
    feedback: feedbackRow
  };
}

export async function saveSpreadCampaign(userId, { goal = '', channel = '', product = '' } = {}) {
  const cleanGoal = String(goal || '').trim();
  const cleanChannel = String(channel || '').trim();
  const cleanProduct = String(product || '').trim();
  if (!cleanGoal && !cleanChannel && !cleanProduct) {
    const error = new Error('캠페인 정보를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const draft = {
    id: `spread-campaign-${Date.now()}-${hashText(`${cleanGoal}-${cleanChannel}-${cleanProduct}`)}`,
    title: `${cleanProduct || '제품'} 체험단`,
    goal: cleanGoal,
    channel: cleanChannel,
    product: cleanProduct,
    status: 'draft',
    headline: `${cleanProduct || '제품'} 캠페인 운영 초안`,
    mission: `${cleanChannel || '주요 채널'}에서 ${cleanGoal || '참여자 모집'}을 진행합니다.`,
    checklist: ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    applicants: [],
    submissionReview: null,
    createdAt: now(),
    updatedAt: now()
  };
  const workspace = await getProductWorkspace(userId, 'spread');
  const campaigns = normalizeSpreadCampaigns(workspace);
  return updateWorkspaceAndConsume(userId, 'spread', {
    campaigns: [draft, ...campaigns],
    selectedCampaignId: draft.id,
    campaignDraft: draft
  });
}

function campaignFromLegacyDraft(draft = {}, workspace = {}) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    id: draft.id || `spread-campaign-${hashText(JSON.stringify(draft))}`,
    title: draft.title || draft.headline || `${draft.product || '제품'} 체험단`,
    goal: draft.goal || '',
    channel: draft.channel || '',
    product: draft.product || '',
    status: draft.status || 'draft',
    headline: draft.headline || `${draft.product || '제품'} 캠페인 운영 초안`,
    mission: draft.mission || `${draft.channel || '주요 채널'}에서 ${draft.goal || '참여자 모집'}을 진행합니다.`,
    checklist: Array.isArray(draft.checklist) ? draft.checklist : ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    applicants: Array.isArray(draft.applicants) ? draft.applicants : (Array.isArray(workspace.applicants) ? workspace.applicants : []),
    submissionReview: draft.submissionReview || workspace.submissionReview || null,
    createdAt: draft.createdAt || now(),
    updatedAt: draft.updatedAt || draft.createdAt || now()
  };
}

function normalizeSpreadCampaigns(workspace = {}) {
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
  const normalized = campaigns.map((campaign) => campaignFromLegacyDraft(campaign, workspace)).filter(Boolean);
  if (normalized.length === 0 && workspace.campaignDraft) {
    const legacy = campaignFromLegacyDraft(workspace.campaignDraft, workspace);
    if (legacy) normalized.push(legacy);
  }
  return normalized;
}

function selectedSpreadCampaign(workspace = {}, campaignId = '') {
  const campaigns = normalizeSpreadCampaigns(workspace);
  const selectedId = campaignId || workspace.selectedCampaignId || campaigns[0]?.id || '';
  return {
    campaigns,
    selectedId,
    selected: campaigns.find((campaign) => campaign.id === selectedId) || campaigns[0] || null
  };
}

function upsertSelectedSpreadCampaign(workspace = {}, campaignId = '', updater = (campaign) => campaign) {
  const { campaigns, selectedId, selected } = selectedSpreadCampaign(workspace, campaignId);
  if (!selected) return { campaigns, selectedCampaignId: selectedId, selectedCampaign: null };
  const nextCampaign = {
    ...updater(selected),
    updatedAt: now()
  };
  const nextCampaigns = campaigns.map((campaign) => campaign.id === nextCampaign.id ? nextCampaign : campaign);
  return {
    campaigns: nextCampaigns,
    selectedCampaignId: nextCampaign.id,
    campaignDraft: nextCampaign,
    selectedCampaign: nextCampaign
  };
}

export async function updateSpreadCampaignStatus(userId, { campaignId = '', status = '' } = {}) {
  const allowedStatuses = new Set(['draft', 'recruiting', 'selecting', 'reviewing', 'completed']);
  if (!allowedStatuses.has(status)) {
    const error = new Error('지원하지 않는 캠페인 상태입니다.');
    error.status = 400;
    throw error;
  }
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status
  }));
  if (!patch.selectedCampaign) {
    const error = new Error('상태를 변경할 캠페인을 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  return updateWorkspace(userId, 'spread', patch);
}

export async function saveSpreadApplicants(userId, { applicants = '', criteria = '', campaignId = '' } = {}) {
  const criteriaList = normalizeList(criteria);
  const applicantList = normalizeList(applicants);
  if (applicantList.length === 0) {
    const error = new Error('신청자 목록을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const rows = applicantList.map((name, index) => {
    const score = 55 + (hashText(`${name}-${criteria}`) % 41);
    return {
      id: `spread-applicant-${hashText(`${name}-${index}`)}`,
      name,
      score,
      status: score >= 80 ? '우선 선정' : score >= 68 ? '검토' : '보류',
      reason: criteriaList[0] || '기본 선정 기준',
      createdAt: now()
    };
  });
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status: 'selecting',
    applicants: rows,
    applicantCriteria: criteriaList
  }));
  return updateWorkspaceAndConsume(userId, 'spread', {
    ...patch,
    applicantCriteria: criteriaList,
    applicants: rows
  });
}

export async function reviewSpreadSubmission(userId, { url = '', required = '', forbidden = '', campaignId = '' } = {}) {
  const requiredList = normalizeList(required);
  const forbiddenList = normalizeList(forbidden);
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl && requiredList.length === 0 && forbiddenList.length === 0) {
    const error = new Error('제출물 검수 기준을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const checks = [
    { label: '제출 URL', passed: /^https?:\/\//i.test(normalizedUrl), detail: normalizedUrl || 'URL 없음' },
    ...requiredList.map((keyword) => ({ label: `필수 키워드: ${keyword}`, passed: false, detail: '본문 연결 전 수동 확인 필요' })),
    ...forbiddenList.map((keyword) => ({ label: `금지 표현: ${keyword}`, passed: true, detail: '입력 URL 단계에서는 감지 없음' }))
  ];
  const submissionReview = {
    url: normalizedUrl,
    required: requiredList,
    forbidden: forbiddenList,
    checks,
    reviewedAt: now()
  };
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status: 'reviewing',
    submissionReview
  }));
  return updateWorkspaceAndConsume(userId, 'spread', {
    ...patch,
    submissionReview
  });
}
