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
const LOW_CONFIDENCE_THRESHOLD = 0.55;

const ACTION_PRODUCT = {
  run: 'cujasa',
  settings: 'cujasa',
  posts: 'cujasa',
  home: 'cujasa',
  billing: 'cujasa',
  dexor: 'dexor',
  spread: 'spread',
  polibot: 'polibot',
  infludex: 'infludex',
  'dexor-upload': 'dexor',
  'dexor-grade': 'dexor',
  'dexor-download': 'dexor',
  'spread-campaign': 'spread',
  'spread-applicants': 'spread',
  'spread-review': 'spread',
  'polibot-upload': 'polibot',
  'polibot-recommend': 'polibot',
  'polibot-customers': 'polibot',
  'polibot-download': 'polibot',
  'infludex-upload': 'infludex',
  'infludex-grade': 'infludex',
  'infludex-download': 'infludex'
};

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function button(label, actionKey) {
  return label && ACTION_KEYS.has(actionKey) ? { label, actionKey } : null;
}

function safeButtons(items = []) {
  return items.filter(Boolean).slice(0, 4);
}

function actionProductId(action = '') {
  return ACTION_PRODUCT[action] || '';
}

function normalizeAssistantResult(result = {}, defaults = {}) {
  const action = ACTION_KEYS.has(result.action) ? result.action : '';
  const productId = productById(result.productId)?.id || actionProductId(action) || defaults.productId || defaults.currentProduct || 'cujasa';
  const draft = result.draft && typeof result.draft === 'object' ? result.draft : {};
  const confidence = Number(result.confidence);
  const normalized = {
    answer: String(result.answer || '').trim(),
    intent: String(result.intent || 'assistant'),
    productId,
    action,
    draft,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : Number(defaults.confidence ?? 0.8),
    source: result.source || defaults.source || 'server_deterministic',
    requiresConfirmation: Boolean(result.requiresConfirmation),
    buttons: safeButtons((result.buttons || []).map((item) => button(item.label, item.actionKey || item.action))),
    clarification: Boolean(result.clarification)
  };
  if (result.workflow && typeof result.workflow === 'object') normalized.workflow = result.workflow;
  if (Array.isArray(result.missingFields)) normalized.missingFields = result.missingFields;
  if (Array.isArray(result.nextQuestions)) normalized.nextQuestions = result.nextQuestions;
  if (typeof result.readyToSubmit === 'boolean') normalized.readyToSubmit = result.readyToSubmit;
  if (result.confirmAction && typeof result.confirmAction === 'object') normalized.confirmAction = result.confirmAction;
  return normalized;
}

function clarificationResult({ currentProduct = 'cujasa', buttons = [], answer = '' } = {}) {
  return normalizeAssistantResult({
    answer: answer || '어떤 작업을 도와드릴까요? 아래에서 가까운 작업을 골라주세요.',
    intent: 'clarification_required',
    productId: currentProduct,
    action: '',
    draft: {},
    confidence: 0.35,
    requiresConfirmation: true,
    clarification: true,
    buttons
  }, { currentProduct, source: 'server_deterministic' });
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

function taskListResult(currentProduct = 'cujasa') {
  if (currentProduct === 'dexor') {
    return clarificationResult({
      currentProduct,
      answer: 'DEXOR에서 어떤 작업을 열까요?',
      buttons: safeButtons([button('후보 업로드', 'dexor-upload'), button('등급 분석', 'dexor-grade'), button('결과 다운로드', 'dexor-download')])
    });
  }
  if (currentProduct === 'spread') {
    return clarificationResult({
      currentProduct,
      answer: 'SPREAD에서 어떤 작업을 열까요?',
      buttons: safeButtons([button('캠페인 추천', 'spread-campaign'), button('참여자 선정', 'spread-applicants'), button('제출물 검수', 'spread-review')])
    });
  }
  if (currentProduct === 'polibot') {
    return clarificationResult({
      currentProduct,
      answer: 'POLIBOT에서 어떤 작업을 열까요?',
      buttons: safeButtons([button('PDF 업로드', 'polibot-upload'), button('상품 추천', 'polibot-recommend'), button('고객 관리', 'polibot-customers'), button('결과 다운로드', 'polibot-download')])
    });
  }
  return clarificationResult({
    currentProduct,
    answer: 'CUJASA에서 어떤 작업을 열까요?',
    buttons: safeButtons([button('자동화 실행', 'run'), button('설정 열기', 'settings'), button('포스팅 현황', 'posts'), button('결제 확인', 'billing')])
  });
}

function shouldLoadPolibotContext(message = '', currentProduct = 'cujasa') {
  return productFromMessage(message, currentProduct) === 'polibot'
    || /폴리봇|polibot|보험|보장|암|실비|실손|진단비|생활비|추천.*왜|상품.*없|자료|pdf/i.test(message);
}

function deterministicKind(result = {}) {
  const intent = String(result.intent || '');
  if (!intent || intent === 'fallback') return '';
  if (intent === 'clarification_required') return 'clarification';
  if (intent.includes('draft')) return 'draft_created';
  return 'faq_hit';
}

function extractAge(text = '') {
  return text.match(/(\d{2})\s*세/)?.[1] || text.match(/(\d{2})\s*(?:살|대)/)?.[1] || '';
}

function extractName(text = '') {
  const name = text.match(/\d{2}\s*세\s*(?:남성|남자|여성|여자|남|여)\s*([가-힣]{2,4})(?:은|는|이|가|님|씨|고객)?/)?.[1]
    || text.match(/\d{2}\s*세\s*([가-힣]{2,4})(?:은|는|이|가|님|씨)?/)?.[1]
    || text.match(/([가-힣]{2,4})(?:은|는|이|가|님|씨)?\s*\d{2}\s*(?:세|살)/)?.[1]
    || text.match(/([가-힣]{2,4})\s*(?:고객|님)/)?.[1]
    || '';
  return ['남성', '남자', '여성', '여자'].includes(name) ? '' : name;
}

function extractWorkflowName(text = '') {
  const leadingName = String(text || '').match(/^([가-힣]{2,4})\s*\d{2}\s*(?:세|살)/)?.[1] || '';
  const name = leadingName || extractName(text);
  return INSURANCE_NEEDS.includes(name) ? '' : name;
}

function extractBudget(text = '') {
  const match = text.match(/월\s*(\d{1,3})\s*만/) || text.match(/(\d{1,3})\s*만원/);
  return match?.[1] || '';
}

function extractPremiumNumber(text = '') {
  const match = String(text || '').match(/(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?/);
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

const POLIBOT_WORKFLOW_REQUIRED_FIELDS = [
  { key: 'age', label: '나이', importance: 'required', question: '고객 나이를 몇 세로 볼까요?' },
  { key: 'needs', label: '필요 보장', importance: 'required', question: '필요 보장은 어떤 것들이에요? 예: 암, 뇌, 심장' },
  { key: 'budget', label: '목표 월 보험료', importance: 'required', question: '목표 월 보험료는 얼마로 볼까요? 숫자만 40처럼 적어도 돼요.' }
];

const POLIBOT_WORKFLOW_CONFIRM_FIELDS = [
  { key: 'gender', label: '성별', importance: 'confirm', question: '성별은 남성/여성 중 어디에 가까울까요?' },
  { key: 'existingMedicalPlan', label: '기존 실손 여부', importance: 'confirm', question: '기존 실손보험은 있나요?' },
  { key: 'medicalHistory', label: '병력/고지 이슈', importance: 'confirm', question: '최근 병력이나 고지할 이슈가 있나요?' }
];

function compactDraftValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ');
  return String(value ?? '').trim();
}

function normalizePolibotDraft(draft = {}) {
  return Object.fromEntries(
    Object.entries(draft || {})
      .filter(([, value]) => value !== undefined && value !== null && compactDraftValue(value) !== '')
      .map(([key, value]) => [key, Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value).trim()])
  );
}

function mergePolibotWorkflowDraft(previous = {}, incoming = {}) {
  return {
    ...normalizePolibotDraft(previous),
    ...normalizePolibotDraft(incoming)
  };
}

function polibotDraftNeeds(draft = {}) {
  return extractInsuranceNeeds(String(draft.needs || '')).length
    ? extractInsuranceNeeds(String(draft.needs || '')).join(', ')
    : String(draft.needs || '').split(/[,，\n]/).map((item) => item.trim()).filter(Boolean).join(', ');
}

function extractPolibotWorkflowDraft(message = '', workflow = {}) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  const previous = workflow?.state?.draft || workflow?.draft || {};
  const lastField = workflow?.state?.nextField || workflow?.nextField || '';
  const draft = {
    name: extractWorkflowName(text),
    age: extractAge(text),
    gender: /여성|여자|^여$|\s여\s/.test(text) ? '여성' : /남성|남자|^남$|\s남\s/.test(text) ? '남성' : '',
    needs: extractInsuranceNeeds(text).join(', '),
    budget: '',
    ...extractInsuranceDetails(text)
  };

  const explicitTarget = text.match(/(?:목표|예산|희망|생각(?:하는)?|원하는)\s*(?:월\s*)?(?:보험료)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?/);
  const explicitCurrent = text.match(/(?:현재|지금|기존|납입)\s*(?:월\s*)?(?:보험료|납입)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?/);
  const pair = text.match(/(?:목표|예산|희망|생각(?:하는)?)\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?[, ]+(?:현재|지금|기존|납입)\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?/)
    || text.match(/(?:현재|지금|기존|납입)\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?[, ]+(?:목표|예산|희망|생각(?:하는)?)\s*(\d{1,3}(?:\.\d+)?)\s*(?:만|만원)?/);
  if (pair) {
    if (/^(?:현재|지금|기존|납입)/.test(pair[0])) {
      draft.existingPremium = pair[1];
      draft.budget = pair[2];
    } else {
      draft.budget = pair[1];
      draft.existingPremium = pair[2];
    }
  }
  if (explicitTarget) draft.budget = explicitTarget[1];
  if (explicitCurrent) draft.existingPremium = explicitCurrent[1];

  const bareNumber = extractPremiumNumber(text);
  if (bareNumber && !draft.budget && !draft.existingPremium) {
    if (lastField === 'budget') draft.budget = bareNumber;
    if (lastField === 'existingPremium') draft.existingPremium = bareNumber;
    if (!lastField && /월|만원|보험료|예산/.test(text)) draft.budget = bareNumber;
  }

  if (/실손|실비/.test(text) && /없|미가입|안\s*들/.test(text)) draft.existingMedicalPlan = '없음';
  if (/실손|실비/.test(text) && /있|가입|들었/.test(text)) draft.existingMedicalPlan = '있음';
  if (/고지|병력|수술|입원|투약|진단|치료/.test(text) && /없|이상\s*없|문제\s*없/.test(text)) draft.medicalHistory = '없음';
  if (/고지|병력|수술|입원|투약|진단|치료/.test(text) && /있|필요|받았|했다|함/.test(text)) draft.medicalHistory = '있음';

  if (/가족력/.test(text) && /없|이상\s*없/.test(text)) draft.familyHistory = '없음';
  if (/암\s*가족력/.test(text)) draft.familyHistory = '암 가족력';
  if (/뇌.*가족력/.test(text)) draft.familyHistory = '뇌혈관 가족력';
  if (/심장.*가족력/.test(text)) draft.familyHistory = '심장 가족력';

  if (/운전/.test(text) && /안\s*함|안해|없/.test(text)) draft.driving = '운전 안함';
  if (/운전/.test(text) && /함|해|한다|있/.test(text)) draft.driving = '운전함';
  if (/비갱신/.test(text)) draft.renewalPreference = '비갱신 선호';
  if (/갱신.*상관|갱신.*괜찮|갱신.*허용/.test(text) || lower.includes('renewal ok')) draft.renewalPreference = '허용';

  return mergePolibotWorkflowDraft(previous, draft);
}

function analyzePolibotWorkflowDraft(draft = {}) {
  const normalized = normalizePolibotDraft({
    ...draft,
    needs: polibotDraftNeeds(draft)
  });
  const missingRequired = POLIBOT_WORKFLOW_REQUIRED_FIELDS.filter((field) => !compactDraftValue(normalized[field.key]));
  const missingConfirm = POLIBOT_WORKFLOW_CONFIRM_FIELDS.filter((field) => !compactDraftValue(normalized[field.key]));
  const nextField = missingRequired[0] || missingConfirm[0] || null;
  const summaryParts = [
    normalized.name,
    normalized.age ? `${normalized.age}세` : '',
    normalized.gender,
    normalized.needs ? `보장 ${normalized.needs}` : '',
    normalized.budget ? `목표 ${normalized.budget}만원` : '',
    normalized.existingPremium ? `현재 ${normalized.existingPremium}만원` : ''
  ].filter(Boolean);
  return {
    draft: normalized,
    missingRequired,
    missingConfirm,
    nextField,
    readyToSubmit: missingRequired.length === 0,
    stateSummary: summaryParts.join(' · ')
  };
}

function buildPolibotWorkflowResult({ message, currentProduct = 'polibot', workflow = {} } = {}) {
  const draft = extractPolibotWorkflowDraft(message, workflow);
  const analysis = analyzePolibotWorkflowDraft(draft);
  const missingFields = [
    ...analysis.missingRequired,
    ...analysis.missingConfirm
  ].map(({ key, label, importance }) => ({ key, label, importance }));
  const nextQuestions = analysis.nextField ? [analysis.nextField.question] : [];
  const needsConfirm = analysis.missingConfirm.length > 0;
  const answer = !analysis.readyToSubmit
    ? [
      analysis.stateSummary ? `지금까지는 ${analysis.stateSummary}로 이해했어요.` : 'POLIBOT 추천 조건을 이어서 채울게요.',
      analysis.nextField?.question || '핵심 조건을 조금 더 알려주세요.'
    ].join(' ')
    : needsConfirm
      ? `핵심 조건은 잡았어요. ${analysis.stateSummary}로 추천 초안 생성은 가능하고, 정확도를 높이려면 ${analysis.missingConfirm.map((field) => field.label).join(', ')}만 확인하면 좋아요.`
      : `좋아요. ${analysis.stateSummary}로 추천 초안을 만들 준비가 됐어요. 상품 추천 카드에서 추천 초안 만들기를 눌러주세요.`;

  return normalizeAssistantResult({
    answer,
    intent: analysis.readyToSubmit ? 'polibot_workflow_ready' : 'polibot_workflow_collecting',
    productId: 'polibot',
    action: 'polibot-recommend',
    draft: analysis.draft,
    confidence: 0.93,
    source: 'workflow_engine',
    requiresConfirmation: true,
    buttons: safeButtons([button('상품 추천 열기', 'polibot-recommend')]),
    workflow: {
      key: 'polibot_recommendation',
      productId: 'polibot',
      action: 'polibot-recommend',
      draft: analysis.draft,
      missingFields,
      nextQuestions,
      nextField: analysis.nextField?.key || '',
      readyToSubmit: analysis.readyToSubmit,
      stateSummary: analysis.stateSummary,
      confirmAction: analysis.readyToSubmit
        ? { key: 'polibot.generateRecommendation', label: '추천 초안 만들기', actionKey: 'polibot-recommend' }
        : null
    },
    missingFields,
    nextQuestions,
    readyToSubmit: analysis.readyToSubmit,
    confirmAction: analysis.readyToSubmit
      ? { key: 'polibot.generateRecommendation', label: '추천 초안 만들기', actionKey: 'polibot-recommend' }
      : null
  }, { currentProduct });
}

function shouldUseTestWorkflow(message = '', currentProduct = 'cujasa', currentAction = '', workflow = {}) {
  if (!workflow?.enabled) return false;
  if (workflow.key === 'polibot_recommendation') return true;
  if (currentAction === 'polibot-recommend') return true;
  if (currentProduct === 'polibot' && /추천|상품|보험|보장|실손|실비|고지|병력|예산|보험료|목표|현재/.test(message)) return true;
  return false;
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

export function classifyWorkspaceAssistantIntent({ message, currentProduct = 'cujasa', workspace = {}, availableProducts = [] } = {}) {
  const text = normalizeText(message);
  const lower = text.toLowerCase();
  if (/지금\s*뭐|뭐\s*해야|다음\s*액션|다음\s*할|우선순위|홈|대시보드|전체\s*상태|통합\s*상태/.test(text)) {
    return normalizeAssistantResult({
      answer: 'JASAIN 홈에서 보유 솔루션의 연결 상태, 사용량, 확인 필요 항목과 다음 액션을 한 번에 볼 수 있어요. 먼저 홈을 보고 막힌 제품부터 처리하는 흐름이 좋아요.',
      intent: 'jasain_home_next_action',
      productId: currentProduct,
      action: 'home',
      draft: {},
      confidence: 0.9,
      requiresConfirmation: false,
      buttons: safeButtons([button('JASAIN 홈', 'home'), button('설정 확인', 'settings'), button('결제 확인', 'billing')])
    }, { currentProduct });
  }
  if (/작업|기능|메뉴|뭐\s*있|뭐있|할\s*수|뭘\s*할/.test(text)) return taskListResult(currentProduct);
  if (/자사인|jasain|회사|서비스|솔루션|상품.*뭐|제품.*뭐|뭐.*있|무슨\s*서비스/.test(text)) {
    return normalizeAssistantResult({
      answer: 'JASAIN은 여러 자동화 솔루션을 한 계정에서 운영하는 허브예요. CUJASA는 콘텐츠/Threads 자동화, DEXOR는 블로그 후보 분석, SPREAD는 캠페인 운영, POLIBOT은 보험 추천 초안, INFLUDEX는 인스타그램 후보 분석을 맡고 JASAIN 홈에서 상태와 다음 액션을 같이 볼 수 있어요.',
      intent: 'jasain_product_overview',
      productId: currentProduct,
      action: 'home',
      draft: {},
      confidence: 0.9,
      requiresConfirmation: false,
      buttons: safeButtons([button('JASAIN 홈', 'home'), button('CUJASA 설정', 'settings'), button('POLIBOT 상품 추천', 'polibot-recommend'), button('DEXOR 후보 분석', 'dexor-upload')])
    }, { currentProduct });
  }
  if (/쿠자사|cujasa|쿠팡.*자동화|threads.*자동화|스레드.*자동화/.test(text) && /뭐|설명|란|어떤|서비스/.test(text)) {
    return normalizeAssistantResult({
      answer: 'CUJASA는 주제 선정, 쿠팡 상품 연결, Threads용 글 생성, 예약 업로드를 한 화면에서 처리하는 자동화 솔루션이에요. 설정에서 Threads와 쿠팡 API를 연결한 뒤 자동화 실행으로 예약 글을 만들 수 있어요.',
      intent: 'cujasa_product_overview',
      productId: 'cujasa',
      action: 'settings',
      draft: {},
      confidence: 0.86,
      requiresConfirmation: false,
      buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run'), button('포스팅 현황', 'posts')])
    }, { currentProduct });
  }
  const productId = productFromMessage(text, currentProduct);
  const grantedProducts = new Set(availableProducts);
  if (productId !== 'cujasa' && !grantedProducts.has(productId)) {
    const product = productById(productId);
    return normalizeAssistantResult({
      answer: `${product?.name || productId}는 먼저 시작하기를 눌러야 작업을 열 수 있어요. 오른쪽 제품 패널에서 바로 시작할 수 있게 열어둘게요.`,
      intent: 'product_start_required',
      productId,
      action: productId,
      draft: {},
      confidence: 0.95,
      requiresConfirmation: true,
      buttons: safeButtons([button(`${product?.name || productId} 시작`, productId), button('결제 확인', 'billing')])
    }, { currentProduct });
  }

  if (/결제|가격|월정액|영구|환불|입금|구매|카드|크레딧|충전/.test(text)) {
    return normalizeAssistantResult({
      answer: '결제 패널을 열게요. 현재 이용권, 결제 상태, 충전 정보를 확인할 수 있어요.',
      intent: 'billing_status',
      productId: currentProduct,
      action: 'billing',
      confidence: 0.88,
      buttons: safeButtons([button('결제 확인', 'billing')])
    }, { currentProduct });
  }

  const cujasaDraft = parseCujasaDraft(text);
  if (cujasaDraft) {
    return normalizeAssistantResult({
      answer: 'CUJASA 운영 설정 초안을 채웠어요. 오른쪽 설정 패널에서 타깃, 톤, 카테고리를 확인한 뒤 저장해 주세요.',
      intent: 'cujasa_settings_draft',
      productId: 'cujasa',
      action: 'settings',
      draft: cujasaDraft,
      confidence: 0.9,
      requiresConfirmation: true,
      buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run')])
    }, { currentProduct });
  }

  if (productId === 'cujasa') {
    if (/계정|로그아웃|비밀번호|아이디|이메일|연락처|회원/.test(text)) {
      return clarificationResult({
        currentProduct,
        answer: '계정 정보는 계정 설정에서 확인해 주세요. 지금은 작업 패널 대신 계정 메뉴로 안내할게요.',
        buttons: safeButtons([button('결제 확인', 'billing'), button('설정 열기', 'settings')])
      });
    }
    if (/설정|api|threads|스레드|쓰레드|쿠팡|세팅|연결|토큰|트래킹|tracking|시간|스케줄|예약 시간/.test(text)) {
      return normalizeAssistantResult({
        answer: 'CUJASA 설정 패널을 열게요. Threads 연결, 쿠팡 API, 스케줄을 확인할 수 있어요.',
        intent: 'cujasa_settings',
        productId: 'cujasa',
        action: 'settings',
        confidence: 0.88,
        buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run')])
      }, { currentProduct });
    }
    if (/포스팅|글|현황|결과|예약된|실패|확인 필요/.test(text)) {
      return normalizeAssistantResult({
        answer: '포스팅 현황 패널을 열게요. 예약, 완료, 확인 필요 글을 볼 수 있어요.',
        intent: 'cujasa_posts',
        productId: 'cujasa',
        action: 'posts',
        confidence: 0.82,
        buttons: safeButtons([button('포스팅 현황', 'posts'), button('자동화 실행', 'run')])
      }, { currentProduct });
    }
    if (/실행|자동화|예약|시작|돌려|생성/.test(text)) {
      return normalizeAssistantResult({
        answer: '자동화 실행 패널을 열게요. 사전 점검 후 오늘 예약을 만들 수 있어요.',
        intent: 'cujasa_run',
        productId: 'cujasa',
        action: 'run',
        confidence: 0.84,
        buttons: safeButtons([button('자동화 실행', 'run'), button('설정 열기', 'settings')])
      }, { currentProduct });
    }
    if (/성과|분석|클릭|대시|홈/.test(text)) {
      return normalizeAssistantResult({
        answer: '성과 화면을 열게요. 예약 수와 클릭 성과를 요약해서 볼 수 있어요.',
        intent: 'cujasa_home',
        productId: 'cujasa',
        action: 'home',
        confidence: 0.8,
        buttons: safeButtons([button('성과 보기', 'home'), button('포스팅 현황', 'posts')])
      }, { currentProduct });
    }
  }

  if (productId === 'polibot') {
    const summary = summarizePolibot(workspace.polibot || {});
    if (/왜\s*안|안\s*돼|실패|추천.*없|상품.*없|안\s*나/.test(text)) {
      const reason = summary.recommendationNotice
        || (summary.recommendableProducts <= 0
          ? '추천에 쓸 확정 상품 데이터가 아직 부족해요.'
          : '고객 조건과 추천 가능 상품의 매칭이 약해서 보수적으로 추천을 막았어요.');
      return normalizeAssistantResult({
        answer: `${reason} 현재 자동 확정 상품은 ${summary.recommendableProducts || 0}개, 확정 후 정보부족은 ${summary.insufficientProducts || 0}개, 검토 필요 후보는 ${summary.reviewNeededProducts || 0}개예요. 자료 화면에서 확정 상품의 가입조건, 담보, 주의 문구를 먼저 확인해 주세요.`,
        intent: 'polibot_recommendation_blocked_reason',
        productId: 'polibot',
        action: 'polibot-upload',
        draft: {},
        confidence: 0.9,
        requiresConfirmation: false,
        buttons: safeButtons([button('자료 확인', 'polibot-upload'), button('상품 추천', 'polibot-recommend')])
      }, { currentProduct });
    }
    if (/자료|데이터|많|보험사|지식|뭐.*있|얼마나/.test(text)) {
      const companyText = summary.companies.length ? summary.companies.slice(0, 8).join(', ') : '아직 보험사 목록이 부족해요';
      return normalizeAssistantResult({
        answer: `POLIBOT에는 자료 ${summary.knowledgeCount}개가 잡혀 있어요. 자동 확정 상품은 ${summary.recommendableProducts || 0}개, 확정 후 정보부족은 ${summary.insufficientProducts || 0}개, 검토 필요 후보는 ${summary.reviewNeededProducts || 0}개, OCR 필요 자료는 ${summary.ocrNeeded || 0}개예요. 최신 자료 월은 ${summary.latestMonth || '미확인'}이고, 보험사는 ${companyText} 기준으로 확인돼요.`,
        intent: 'polibot_knowledge_status',
        productId: 'polibot',
        action: 'polibot-upload',
        draft: {},
        confidence: 0.92,
        requiresConfirmation: false,
        buttons: safeButtons([button('월별 자료 보기', 'polibot-upload'), button('상품 추천', 'polibot-recommend')])
      }, { currentProduct });
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
      return normalizeAssistantResult({
        answer: 'POLIBOT 상품 추천 초안을 채웠어요. 오른쪽 패널에서 고객 조건을 확인한 뒤 추천 초안 만들기를 눌러주세요.',
        intent: 'polibot_recommendation_draft',
        productId: 'polibot',
        action: 'polibot-recommend',
        draft,
        confidence: 0.94,
        requiresConfirmation: true,
        buttons: safeButtons([button('상품 추천 열기', 'polibot-recommend'), button('자료 확인', 'polibot-upload')])
      }, { currentProduct });
    }
    if (/고객|목록|관리|저장/.test(text)) {
      return normalizeAssistantResult({
        answer: 'POLIBOT 고객 관리 패널을 열게요. 고객 조건과 추천 기록을 정리할 수 있어요.',
        intent: 'polibot_customers',
        productId: 'polibot',
        action: 'polibot-customers',
        confidence: 0.86,
        buttons: safeButtons([button('고객 관리', 'polibot-customers'), button('상품 추천', 'polibot-recommend')])
      }, { currentProduct });
    }
    if (/다운로드|내보내|csv|엑셀|결과/.test(text)) {
      return normalizeAssistantResult({
        answer: 'POLIBOT 결과 다운로드 패널을 열게요. 추천 결과를 CSV로 받을 수 있어요.',
        intent: 'polibot_download',
        productId: 'polibot',
        action: 'polibot-download',
        confidence: 0.84,
        buttons: safeButtons([button('결과 다운로드', 'polibot-download'), button('상품 추천', 'polibot-recommend')])
      }, { currentProduct });
    }
    return clarificationResult({
      currentProduct: 'polibot',
      answer: 'POLIBOT에서 자료 확인, 상품 추천, 고객 관리 중 어떤 작업을 열까요?',
      buttons: safeButtons([button('PDF 업로드', 'polibot-upload'), button('상품 추천', 'polibot-recommend'), button('고객 관리', 'polibot-customers')])
    });
  }

  if (productId === 'dexor') {
    const category = extractDexorCategory(text);
    if (/다운로드|내보내|csv|엑셀/.test(text)) {
      return normalizeAssistantResult({
        answer: 'DEXOR 결과 다운로드 패널을 열게요. 화면에 보이는 정렬 그대로 CSV를 받을 수 있어요.',
        intent: 'dexor_download',
        productId: 'dexor',
        action: 'dexor-download',
        draft: {},
        confidence: 0.9,
        requiresConfirmation: false,
        buttons: safeButtons([button('결과 다운로드', 'dexor-download'), button('등급 분석', 'dexor-grade')])
      }, { currentProduct });
    }
    if (/결과|등급|점수|랭크|분석.*봤/.test(text)) {
      return normalizeAssistantResult({
        answer: 'DEXOR 등급 분석 패널을 열게요. 후보를 먼저 저장했다면 S/A/B/C/D 순서로 결과를 확인할 수 있어요.',
        intent: 'dexor_grade',
        productId: 'dexor',
        action: 'dexor-grade',
        draft: category ? { targetCategory: category } : {},
        confidence: 0.88,
        requiresConfirmation: false,
        buttons: safeButtons([button('등급 분석', 'dexor-grade'), button('후보 업로드', 'dexor-upload')])
      }, { currentProduct });
    }
    if (/분석|후보|블로그|씨랭|등급|맛집|뷰티|육아|가전|여행/.test(text)) {
      return normalizeAssistantResult({
        answer: `${category || '선택한'} 카테고리 기준으로 DEXOR 후보 업로드 화면을 열게요. URL이나 CSV를 넣은 뒤 저장하면 등급 분석으로 넘어갈 수 있어요.`,
        intent: 'dexor_candidate_draft',
        productId: 'dexor',
        action: 'dexor-upload',
        draft: category ? { targetCategory: category } : {},
        confidence: 0.86,
        requiresConfirmation: true,
        buttons: safeButtons([button('후보 업로드', 'dexor-upload'), button('등급 분석', 'dexor-grade')])
      }, { currentProduct });
    }
    return clarificationResult({
      currentProduct: 'dexor',
      answer: 'DEXOR에서 후보 업로드, 등급 분석, 다운로드 중 어떤 작업을 열까요?',
      buttons: safeButtons([button('후보 업로드', 'dexor-upload'), button('등급 분석', 'dexor-grade'), button('결과 다운로드', 'dexor-download')])
    });
  }

  if (productId === 'spread') {
    if (/참여자|신청자|선정|후보/.test(text)) {
      return normalizeAssistantResult({
        answer: 'SPREAD 참여자 선정 패널을 열게요. 신청자와 선정 기준을 비교할 수 있어요.',
        intent: 'spread_applicants',
        productId: 'spread',
        action: 'spread-applicants',
        confidence: 0.86,
        buttons: safeButtons([button('참여자 선정', 'spread-applicants'), button('캠페인 추천', 'spread-campaign')])
      }, { currentProduct });
    }
    if (/제출|검수|url|키워드|금지/.test(text)) {
      return normalizeAssistantResult({
        answer: 'SPREAD 제출물 검수 패널을 열게요. 제출 URL과 필수 조건을 점검할 수 있어요.',
        intent: 'spread_review',
        productId: 'spread',
        action: 'spread-review',
        confidence: 0.86,
        buttons: safeButtons([button('제출물 검수', 'spread-review'), button('참여자 선정', 'spread-applicants')])
      }, { currentProduct });
    }
    return normalizeAssistantResult({
      answer: 'SPREAD 캠페인 초안 패널을 열게요. 캠페인 목표, 채널, 상품 유형을 확인한 뒤 저장하면 돼요.',
      intent: 'spread_campaign_draft',
      productId: 'spread',
      action: 'spread-campaign',
      draft: {
        goal: text.match(/(?:목표|목적|캠페인)\s*([가-힣A-Za-z0-9\s]{2,30})/)?.[1]?.trim() || '',
        channel: /인스타|instagram/i.test(text) ? 'Instagram' : /블로그/.test(text) ? 'Blog' : '',
        product: text.match(/(?:상품|제품)\s*([가-힣A-Za-z0-9\s]{2,30})/)?.[1]?.trim() || ''
      },
      confidence: /스프레드|spread|캠페인/.test(lower) ? 0.84 : 0.64,
      requiresConfirmation: true,
      buttons: safeButtons([button('캠페인 추천', 'spread-campaign')])
    }, { currentProduct });
  }

  return clarificationResult({
    currentProduct,
    answer: '정확히 어떤 작업을 열지 한 번만 골라주세요. 그 다음부터는 문장을 더 넓게 이해해서 이어갈게요.',
    buttons: safeButtons([button('설정 열기', 'settings'), button('자동화 실행', 'run'), button('상품 추천', 'polibot-recommend'), button('후보 분석', 'dexor-upload')])
  });
}

export function buildTestWorkspaceAssistantWorkflow(options = {}) {
  return buildPolibotWorkflowResult(options);
}

function deterministicAssistant(options) {
  return classifyWorkspaceAssistantIntent(options);
}

function validateAssistantResponse(value) {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'response is not object' };
  if (typeof value.answer !== 'string') return { ok: false, reason: 'answer missing' };
  if (value.action && !ACTION_KEYS.has(value.action)) return { ok: false, reason: 'invalid action' };
  if (value.productId && !PRODUCT_IDS.has(value.productId)) return { ok: false, reason: 'invalid productId' };
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
    'workspace_assistant_slow_ai',
    'workspace_assistant_clarification',
    'workspace_assistant_workflow_step'
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
  const workflowPayload = payload.assistantWorkflow && typeof payload.assistantWorkflow === 'object'
    ? payload.assistantWorkflow
    : {};
  if (shouldUseTestWorkflow(message, currentProduct, payload.currentAction || '', workflowPayload)) {
    const workflowResult = buildPolibotWorkflowResult({
      message,
      currentProduct,
      workflow: workflowPayload
    });
    await logWorkspaceAssistant(userId, {
      action: 'workspace_assistant_workflow_step',
      message,
      durationMs: Date.now() - startedAt,
      payload: {
        source: workflowResult.source,
        intent: workflowResult.intent,
        action: workflowResult.action || '',
        productId: workflowResult.productId || '',
        confidence: workflowResult.confidence,
        readyToSubmit: Boolean(workflowResult.readyToSubmit),
        missingFields: (workflowResult.missingFields || []).map((field) => field.label || field.key),
        currentProduct,
        inferredProduct
      }
    });
    return workflowResult;
  }
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
        productId: deterministic.productId || '',
        confidence: deterministic.confidence,
        hasDraft: Object.keys(deterministic.draft || {}).length > 0,
        clarification: Boolean(deterministic.clarification),
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
        'Return productId and confidence between 0 and 1.',
        'If confidence is low, return action empty, intent clarification_required, requiresConfirmation true, and 2-4 buttons.',
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
        payload: { reason, currentProduct, inferredProduct, source: 'ai_fallback' }
      });
    }
  });
  const availableProducts = new Set(payload.availableProducts || []);
  const taskProduct = String(response.action || '').split('-')[0];
  if (PRODUCT_IDS.has(taskProduct) && taskProduct !== 'cujasa' && !availableProducts.has(taskProduct)) {
    const product = productById(taskProduct);
    const gated = normalizeAssistantResult({
      answer: `${product?.name || taskProduct}는 먼저 시작하기를 눌러야 작업을 열 수 있어요. 오른쪽 제품 패널에서 바로 시작할 수 있게 열어둘게요.`,
      intent: 'product_start_required',
      productId: taskProduct,
      action: taskProduct,
      draft: {},
      confidence: 0.95,
      source: 'server_access_gate',
      requiresConfirmation: true,
      buttons: safeButtons([button(`${product?.name || taskProduct} 시작`, taskProduct), button('결제 확인', 'billing')])
    }, { currentProduct });
    await logWorkspaceAssistant(userId, {
      action: 'workspace_assistant_faq_hit',
      message,
      durationMs: Date.now() - startedAt,
      payload: {
        source: gated.source,
        intent: gated.intent,
        action: gated.action,
        productId: gated.productId,
        confidence: gated.confidence,
        hasDraft: false,
        clarification: false,
        currentProduct,
        inferredProduct
      }
    });
    return gated;
  }

  let result = normalizeAssistantResult(response, { currentProduct, source: 'ai_json', confidence: 0.7 });
  if (result.confidence < LOW_CONFIDENCE_THRESHOLD && !result.clarification) {
    result = clarificationResult({
      currentProduct,
      answer: result.answer || '확실히 맞는 작업을 고르기 어려워요. 아래에서 가까운 항목을 선택해 주세요.',
      buttons: result.buttons.length ? result.buttons : [button('설정 열기', 'settings'), button('자동화 실행', 'run'), button('상품 추천', 'polibot-recommend')]
    });
    result.source = 'ai_low_confidence';
  }
  await logWorkspaceAssistant(userId, {
    action: result.intent === 'fallback'
      ? 'workspace_assistant_fallback'
      : result.clarification
        ? 'workspace_assistant_clarification'
        : 'workspace_assistant_ai_answer',
    message,
    level: result.intent === 'fallback' ? 'warn' : 'info',
    durationMs: Date.now() - startedAt,
    payload: {
      source: result.source,
      intent: result.intent,
      action: result.action,
      productId: result.productId,
      confidence: result.confidence,
      hasDraft: Object.keys(result.draft || {}).length > 0,
      clarification: Boolean(result.clarification),
      currentProduct,
      inferredProduct
    }
  });
  return result;
}
