import { productById } from '../config/products.js';
import { dbGet, dbUpdate } from './supabaseService.js';

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread']);

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

function gradeFromScore(score) {
  if (score >= 88) return 'S';
  if (score >= 74) return 'A';
  if (score >= 58) return 'B';
  if (score >= 42) return 'C';
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
  return updated?.settings?.workspace || next.workspace;
}

export async function getProductWorkspace(userId, productId) {
  const grant = await getGrant(userId, productId);
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  return settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
}

export async function saveDexorCandidates(userId, { urls = '', fileName = '' } = {}) {
  const candidates = parseUrls(urls).map((url, index) => ({
    id: `dexor-${hashText(`${url}-${index}`)}`,
    url,
    source: fileName ? 'file-or-manual' : 'manual',
    createdAt: now()
  }));
  return updateWorkspace(userId, 'dexor', {
    candidates,
    fileName: String(fileName || '').trim(),
    analysisResults: []
  });
}

export async function analyzeDexorCandidates(userId) {
  const workspace = await getProductWorkspace(userId, 'dexor');
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const analysisResults = candidates.map((candidate) => {
    const hash = hashText(candidate.url);
    const naverBonus = /blog\.naver\.com/i.test(candidate.url) ? 12 : 0;
    const longUrlPenalty = candidate.url.length > 120 ? 6 : 0;
    const score = Math.max(20, Math.min(98, 48 + (hash % 43) + naverBonus - longUrlPenalty));
    const grade = gradeFromScore(score);
    const reasons = [
      /blog\.naver\.com/i.test(candidate.url) ? '네이버 블로그 후보' : '외부 URL 후보',
      score >= 74 ? '우선 검토 점수' : '추가 검토 필요',
      longUrlPenalty ? 'URL 구조 확인 필요' : 'URL 구조 정상'
    ];
    return {
      id: candidate.id,
      url: candidate.url,
      score,
      grade,
      reasons,
      analyzedAt: now()
    };
  });
  return updateWorkspace(userId, 'dexor', { analysisResults });
}

export async function saveSpreadCampaign(userId, { goal = '', channel = '', product = '' } = {}) {
  const cleanGoal = String(goal || '').trim();
  const cleanChannel = String(channel || '').trim();
  const cleanProduct = String(product || '').trim();
  const draft = {
    goal: cleanGoal,
    channel: cleanChannel,
    product: cleanProduct,
    headline: `${cleanProduct || '제품'} 캠페인 운영 초안`,
    mission: `${cleanChannel || '주요 채널'}에서 ${cleanGoal || '참여자 모집'}을 진행합니다.`,
    checklist: ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    createdAt: now()
  };
  return updateWorkspace(userId, 'spread', { campaignDraft: draft });
}

export async function saveSpreadApplicants(userId, { applicants = '', criteria = '' } = {}) {
  const criteriaList = normalizeList(criteria);
  const rows = normalizeList(applicants).map((name, index) => {
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
  return updateWorkspace(userId, 'spread', {
    applicantCriteria: criteriaList,
    applicants: rows
  });
}

export async function reviewSpreadSubmission(userId, { url = '', required = '', forbidden = '' } = {}) {
  const requiredList = normalizeList(required);
  const forbiddenList = normalizeList(forbidden);
  const normalizedUrl = String(url || '').trim();
  const checks = [
    { label: '제출 URL', passed: /^https?:\/\//i.test(normalizedUrl), detail: normalizedUrl || 'URL 없음' },
    ...requiredList.map((keyword) => ({ label: `필수 키워드: ${keyword}`, passed: false, detail: '본문 연결 전 수동 확인 필요' })),
    ...forbiddenList.map((keyword) => ({ label: `금지 표현: ${keyword}`, passed: true, detail: '입력 URL 단계에서는 감지 없음' }))
  ];
  return updateWorkspace(userId, 'spread', {
    submissionReview: {
      url: normalizedUrl,
      required: requiredList,
      forbidden: forbiddenList,
      checks,
      reviewedAt: now()
    }
  });
}
