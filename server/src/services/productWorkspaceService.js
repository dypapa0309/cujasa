import { productById } from '../config/products.js';
import { dbGet, dbUpdate } from './supabaseService.js';
import {
  buildPolibotCatalog,
  buildPolibotCatalogItems,
  inferPolibotFileType,
  normalizePolibotKnowledgeItems,
  polibotSeedKnowledgeSources,
  rankPolibotEvidence
} from './polibotKnowledgeService.js';

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread', 'polibot', 'infludex']);
const DEFAULT_USAGE_LIMIT = 5;
const DEXOR_SCORE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const INFLUDEX_GRADE_ORDER = { DIAMOND: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
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
  if (score >= 94) return 'DIAMOND';
  if (score >= 86) return 'S';
  if (score >= 74) return 'A';
  if (score >= 60) return 'B';
  if (score >= 45) return 'C';
  return 'D';
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
  rows.forEach((line, index) => {
    const cells = splitCandidateLine(line);
    const joined = cells.join(' ');
    if (index === 0 && /url|계정|핸들|handle|category|카테고리/i.test(joined) && !/^https?:\/\//i.test(cells[0] || '') && !String(cells[0] || '').startsWith('@')) return;
    const url = cells.find((cell) => /^https?:\/\//i.test(cell)) || '';
    const handle = cells.find((cell) => /^@?[a-zA-Z0-9._]{2,50}$/.test(cell) && !/^\d+$/.test(cell)) || (url.match(/instagram\.com\/([^/?#]+)/i)?.[1] || '');
    if (!url && !handle) return;
    const metaCells = cells.filter((cell) => cell !== url && cell !== handle);
    const recentPostAt = metaCells.find((cell) => /\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cell)) || '';
    const numbers = metaCells.map(parseNumberLike).filter((value) => value !== null);
    const category = metaCells.find((cell) => cell && cell !== recentPostAt && parseNumberLike(cell) === null && !/광고|협찬|체험단|스폰서/i.test(cell)) || '';
    const adMemo = metaCells.find((cell) => /광고|협찬|체험단|스폰서|상업/i.test(cell)) || '';
    candidates.push({
      id: `infludex-${hashText(`${url || handle}-${index}`)}`,
      url,
      handle: String(handle || '').replace(/^@/, ''),
      category,
      followerCount: numbers[0] ?? null,
      avgLikes: numbers[1] ?? null,
      avgComments: numbers[2] ?? null,
      recentPostAt,
      adMemo,
      source: fileName ? 'file-or-manual' : 'manual',
      createdAt: now()
    });
  });
  return candidates
    .filter((item, index, all) => all.findIndex((row) => (row.url || row.handle) === (item.url || item.handle)) === index)
    .slice(0, 500);
}

function normalizeList(input = '') {
  return String(input)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);
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
  return grant;
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
  return withUsage(settings.workspace || next.workspace, settings, productId);
}

async function updateWorkspaceAndConsume(userId, productId, patch) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const usage = normalizeUsage(current, productId);
  if (usage.remaining <= 0) {
    const error = new Error('무료 사용 횟수를 모두 사용했습니다.');
    error.status = 402;
    throw error;
  }
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
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

export async function getProductWorkspace(userId, productId) {
  const grant = await getGrant(userId, productId);
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const next = { ...workspace };
  if (Array.isArray(next.analysisResults)) next.analysisResults = sortDexorResults(next.analysisResults);
  if (Array.isArray(next.infludexResults)) next.infludexResults = sortInfludexResults(next.infludexResults);
  if (productId === 'polibot') {
    const currentKnowledge = Array.isArray(next.knowledgeSources) ? next.knowledgeSources : [];
    const seedKnowledge = polibotSeedKnowledgeSources();
    const merged = [...currentKnowledge, ...seedKnowledge];
    next.knowledgeSources = merged
      .filter((item, index, all) => all.findIndex((row) => row.id === item.id || `${row.month}-${row.fileName}` === `${item.month}-${item.fileName}`) === index)
      .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
      .slice(0, 500)
      .map((source) => ({
        ...source,
        catalogItems: sourceCatalogItems(source)
      }));
    next.latestKnowledgeMonth = next.knowledgeSources[0]?.month || next.latestKnowledgeMonth || '';
    next.catalog = buildPolibotCatalog(next.knowledgeSources);
    next.qualityReport = buildPolibotQualityReport(next.knowledgeSources);
  }
  return withUsage(next, settings, productId);
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

export async function saveInfludexCandidates(userId, { rows = '', fileName = '' } = {}) {
  const candidates = parseInfludexRows(rows, fileName);
  if (candidates.length === 0) {
    const error = new Error('인스타그램 후보를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  return updateWorkspace(userId, 'infludex', {
    candidates,
    fileName: String(fileName || '').trim(),
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
    const hash = hashText(candidate.url || candidate.handle);
    const followers = Number(candidate.followerCount || 0);
    const likes = Number(candidate.avgLikes || 0);
    const comments = Number(candidate.avgComments || 0);
    const engagementRate = followers > 0 ? ((likes + comments) / followers) * 100 : 0;
    const categoryBonus = candidate.category ? 6 : 0;
    const followerBonus = followers >= 100000 ? 12 : followers >= 30000 ? 9 : followers >= 10000 ? 6 : followers >= 3000 ? 3 : 0;
    const engagementBonus = engagementRate >= 6 ? 14 : engagementRate >= 3 ? 9 : engagementRate >= 1.5 ? 5 : 0;
    const recentTime = candidate.recentPostAt ? new Date(candidate.recentPostAt.replace(/[./]/g, '-')).getTime() : 0;
    const daysSinceRecent = recentTime ? Math.floor((Date.now() - recentTime) / (24 * 60 * 60 * 1000)) : null;
    const freshnessBonus = daysSinceRecent === null ? 0 : daysSinceRecent <= 10 ? 8 : daysSinceRecent <= 30 ? 4 : daysSinceRecent <= 60 ? 0 : -8;
    const adPenalty = candidate.adMemo ? 8 : 0;
    const score = Math.max(20, Math.min(99, 42 + (hash % 28) + followerBonus + engagementBonus + categoryBonus + freshnessBonus - adPenalty));
    const grade = infludexGradeFromScore(score);
    return {
      id: candidate.id,
      url: candidate.url,
      handle: candidate.handle,
      category: candidate.category || '카테고리 미입력',
      followerCount: candidate.followerCount,
      avgLikes: candidate.avgLikes,
      avgComments: candidate.avgComments,
      engagementRate: Number(engagementRate.toFixed(2)),
      score,
      grade,
      reasons: [
        candidate.category ? `카테고리 ${candidate.category}` : '카테고리 미입력',
        followers ? `팔로워 ${followers}` : '팔로워 미입력',
        engagementRate ? `평균 반응률 ${engagementRate.toFixed(2)}%` : '반응 지표 미입력',
        daysSinceRecent === null ? '최근 게시일 미입력' : daysSinceRecent <= 30 ? '최근 활동 양호' : '최근 활동 확인 필요',
        candidate.adMemo ? '광고성 메모 확인 필요' : '광고성 메모 없음'
      ],
      analyzedAt: now()
    };
  }));
  return updateWorkspaceAndConsume(userId, 'infludex', { infludexResults });
}

export async function resetInfludexWorkspace(userId) {
  return updateWorkspace(userId, 'infludex', {
    candidates: [],
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
  const workspace = await getProductWorkspace(userId, 'polibot');
  const current = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [];
  const knowledgeSources = [...items, ...current]
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, 500);
  return updateWorkspace(userId, 'polibot', {
    knowledgeSources,
    latestKnowledgeMonth: knowledgeSources[0]?.month || ''
  });
}

function polibotEvidencePayload(source = {}) {
  const catalogItems = sourceCatalogItems(source);
  return {
    fileName: source.fileName,
    month: source.month,
    company: source.company,
    companies: source.companies || [],
    productGroup: source.productGroup,
    productNames: catalogItems.map((item) => item.productName),
    catalogItems,
    keywords: source.keywordHits?.length ? source.keywordHits : source.keywords || [],
    matchScore: source.matchScore || 0,
    targetAudience: source.targetAudience || [],
    cautions: source.cautions || [],
    summary: source.summary || ''
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
    .replace(/\.(pdf|pptx?|xlsx|csv|txt)$/ig, ' ')
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

function sourceCatalogItems(source = {}) {
  const items = buildPolibotCatalogItems([source]);
  return items.filter((item) => ['confirmed', 'auto'].includes(item.status) && Number(item.confidence || 0) >= 65);
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

function classifyPolibotProducts(source = {}) {
  const rawCandidates = sourceProductNameCandidates(source).flatMap(splitPolibotProductText);
  const catalogItems = sourceCatalogItems(source);
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
    : catalogItems.length > 0
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
      review: '검수 필요',
      none: '상품명 부족'
    }[status],
    productNames: cleanNames,
    excludedPhrases: excluded,
    catalogItems
  };
}

function buildPolibotQualityReport(knowledgeSources = []) {
  const catalog = knowledgeSources.map(classifyPolibotProducts);
  const catalogItems = buildPolibotCatalogItems(knowledgeSources);
  const recommended = catalogItems.filter((item) => ['confirmed', 'auto'].includes(item.status) && item.productName);
  const review = catalog.filter((item) => item.status === 'review');
  const ocrNeeded = knowledgeSources.filter((item) => item.fileType === 'image').length;
  const excludedPhrases = catalog.flatMap((item) => item.excludedPhrases || []);
  const companies = [...new Set(knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set(knowledgeSources.map((item) => item.productGroup).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set(knowledgeSources.flatMap((item) => item.keywords || []))]
    .slice(0, 20);
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(recommended.map((item) => `${item.company}-${item.productName}`)).size,
    reviewNeededProducts: review.length,
    excludedPhrases: excludedPhrases.length,
    ocrNeeded,
    companies,
    productGroups,
    keywords,
    catalogItems: catalogItems.slice(0, 120),
    catalog: catalog.slice(0, 80)
  };
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
    qualityReport.recommendableProducts === 0 && '추천 가능한 상품명 자료 부족'
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
  if ((qualityReport?.recommendableProducts || 0) < 3) score -= 12;
  const level = score >= 72 ? '높음' : score >= 48 ? '보통' : '낮음';
  const reasons = [
    level === '낮음' && '고객 정보나 추천 가능 상품명이 부족해요.',
    !profile.medicalHistory && '고지 이슈 확인 전이라 최종 추천은 보류가 필요해요.',
    !profile.existingMedicalPlan && '기존 실손 중복 여부를 확인해야 해요.',
    (qualityReport?.recommendableProducts || 0) < 3 && '추천 가능한 상품 카탈로그가 아직 적어요.'
  ].filter(Boolean);
  return { level, score, reasons };
}

function buildPolibotExcludedCandidates(evidence = [], profile = {}) {
  return evidence
    .filter((source) => sourceCatalogItems(source).length === 0)
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
  const catalogItems = sources.flatMap(sourceCatalogItems);
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
  const keywordText = keywordHits.length ? keywordHits.join(', ') : productGroup;
  return {
    id: `polibot-rec-${hashText(`${type}-${name}-${index}-${Date.now()}`)}`,
    type,
    name,
    score,
    headline: type === 'bundle' ? '근거 자료를 묶어 만든 추천 조합이에요.' : '근거 자료에서 찾은 단품 추천이에요.',
    reason: `${keywordText} 자료가 고객 니즈와 맞아요.`,
    coverageGap: gapText ? `${gapText} 공백 점검` : '보장 공백 확인',
    premium: profile.budget ? `월 ${profile.budget}만원 안에서 조정 검토` : '예산 입력 시 보험료 메모를 더 구체화할 수 있어요.',
    cautions: [...new Set(sources.flatMap((source) => source.cautions || []))].slice(0, 5),
    keywords: keywordHits,
    sourceCompanies,
    evidence: sources.map(polibotEvidencePayload),
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
  if (!profile.age && profile.needs.length === 0 && !profile.budget) {
    const error = new Error('고객 나이, 니즈, 예산 중 하나 이상을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const seed = hashText(JSON.stringify(profile));
  const workspace = await getProductWorkspace(userId, 'polibot');
  const knowledgeSources = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [];
  const qualityReport = buildPolibotQualityReport(knowledgeSources);
  const consultationDraft = buildPolibotConsultationDraft(profile, qualityReport);
  const enrichedProfile = { ...profile, qualityReport, consultationDraft };
  const evidence = rankPolibotEvidence(knowledgeSources, profile)
    .filter((source) => Number(source.matchScore || 0) >= 9 || (source.keywordHits || []).length > 0)
    .slice(0, 8);
  const productEvidence = evidence
    .filter((source) => sourceCatalogItems(source).length > 0)
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
  const patch = {
    customerProfile: profile,
    consultationDraft,
    qualityReport,
    recommendations,
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    recommendationNotice: recommendations.length
      ? ''
      : (qualityReport.recommendableProducts > 0
        ? '추천 가능한 상품은 있지만 입력한 고객 조건과 직접 맞는 조합을 찾지 못했어요. 니즈, 예산, 보험사 조건을 조금 더 구체화해 주세요.'
        : '추천 가능한 확정 상품 데이터가 부족해요. 상품 비교표나 설계 자료를 추가하거나 검수 필요 상품을 먼저 정리해 주세요.')
  };
  return recommendations.length
    ? updateWorkspaceAndConsume(userId, 'polibot', patch)
    : updateWorkspace(userId, 'polibot', patch);
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
    updatedAt: now(),
    createdAt: existing?.createdAt || now()
  };
  const withoutCurrent = customers.filter((item) => item.id !== customer.id);
  return updateWorkspace(userId, 'polibot', {
    customers: [customer, ...withoutCurrent].slice(0, 100)
  });
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
    goal: cleanGoal,
    channel: cleanChannel,
    product: cleanProduct,
    headline: `${cleanProduct || '제품'} 캠페인 운영 초안`,
    mission: `${cleanChannel || '주요 채널'}에서 ${cleanGoal || '참여자 모집'}을 진행합니다.`,
    checklist: ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    createdAt: now()
  };
  return updateWorkspaceAndConsume(userId, 'spread', { campaignDraft: draft });
}

export async function saveSpreadApplicants(userId, { applicants = '', criteria = '' } = {}) {
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
  return updateWorkspaceAndConsume(userId, 'spread', {
    applicantCriteria: criteriaList,
    applicants: rows
  });
}

export async function reviewSpreadSubmission(userId, { url = '', required = '', forbidden = '' } = {}) {
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
  return updateWorkspaceAndConsume(userId, 'spread', {
    submissionReview: {
      url: normalizedUrl,
      required: requiredList,
      forbidden: forbiddenList,
      checks,
      reviewedAt: now()
    }
  });
}
