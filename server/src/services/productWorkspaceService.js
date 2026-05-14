import { PRODUCTS, productById } from '../config/products.js';
import AdmZip from 'adm-zip';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
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

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread', 'polibot', 'infludex', 'auvibot']);
const DEFAULT_USAGE_LIMIT = 5;
const UNLIMITED_TEST_EMAILS = new Set(['test1@test.com']);
const UNLIMITED_USAGE_LIMIT = 999999;
const DEXOR_SCORE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const INFLUDEX_GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const DEXOR_CATEGORIES = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];

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
  if (knowledgeCount === 0) return { health: 'needs_setup', summary: '보험 상품 PDF나 지식 자료를 먼저 넣어야 해요.', nextAction: 'PDF 업로드', actionKey: 'polibot-upload', usage };
  return { health: 'empty', summary: `${knowledgeCount}개 자료가 준비됐어요. 고객 조건을 넣어 추천을 만들 수 있어요.`, nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
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
  const range = text.match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[2]);
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;
  return /원/.test(text) && !/만원/.test(text) ? amount / 10000 : amount;
}

function formatPolibotPremiumAmount(value) {
  if (!Number.isFinite(Number(value))) return '';
  return `${Number(value).toLocaleString('ko-KR')}만원`;
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
    const currentKnowledge = Array.isArray(next.knowledgeSources) ? next.knowledgeSources : [];
    const dbKnowledge = await listPolibotDbKnowledgeSources(userId);
    const seedKnowledge = polibotSeedKnowledgeSources();
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
    next.qualityReport = buildPolibotQualityReport(next.knowledgeSources, catalogReviews);
    next.knowledgeDbSummary = await getPolibotDbKnowledgeSummary(userId);
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
    reviewNeededCatalogItems: summary.reviewNeededCatalogItems || 0,
    conflictCatalogItems: summary.conflictCatalogItems || 0,
    privacyRiskSources: summary.privacyRiskSources || 0,
    highQualitySources: summary.highQualitySources || 0
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
    .filter((item) => item.status === 'confirmed' && Number(item.confidence || 0) >= 80 && ['충분', '보통'].includes(item.completeness || '부족'));
}

function catalogItemMatchesNeeds(item = {}, needs = []) {
  if (!Array.isArray(needs) || needs.length === 0) return true;
  const haystack = [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : [])
  ].filter(Boolean).join(' ');
  return needs.some((need) => haystack.includes(need) || String(need || '').includes(item.productGroup || ''));
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
  const allItems = buildPolibotCatalogItems([source], { includeReview: true, reviews });
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
  const allCatalogItems = buildPolibotCatalogItems(knowledgeSources, { includeReview: true, reviews });
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

function buildPolibotExcludedCandidates(evidence = [], profile = {}) {
  return evidence
    .filter((source) => sourceCatalogItems(source, profile.catalogReviews).length === 0)
    .slice(0, 4)
    .map((source) => ({
      name: source.fileName || '자료명 미입력',
      reason: source.fileType === 'image'
        ? 'OCR 전 이미지 자료라 상품명을 확인하지 못했어요.'
        : source.keywordHits?.length ? '니즈 키워드는 있지만 실제 상품명이 부족해요.' : '고객 니즈와 직접 연결되는 근거가 약해요.',
      fileName: source.fileName,
      month: source.month
    }));
}

function buildPolibotRecommendation({ profile, evidence, label, type, index, seed }) {
  const sources = evidence.slice(index, index + (type === 'bundle' ? 3 : 1));
  const primary = sources[0] || {};
  const keywordHits = [...new Set(sources.flatMap((source) => source.keywordHits || []).filter(Boolean))].slice(0, 6);
  const productGroup = primary.productGroup || label;
  const rawCatalogItems = sources.flatMap((source) => sourceCatalogItems(source, profile.catalogReviews));
  const needMatchedItems = rawCatalogItems.filter((item) => catalogItemMatchesNeeds(item, profile.needs));
  const catalogItems = needMatchedItems.length ? needMatchedItems : rawCatalogItems;
  const productNames = [...new Set(catalogItems.map((item) => item.productName).filter(Boolean))];
  if (productNames.length === 0) return null;
  if (type === 'bundle' && productNames.length < 2) return null;
  const sourceCompanies = [...new Set(catalogItems.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))];
  const mainName = productNames[0];
  const prefix = sourceCompanies[0] && !mainName.includes(sourceCompanies[0]) ? `${sourceCompanies[0]} ` : '';
  const name = type === 'bundle'
    ? `${productNames.slice(0, 2).join(' + ')} 조합`
    : `${prefix}${mainName}`;
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
  const premiumMemo = catalogItems.find((item) => item.premiumExample && item.premiumConfidence !== 'none')?.premiumExample
    || '보험료 자료 없음';
  const premiumPlan = buildPolibotPremiumPlan(profile);
  return {
    id: `polibot-rec-${hashText(`${type}-${name}-${index}-${Date.now()}`)}`,
    type,
    name,
    score,
    headline: type === 'bundle' ? '근거 자료를 묶어 만든 추천 조합이에요.' : '근거 자료에서 찾은 단품 추천이에요.',
    reason: `${keywordText} 자료가 고객 니즈와 맞아요.`,
    coverageGap: gapText ? `${gapText} 공백 점검` : '보장 공백 확인',
    premium: premiumMemo,
    targetPremium: premiumPlan.targetPremium,
    currentPremium: premiumPlan.currentPremium,
    additionalBudgetMemo: premiumPlan.additionalBudgetMemo,
    premiumConfidence: premiumMemo === '보험료 자료 없음' ? 'none' : 'confirmed',
    cautions: catalogCautions.length ? catalogCautions : normalizePolibotCautions(sources.flatMap((source) => source.cautions || []), profile),
    recommendationStatus: catalogCautions.length ? 'needs_review' : 'ready',
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
      premiumConfidence: item.premiumConfidence || '',
      refundRate: item.refundRate || '',
      targetAudience: item.targetAudience || [],
      excludedAudience: item.excludedAudience || [],
      cautionMemo: item.cautionMemo || '',
      completeness: item.completeness || '부족',
      evidenceFile: item.evidenceFile || '',
      evidenceMonth: item.evidenceMonth || '',
      conflictReasons: item.conflictReasons || []
    })),
    sourceCompanies,
    evidence: sources.map((source) => polibotEvidencePayload(source, profile.catalogReviews)),
    confidence: polibotConfidence({ profile, sources, keywordHits, productNames, qualityReport: profile.qualityReport }),
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    nextQuestions: profile.consultationDraft?.nextQuestions || [],
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
  const qualityReport = buildPolibotQualityReport(knowledgeSources, catalogReviews);
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
    profile.renewalPreference === '비갱신 선호' && '갱신형 부담',
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
    .slice(0, 6);
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
