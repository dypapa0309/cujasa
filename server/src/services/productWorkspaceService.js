import { productById } from '../config/products.js';
import { dbGet, dbUpdate } from './supabaseService.js';

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread', 'polibot', 'infludex']);
const DEFAULT_USAGE_LIMIT = 5;
const DEXOR_SCORE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const INFLUDEX_GRADE_ORDER = { DIAMOND: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
const DEXOR_CATEGORIES = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const POLIBOT_SEED_FILES = [
  '[글로벌금융판매] 26.05_경영인정기보험 현황 비교.pdf',
  '김정숙 보장분석 (1).pdf',
  '상품비교 가이드북 (생손보 05.04).pptx',
  '3대질병진단비 보험료(26.05.06).pptx',
  '김영환님 현재 2604.pdf',
  '이명석 보장분석.pdf',
  'KakaoTalk_Chat_이기성_2026-05-06-21-05-29.csv',
  '[인카] 이달의영업이슈_2605.pdf',
  '장진호님 보장분석.pdf',
  '신용기.pdf',
  'KakaoTalk_Chat_이기성_2026-05-07-13-23-34.csv',
  '단기납 종신보험환급률 26.05.06.pptx',
  '금융환경과 관심상품 2026년 05월(05.04).pptx',
  '실손정액조회(26.04.28).pdf',
  '상품비교 가이드북 (생명보험 05.04).pptx',
  '[김표섭 현재 kb버전 2604.pdf',
  '박인희님 현재 2604.pdf'
];

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

function inferPolibotFileType(fileName = '') {
  const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['pdf', 'pptx', 'ppt', 'csv', 'txt'].includes(ext)) return ext;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  return ext || 'unknown';
}

function inferKnowledgeMonth(value = '', fallbackDate = new Date()) {
  const text = String(value || '');
  const yearMonth = text.match(/(20\d{2})[-_.년\s]*(0?[1-9]|1[0-2])/);
  if (yearMonth) return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;
  const compact = text.match(/(^|[^0-9])(\d{2})(0[1-9]|1[0-2])([^0-9]|$)/);
  if (compact) return `20${compact[2]}-${compact[3]}`;
  return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
}

function extractPolibotKeywords(text = '') {
  const source = String(text || '');
  const keywords = [
    '암', '유사암', '뇌', '심장', '질병', '상해', '수술', '입원', '통원', '실손',
    '간병', '치매', '운전자', '어린이', '태아', '갱신', '비갱신', '납입면제', '고지', '유병자'
  ];
  return keywords.filter((keyword) => source.includes(keyword)).slice(0, 12);
}

function inferPolibotCompany(text = '') {
  const source = String(text || '');
  const companies = ['삼성화재', '현대해상', 'KB손해보험', 'DB손해보험', '메리츠', '한화손해보험', '롯데손해보험', '흥국화재', 'NH농협손해보험', 'AIA', '메트라이프', '라이나', '인카금융서비스', '글로벌금융판매'];
  return companies.find((company) => source.includes(company)) || '';
}

function inferPolibotProductGroup(text = '') {
  const source = String(text || '');
  if (/운전자/.test(source)) return '운전자';
  if (/암|유사암/.test(source)) return '암/질병';
  if (/뇌|심장|질병/.test(source)) return '3대 질병';
  if (/간병|치매/.test(source)) return '간병/치매';
  if (/실손|실비/.test(source)) return '실손';
  if (/어린이|태아/.test(source)) return '어린이/태아';
  return '종합 보장';
}

function normalizePolibotKnowledgeItems({ files = [], month = '', note = '' } = {}) {
  const nowDate = new Date();
  return (Array.isArray(files) ? files : [])
    .map((file, index) => {
      const fileName = String(file?.name || file?.fileName || '').trim();
      const rawText = String(file?.text || file?.memo || note || '').trim();
      if (!fileName && !rawText) return null;
      const sourceText = [fileName, rawText, note].filter(Boolean).join(' ');
      const inferredMonth = inferKnowledgeMonth(month || sourceText, nowDate);
      const keywords = extractPolibotKeywords(sourceText);
      return {
        id: `polibot-knowledge-${hashText(`${fileName}-${inferredMonth}-${Date.now()}-${index}`)}`,
        fileName: fileName || `자료 ${index + 1}`,
        month: inferredMonth,
        fileType: inferPolibotFileType(fileName),
        company: inferPolibotCompany(sourceText) || '미분류',
        productGroup: inferPolibotProductGroup(sourceText),
        keywords,
        textSnippet: rawText.slice(0, 900),
        note: String(note || '').trim(),
        uploadedAt: now()
      };
    })
    .filter(Boolean)
    .slice(0, 80);
}

function polibotSeedKnowledgeSources() {
  return POLIBOT_SEED_FILES.map((fileName, index) => {
    const sourceText = fileName;
    return {
      id: `polibot-seed-${index}`,
      fileName,
      month: inferKnowledgeMonth(sourceText),
      fileType: inferPolibotFileType(fileName),
      company: inferPolibotCompany(sourceText) || '미분류',
      productGroup: inferPolibotProductGroup(sourceText),
      keywords: extractPolibotKeywords(sourceText),
      textSnippet: '',
      note: '초기 PoliBot 자료 묶음',
      uploadedAt: '2026-05-07T00:00:00.000Z',
      seeded: true
    };
  });
}

function pickPolibotEvidence(knowledgeSources = [], profile = {}) {
  const needsText = [profile.company, ...(profile.needs || [])].join(' ');
  const sorted = [...knowledgeSources].sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')));
  const matched = sorted.filter((item) => {
    const companyMatch = profile.company && item.company && item.company !== '미분류' && item.company.includes(profile.company);
    const keywordMatch = item.keywords?.some((keyword) => needsText.includes(keyword));
    return companyMatch || keywordMatch;
  });
  return (matched.length ? matched : sorted).slice(0, 3);
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
    next.knowledgeSources = currentKnowledge.length > 0 ? currentKnowledge : polibotSeedKnowledgeSources();
    next.latestKnowledgeMonth = next.knowledgeSources[0]?.month || next.latestKnowledgeMonth || '';
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
  const items = normalizePolibotKnowledgeItems({ files, month, note });
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

export async function savePolibotRecommendation(userId, { age = '', gender = '', needs = '', budget = '', company = '' } = {}) {
  const profile = {
    age: String(age || '').trim(),
    gender: String(gender || '').trim(),
    needs: normalizeList(needs),
    budget: String(budget || '').trim(),
    company: String(company || '').trim()
  };
  if (!profile.age && profile.needs.length === 0 && !profile.budget) {
    const error = new Error('고객 나이, 니즈, 예산 중 하나 이상을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const seed = hashText(JSON.stringify(profile));
  const workspace = await getProductWorkspace(userId, 'polibot');
  const evidence = pickPolibotEvidence(Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [], profile);
  const recommendations = ['보장 공백 보완형', '보험료 절감형', '암/질병 집중형'].map((label, index) => ({
    id: `polibot-rec-${index}`,
    name: `${evidence[index]?.company && evidence[index].company !== '미분류' ? evidence[index].company : profile.company || '추천'} ${label}`,
    score: Math.min(98, 70 + ((seed + index * 9) % 25) + (evidence[index] ? 3 : 0)),
    reason: [
      profile.needs[index] ? `${profile.needs[index]} 니즈와 맞는 보장` : `${label} 기준으로 우선 검토`,
      evidence[index] ? `${evidence[index].month} ${evidence[index].fileName} 기준` : '월별 자료 추가 시 근거가 더 정교해짐'
    ].join(' · '),
    premium: profile.budget ? `월 ${profile.budget}만원 이내 검토` : '보험료 비교 필요',
    evidence: evidence[index] ? [{
      fileName: evidence[index].fileName,
      month: evidence[index].month,
      company: evidence[index].company,
      productGroup: evidence[index].productGroup,
      keywords: evidence[index].keywords || []
    }] : []
  })).sort((a, b) => b.score - a.score);
  return updateWorkspaceAndConsume(userId, 'polibot', {
    customerProfile: profile,
    recommendations
  });
}

export async function savePolibotCustomer(userId, { name = '', age = '', memo = '' } = {}) {
  const customer = {
    id: `polibot-customer-${hashText(`${name}-${age}-${Date.now()}`)}`,
    name: String(name || '').trim() || '이름 미입력',
    age: String(age || '').trim(),
    memo: String(memo || '').trim(),
    createdAt: now()
  };
  const workspace = await getProductWorkspace(userId, 'polibot');
  const customers = Array.isArray(workspace.customers) ? workspace.customers : [];
  return updateWorkspace(userId, 'polibot', {
    customers: [customer, ...customers].slice(0, 100)
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
