import { productById } from '../config/products.js';
import { getJson } from './openaiService.js';
import { getProductWorkspace } from './productWorkspaceService.js';
import { safeLogActivity } from './supabaseService.js';

const WORKSPACE_ASSISTANT_AI_TIMEOUT_MS = Math.max(1000, Number(process.env.WORKSPACE_ASSISTANT_AI_TIMEOUT_MS || 3500));

const ACTION_KEYS = new Set([
  'run', 'settings', 'posts', 'home', 'billing',
  'dexor', 'spread', 'polibot', 'infludex',
  'dexor-upload', 'dexor-grade', 'dexor-download',
  'spread-campaign', 'spread-applicants', 'spread-review',
  'polibot-upload', 'polibot-recommend', 'polibot-customers', 'polibot-download',
  'infludex-upload', 'infludex-grade', 'infludex-download'
]);

const PRODUCT_IDS = new Set(['cujasa', 'dexor', 'spread', 'polibot', 'infludex']);
const DEXOR_CATEGORIES = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const INSURANCE_NEEDS = ['암', '암보장', '유사암', '뇌', '심장', '질병', '상해', '입원', '수술', '실손', '실비', '간병', '치매', '운전자', '어린이', '태아', '생활비', '진단비'];

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function button(label, actionKey) {
  return label && ACTION_KEYS.has(actionKey) ? { label, actionKey } : null;
}

function safeButtons(items = []) {
  return items.filter(Boolean).slice(0, 4);
}

function productFromMessage(message = '', currentProduct = 'cujasa') {
  const text = message.toLowerCase();
  if (/폴리봇|polibot|보험|보장/.test(text)) return 'polibot';
  if (/덱서|dexor|블로그|후보|씨랭|최적화/.test(text)) return 'dexor';
  if (/스프레드|spread|캠페인|신청자|제출물/.test(text)) return 'spread';
  if (/인플루덱스|infludex|인스타|instagram/.test(text)) return 'infludex';
  if (PRODUCT_IDS.has(currentProduct)) return currentProduct;
  return 'cujasa';
}

function shouldLoadPolibotContext(message = '', currentProduct = 'cujasa') {
  return productFromMessage(message, currentProduct) === 'polibot'
    || /폴리봇|polibot|보험|보장|암|실비|실손|진단비|생활비|추천.*왜|상품.*없|자료|pdf/i.test(message);
}

function deterministicKind(result = {}) {
  const intent = String(result.intent || '');
  if (!intent || intent === 'fallback') return '';
  if (intent.includes('draft')) return 'draft_created';
  return 'faq_hit';
}

function extractAge(text = '') {
  return text.match(/(\d{2})\s*세/)?.[1] || text.match(/(\d{2})\s*(?:살|대)/)?.[1] || '';
}

function extractName(text = '') {
  return text.match(/\d{2}\s*세\s*([가-힣]{2,4})(?:은|는|이|가|님|씨)?/)?.[1]
    || text.match(/([가-힣]{2,4})(?:은|는|이|가|님|씨)?\s*\d{2}\s*(?:세|살)/)?.[1]
    || text.match(/([가-힣]{2,4})\s*(?:고객|님)/)?.[1]
    || '';
}

function extractBudget(text = '') {
  const match = text.match(/월\s*(\d{1,3})\s*만/) || text.match(/(\d{1,3})\s*만원/);
  return match?.[1] || '';
}

function extractInsuranceNeeds(text = '') {
  const needs = INSURANCE_NEEDS
    .filter((need) => text.includes(need))
    .map((need) => (need === '암보장' ? '암' : need));
  return [...new Set(needs)].slice(0, 6);
}

function extractInsuranceDetails(text = '') {
  const draft = {};
  if (/실손|실비/.test(text)) {
    draft.existingMedicalPlan = /없|미가입|안\s*들/.test(text) ? '없음' : /있|가입|들었/.test(text) ? '있음' : '확인 필요';
  }
  if (/고지|병력|수술|입원|투약|진단|치료/.test(text)) {
    draft.medicalHistory = /없|이상\s*없/.test(text) ? '없음' : '확인 필요';
  }
  if (/가족력/.test(text)) draft.familyHistory = '확인 필요';
  if (/운전/.test(text)) draft.driving = /안\s*함|안해|없/.test(text) ? '운전 안함' : '운전함';
  if (/비갱신/.test(text)) draft.renewalPreference = '비갱신 선호';
  else if (/갱신형|갱신/.test(text)) draft.renewalPreference = '허용';
  if (/절감|줄이|낮추/.test(text)) draft.purpose = '보험료 절감';
  else if (/리모델|정리|갈아/.test(text)) draft.purpose = '리모델링';
  else if (/신규|처음/.test(text)) draft.purpose = '신규 가입';
  else if (/보강|강화|추가/.test(text)) draft.purpose = '보장 강화';
  return draft;
}

function extractDexorCategory(text = '') {
  return DEXOR_CATEGORIES.find((category) => text.includes(category)) || '';
}

function parseCujasaDraft(text = '') {
  const target = text.match(/((?:\d{2,4}대|\d{2,4})\s*(?:여성|남성|주부|직장인|자취생|부모|엄마|아빠|대학생|청년|중년)?|(?:여성|남성|주부|직장인|자취생|부모|엄마|아빠|대학생|청년|중년))/)?.[1] || '';
  const tone = text.match(/(반말|존댓말|친근|전문적|담백|짧게|유머|정보성)/)?.[1] || '';
  const scope = text.match(/([가-힣A-Za-z0-9]{2,20}(?:용품|제품|상품|아이템|가전|식품|생활용품|주방용품|청소용품))/)?.[1] || '';
  const draft = {};
  if (target) draft.target_audience = target;
  if (tone) draft.tone = tone;
  if (scope) draft.content_scope = scope;
  return Object.keys(draft).length >= 2 ? draft : null;
}

function summarizePolibot(workspace = {}) {
  const catalog = workspace.catalog || {};
  const qualityReport = workspace.qualityReport || {};
  const usage = workspace.usage || {};
  const knowledgeCount = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources.length : 0;
  const latestMonth = workspace.latestKnowledgeMonth || catalog.months?.[0] || '';
  const companies = Array.isArray(catalog.companies) ? catalog.companies : [];
  const catalogItems = Array.isArray(qualityReport.catalogItems) ? qualityReport.catalogItems : [];
  const countBy = (items, key) => items.reduce((acc, item) => {
    const value = item?.[key] || '미분류';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return {
    knowledgeCount,
    latestMonth,
    companies: companies.slice(0, 12),
    productGroups: (catalog.productGroups || []).slice(0, 8),
    recommendableProducts: qualityReport.recommendableProducts || 0,
    insufficientProducts: qualityReport.insufficientProducts || 0,
    reviewNeededProducts: qualityReport.reviewNeededProducts || 0,
    excludedPhrases: qualityReport.excludedPhrases || 0,
    ocrNeeded: qualityReport.ocrNeeded || 0,
    companyCounts: Object.entries(countBy(catalogItems, 'company')).slice(0, 12),
    productGroupCounts: Object.entries(countBy(catalogItems, 'productGroup')).slice(0, 12),
    recommendationCount: Array.isArray(workspace.recommendations) ? workspace.recommendations.length : 0,
    recommendationNotice: workspace.recommendationNotice || '',
    usage: {
      remaining: usage.remaining,
      used: usage.used,
      limit: usage.limit
    }
  };
}

function summarizeDexor(workspace = {}) {
  const usage = workspace.usage || {};
  return {
    candidateCount: Array.isArray(workspace.candidates) ? workspace.candidates.length : 0,
    resultCount: Array.isArray(workspace.results) ? workspace.results.length : Array.isArray(workspace.analysisResults) ? workspace.analysisResults.length : 0,
    targetCategory: workspace.targetCategory || '',
    lastFileName: workspace.lastFileName || '',
    usage: {
      remaining: usage.remaining,
      used: usage.used,
      limit: usage.limit
    }
  };
}

function summarizeWorkspace(workspace = {}, productId = '') {
  if (productId === 'polibot') return summarizePolibot(workspace);
  if (productId === 'dexor') return summarizeDexor(workspace);
  const usage = workspace?.usage || {};
  return {
    usage: {
      remaining: usage.remaining,
      used: usage.used,
      limit: usage.limit
    }
  };
}

function deterministicAssistant({ message, currentProduct, workspace, availableProducts = [] }) {
  const text = normalizeText(message);
  if (/자사인|jasain|회사|서비스|솔루션|상품.*뭐|제품.*뭐|뭐.*있|무슨\s*서비스/.test(text)) {
    return {
      answer: 'JASAIN은 자동화 솔루션 허브예요. 현재 CUJASA는 쿠팡 파트너스/Threads 자동화, DEXOR는 블로그 후보 분석, SPREAD는 캠페인 운영, POLIBOT은 보험 보장분석과 추천 초안, INFLUDEX는 인스타그램 후보 분석을 맡아요.',
      intent: 'jasain_product_overview',
      action: '',
      draft: {},
      requiresConfirmation: false,
      buttons: safeButtons([button('CUJASA 설정', 'settings'), button('POLIBOT 상품 추천', 'polibot-recommend'), button('DEXOR 후보 분석', 'dexor-upload')])
    };
  }
  if (/쿠자사|cujasa|쿠팡.*자동화|threads.*자동화|스레드.*자동화/.test(text) && /뭐|설명|란|어떤|서비스/.test(text)) {
    return {
      answer: 'CUJASA는 주제 선정, 쿠팡 상품 연결, Threads용 글 생성, 예약 업로드를 한 화면에서 처리하는 자동화 솔루션이에요. 설정에서 Threads와 쿠팡 API를 연결한 뒤 자동화 실행으로 예약 글을 만들 수 있어요.',
      intent: 'cujasa_product_overview',
      action: 'settings',
      draft: {},
      requiresConfirmation: false,
      buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run'), button('포스팅 현황', 'posts')])
    };
  }
  const productId = productFromMessage(text, currentProduct);
  const grantedProducts = new Set(availableProducts);
  if (productId !== 'cujasa' && !grantedProducts.has(productId)) {
    const product = productById(productId);
    return {
      answer: `${product?.name || productId}는 먼저 시작하기를 눌러야 작업을 열 수 있어요. 오른쪽 제품 패널에서 바로 시작할 수 있게 열어둘게요.`,
      intent: 'product_start_required',
      action: productId,
      draft: {},
      requiresConfirmation: true,
      buttons: safeButtons([button(`${product?.name || productId} 시작`, productId), button('결제 확인', 'billing')])
    };
  }
  if (productId === 'polibot') {
    const summary = summarizePolibot(workspace.polibot || {});
    if (/왜\s*안|안\s*돼|실패|추천.*없|상품.*없|안\s*나/.test(text)) {
      const reason = summary.recommendationNotice
        || (summary.recommendableProducts <= 0
          ? '추천에 쓸 확정 상품 데이터가 아직 부족해요.'
          : '고객 조건과 추천 가능 상품의 매칭이 약해서 보수적으로 추천을 막았어요.');
      return {
        answer: `${reason} 현재 추천 가능 상품은 ${summary.recommendableProducts || 0}개, 정보 부족 상품은 ${summary.insufficientProducts || 0}개, 검수 필요는 ${summary.reviewNeededProducts || 0}개예요. 자료 화면에서 확정 상품의 가입조건, 담보, 주의 문구를 먼저 확인해 주세요.`,
        intent: 'polibot_recommendation_blocked_reason',
        action: 'polibot-upload',
        draft: {},
        requiresConfirmation: false,
        buttons: safeButtons([button('자료 확인', 'polibot-upload'), button('상품 추천', 'polibot-recommend')])
      };
    }
    if (/자료|데이터|많|보험사|지식|뭐.*있|얼마나/.test(text)) {
      const companyText = summary.companies.length ? summary.companies.slice(0, 8).join(', ') : '아직 보험사 목록이 부족해요';
      return {
        answer: `POLIBOT에는 자료 ${summary.knowledgeCount}개가 잡혀 있어요. 추천 가능 상품은 ${summary.recommendableProducts || 0}개, 정보 부족 상품은 ${summary.insufficientProducts || 0}개, 검수 필요는 ${summary.reviewNeededProducts || 0}개, OCR 필요 자료는 ${summary.ocrNeeded || 0}개예요. 최신 자료 월은 ${summary.latestMonth || '미확인'}이고, 보험사는 ${companyText} 기준으로 확인돼요.`,
        intent: 'polibot_knowledge_status',
        action: 'polibot-upload',
        draft: {},
        requiresConfirmation: false,
        buttons: safeButtons([button('월별 자료 보기', 'polibot-upload'), button('상품 추천', 'polibot-recommend')])
      };
    }
    const needs = extractInsuranceNeeds(text);
    if (/추천|상품|보험|보장/.test(text) && (extractAge(text) || needs.length > 0)) {
      const draft = {
        name: extractName(text),
        age: extractAge(text),
        gender: /여성|여자|여/.test(text) ? '여성' : /남성|남자|남/.test(text) ? '남성' : '',
        needs: needs.join('\n'),
        budget: extractBudget(text),
        company: '전체 보험사',
        ...extractInsuranceDetails(text)
      };
      return {
        answer: 'POLIBOT 상품 추천 초안을 채웠어요. 오른쪽 패널에서 고객 조건을 확인한 뒤 추천 초안 만들기를 눌러주세요.',
        intent: 'polibot_recommendation_draft',
        action: 'polibot-recommend',
        draft,
        requiresConfirmation: true,
        buttons: safeButtons([button('상품 추천 열기', 'polibot-recommend'), button('자료 확인', 'polibot-upload')])
      };
    }
  }

  if (productId === 'dexor') {
    const category = extractDexorCategory(text);
    if (/다운로드|내보내|csv|엑셀/.test(text)) {
      return {
        answer: 'DEXOR 결과 다운로드 패널을 열게요. 화면에 보이는 정렬 그대로 CSV를 받을 수 있어요.',
        intent: 'dexor_download',
        action: 'dexor-download',
        draft: {},
        requiresConfirmation: false,
        buttons: safeButtons([button('결과 다운로드', 'dexor-download'), button('등급 분석', 'dexor-grade')])
      };
    }
    if (/결과|등급|점수|랭크|분석.*봤/.test(text)) {
      return {
        answer: 'DEXOR 등급 분석 패널을 열게요. 후보를 먼저 저장했다면 S/A/B/C/D 순서로 결과를 확인할 수 있어요.',
        intent: 'dexor_grade',
        action: 'dexor-grade',
        draft: category ? { targetCategory: category } : {},
        requiresConfirmation: false,
        buttons: safeButtons([button('등급 분석', 'dexor-grade'), button('후보 업로드', 'dexor-upload')])
      };
    }
    if (/분석|후보|블로그|씨랭|등급|맛집|뷰티|육아|가전|여행/.test(text)) {
      return {
        answer: `${category || '선택한'} 카테고리 기준으로 DEXOR 후보 업로드 화면을 열게요. URL이나 CSV를 넣은 뒤 저장하면 등급 분석으로 넘어갈 수 있어요.`,
        intent: 'dexor_candidate_draft',
        action: 'dexor-upload',
        draft: category ? { targetCategory: category } : {},
        requiresConfirmation: true,
        buttons: safeButtons([button('후보 업로드', 'dexor-upload'), button('등급 분석', 'dexor-grade')])
      };
    }
  }

  if (productId === 'spread') {
    return {
      answer: 'SPREAD 캠페인 초안 패널을 열게요. 캠페인 목표, 채널, 상품 유형을 확인한 뒤 저장하면 돼요.',
      intent: 'spread_campaign_draft',
      action: 'spread-campaign',
      draft: {
        goal: text.match(/(?:목표|목적|캠페인)\s*([가-힣A-Za-z0-9\s]{2,30})/)?.[1]?.trim() || '',
        channel: /인스타|instagram/i.test(text) ? 'Instagram' : /블로그/.test(text) ? 'Blog' : '',
        product: text.match(/(?:상품|제품)\s*([가-힣A-Za-z0-9\s]{2,30})/)?.[1]?.trim() || ''
      },
      requiresConfirmation: true,
      buttons: safeButtons([button('캠페인 추천', 'spread-campaign')])
    };
  }

  const cujasaDraft = parseCujasaDraft(text);
  if (cujasaDraft) {
    return {
      answer: 'CUJASA 운영 설정 초안을 채웠어요. 오른쪽 설정 패널에서 타깃, 톤, 카테고리를 확인한 뒤 저장해 주세요.',
      intent: 'cujasa_settings_draft',
      action: 'settings',
      draft: cujasaDraft,
      requiresConfirmation: true,
      buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run')])
    };
  }

  return {
    answer: '질문을 조금 더 구체적으로 입력해 주세요. 예를 들면 “37세 남성 암보험 추천”, “폴리봇 자료 뭐 있어?”, “맛집 블로그 후보 분석”, “3040 여성 반말로 주방용품 포스팅”처럼 말하면 작업 초안을 만들 수 있어요.',
    intent: 'fallback',
    action: '',
    draft: {},
    requiresConfirmation: false,
    buttons: safeButtons([button('설정 열기', 'settings'), button('상품 추천', 'polibot-recommend')])
  };
}

function validateAssistantResponse(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'response is not object' };
  if (typeof value.answer !== 'string') return { ok: false, reason: 'answer missing' };
  if (value.action && !ACTION_KEYS.has(value.action)) return { ok: false, reason: 'invalid action' };
  if (value.draft && typeof value.draft !== 'object') return { ok: false, reason: 'invalid draft' };
  return true;
}

async function loadWorkspaceContext(userId, productIds = []) {
  const workspace = {};
  for (const productId of productIds.filter((id) => PRODUCT_IDS.has(id))) {
    try {
      workspace[productId] = await getProductWorkspace(userId, productId);
    } catch {
      workspace[productId] = null;
    }
  }
  return workspace;
}

async function logWorkspaceAssistant(userId, {
  action,
  message = '',
  level = 'info',
  durationMs = null,
  payload = {}
} = {}) {
  if (!action) return null;
  return safeLogActivity({
    user_id: userId,
    action,
    level,
    message: normalizeText(message).slice(0, 500),
    payload: {
      durationMs,
      ...payload
    }
  });
}

export async function logWorkspaceAssistantEvent(userId, payload = {}) {
  const event = String(payload.event || payload.action || '').trim();
  const allowed = new Set([
    'workspace_assistant_faq_hit',
    'workspace_assistant_fallback',
    'workspace_assistant_draft_created',
    'workspace_assistant_wrong_panel',
    'workspace_assistant_slow_ai'
  ]);
  if (!allowed.has(event)) return { ok: false };
  await logWorkspaceAssistant(userId, {
    action: event,
    message: payload.message || '',
    level: payload.level || 'info',
    durationMs: Number.isFinite(Number(payload.durationMs)) ? Number(payload.durationMs) : null,
    payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {}
  });
  return { ok: true };
}

export async function answerWorkspaceAssistant(userId, payload = {}) {
  const startedAt = Date.now();
  const message = normalizeText(payload.message);
  if (!message) {
    const error = new Error('메시지를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const currentProduct = productById(payload.currentProduct || payload.productId)?.id || 'cujasa';
  const inferredProduct = productFromMessage(message, currentProduct);
  const contextProducts = shouldLoadPolibotContext(message, currentProduct)
    ? [...new Set([currentProduct, inferredProduct, 'polibot'])]
    : [...new Set([currentProduct, inferredProduct])];
  const workspace = await loadWorkspaceContext(userId, contextProducts);
  const fallback = () => deterministicAssistant({
    message,
    currentProduct,
    workspace,
    availableProducts: payload.availableProducts || []
  });
  const deterministic = fallback();
  const deterministicEvent = deterministicKind(deterministic);
  if (deterministicEvent) {
    await logWorkspaceAssistant(userId, {
      action: `workspace_assistant_${deterministicEvent}`,
      message,
      durationMs: Date.now() - startedAt,
      payload: {
        source: 'server_deterministic',
        intent: deterministic.intent,
        action: deterministic.action || '',
        currentProduct,
        inferredProduct
      }
    });
    return deterministic;
  }
  const polibotSummary = summarizePolibot(workspace.polibot || {});
  const workspaceSummary = Object.fromEntries(
    Object.entries(workspace).map(([productId, value]) => [productId, summarizeWorkspace(value || {}, productId)])
  );

  const response = await getJson([
    {
      role: 'system',
      content: [
        'You are JASAIN Workspace Assistant. Return JSON only.',
        'Never execute risky actions. Only choose a panel action and fill drafts.',
        'Allowed action values: run, settings, posts, home, billing, dexor, spread, polibot, infludex, dexor-upload, dexor-grade, dexor-download, spread-campaign, spread-applicants, spread-review, polibot-upload, polibot-recommend, polibot-customers, polibot-download, infludex-upload, infludex-grade, infludex-download, or empty string.',
        'If the inferred product is not in availableProducts, choose the product id action only, not a task action.',
        'For POLIBOT insurance recommendation, extract name, age, gender, needs, budget, and set company to 전체 보험사 unless user exactly names an available company.',
        'For POLIBOT details, draft may also include existingMedicalPlan, existingPremium, medicalHistory, familyHistory, driving, renewalPreference, purpose.',
        'If POLIBOT recommendation is blocked or user asks why it failed, answer using recommendationNotice, recommendableProducts, reviewNeededProducts, and ocrNeeded. Prefer action polibot-upload.',
        'For DEXOR, use dexor-upload for candidate/category drafts, dexor-grade for analysis results, dexor-download for CSV/export.',
        'For CUJASA settings, draft keys are target_audience, tone, content_scope.',
        'For DEXOR, draft key is targetCategory.',
        'Answer in friendly Korean 요체.'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        message,
        currentProduct,
        currentAction: payload.currentAction || '',
        currentTasks: Array.isArray(payload.currentTasks) ? payload.currentTasks.slice(0, 8) : [],
        inferredProduct,
        availableProducts: payload.availableProducts || [],
        polibot: polibotSummary,
        workspace: workspaceSummary
      })
    }
  ], fallback, {
    schemaName: 'workspace_assistant',
    validate: validateAssistantResponse,
    timeoutMs: WORKSPACE_ASSISTANT_AI_TIMEOUT_MS,
    onFallback: async ({ reason }) => {
      await logWorkspaceAssistant(userId, {
        action: /timeout|timed out|abort/i.test(String(reason || ''))
          ? 'workspace_assistant_ai_timeout'
          : 'workspace_assistant_fallback',
        message,
        level: 'warn',
        durationMs: Date.now() - startedAt,
        payload: { reason, currentProduct, inferredProduct }
      });
    }
  });
  const availableProducts = new Set(payload.availableProducts || []);
  const taskProduct = String(response.action || '').split('-')[0];
  if (PRODUCT_IDS.has(taskProduct) && taskProduct !== 'cujasa' && !availableProducts.has(taskProduct)) {
    const product = productById(taskProduct);
    return {
      answer: `${product?.name || taskProduct}는 먼저 시작하기를 눌러야 작업을 열 수 있어요. 오른쪽 제품 패널에서 바로 시작할 수 있게 열어둘게요.`,
      intent: 'product_start_required',
      action: taskProduct,
      draft: {},
      requiresConfirmation: true,
      buttons: safeButtons([button(`${product?.name || taskProduct} 시작`, taskProduct), button('결제 확인', 'billing')])
    };
  }

  const result = {
    answer: String(response.answer || '').trim(),
    intent: String(response.intent || 'assistant'),
    action: ACTION_KEYS.has(response.action) ? response.action : '',
    draft: response.draft && typeof response.draft === 'object' ? response.draft : {},
    requiresConfirmation: Boolean(response.requiresConfirmation),
    buttons: safeButtons((response.buttons || []).map((item) => button(item.label, item.actionKey || item.action)))
  };
  await logWorkspaceAssistant(userId, {
    action: result.intent === 'fallback' ? 'workspace_assistant_fallback' : 'workspace_assistant_ai_answer',
    message,
    level: result.intent === 'fallback' ? 'warn' : 'info',
    durationMs: Date.now() - startedAt,
    payload: {
      intent: result.intent,
      action: result.action,
      hasDraft: Object.keys(result.draft || {}).length > 0,
      currentProduct,
      inferredProduct
    }
  });
  return result;
}
