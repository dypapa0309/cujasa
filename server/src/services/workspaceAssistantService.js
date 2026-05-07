import { productById } from '../config/products.js';
import { getJson } from './openaiService.js';
import { getProductWorkspace } from './productWorkspaceService.js';

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
  const knowledgeCount = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources.length : 0;
  const latestMonth = workspace.latestKnowledgeMonth || catalog.months?.[0] || '';
  const companies = Array.isArray(catalog.companies) ? catalog.companies : [];
  return { knowledgeCount, latestMonth, companies: companies.slice(0, 12), productGroups: (catalog.productGroups || []).slice(0, 8) };
}

function deterministicAssistant({ message, currentProduct, workspace, availableProducts = [] }) {
  const text = normalizeText(message);
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
    if (/자료|데이터|많|보험사|지식|뭐.*있|얼마나/.test(text)) {
      const companyText = summary.companies.length ? summary.companies.slice(0, 8).join(', ') : '아직 보험사 목록이 부족해요';
      return {
        answer: `POLIBOT에는 현재 구조화된 자료 ${summary.knowledgeCount}개가 잡혀 있어요. 최신 자료 월은 ${summary.latestMonth || '미확인'}이고, 보험사는 ${companyText} 기준으로 추천에 활용할 수 있어요.`,
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
        company: '전체 보험사'
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
    answer: '질문을 조금 더 구체적으로 입력해 주세요. 예를 들면 “37세 이상빈 암보험 추천”, “맛집 블로그 후보 분석”, “3040 여성 반말로 주방용품 포스팅”처럼 말하면 작업 초안을 만들 수 있어요.',
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

export async function answerWorkspaceAssistant(userId, payload = {}) {
  const message = normalizeText(payload.message);
  if (!message) {
    const error = new Error('메시지를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const currentProduct = productById(payload.currentProduct || payload.productId)?.id || 'cujasa';
  const inferredProduct = productFromMessage(message, currentProduct);
  const workspace = await loadWorkspaceContext(userId, [...new Set([currentProduct, inferredProduct, 'polibot'])]);
  const fallback = () => deterministicAssistant({
    message,
    currentProduct,
    workspace,
    availableProducts: payload.availableProducts || []
  });
  const polibotSummary = summarizePolibot(workspace.polibot || {});

  const response = await getJson([
    {
      role: 'system',
      content: [
        'You are JASAIN Workspace Assistant. Return JSON only.',
        'Never execute risky actions. Only choose a panel action and fill drafts.',
        'Allowed action values: run, settings, posts, home, billing, dexor, spread, polibot, infludex, dexor-upload, dexor-grade, dexor-download, spread-campaign, spread-applicants, spread-review, polibot-upload, polibot-recommend, polibot-customers, polibot-download, infludex-upload, infludex-grade, infludex-download, or empty string.',
        'If the inferred product is not in availableProducts, choose the product id action only, not a task action.',
        'For POLIBOT insurance recommendation, extract name, age, gender, needs, budget, and set company to 전체 보험사 unless user exactly names an available company.',
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
        inferredProduct,
        availableProducts: payload.availableProducts || [],
        polibot: polibotSummary
      })
    }
  ], fallback, {
    schemaName: 'workspace_assistant',
    validate: validateAssistantResponse
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

  return {
    answer: String(response.answer || '').trim(),
    intent: String(response.intent || 'assistant'),
    action: ACTION_KEYS.has(response.action) ? response.action : '',
    draft: response.draft && typeof response.draft === 'object' ? response.draft : {},
    requiresConfirmation: Boolean(response.requiresConfirmation),
    buttons: safeButtons((response.buttons || []).map((item) => button(item.label, item.actionKey)))
  };
}
