import { dbGet, dbInsert, dbList, dbUpdate, logActivity, supabase } from './supabaseService.js';
import { AUTOMATION_RUNNING, setAutomationStatus } from './accountAutomationService.js';
import { createDailySchedulePlan } from '../utils/randomSchedule.js';
import { randomUUID } from 'node:crypto';
import { prepareGeneratedPostBody } from '../utils/koreanContentQuality.js';
import { scorePostEngagement } from '../utils/postEngagementScoring.js';
import { scorePostHook, validatePostStyleFit } from '../utils/accountStyle.js';
import { checkAndRewriteRisk } from './riskService.js';
import { shortCode } from '../utils/slug.js';

const DEFAULT_PLATFORMS = ['threads', 'instagram'];
const MAX_DAYS = 14;
const MAX_DAILY = 3;
const OBJECTIVE_TYPES = new Set(['click', 'consultation', 'save_follow', 'awareness', 'lead']);
const PRIORITIES = new Set(['low', 'normal', 'high']);
const ASSET_STATUSES = new Set(['draft', 'preview', 'needs_review', 'approved', 'queued', 'posted', 'rejected', 'stopped']);
const LEAD_FIELD_LABELS = {
  name: '이름',
  phone: '연락처',
  email: '이메일',
  business: '사업/계정 유형',
  budget: '관심 수준',
  message: '문의 내용'
};
const DEFAULT_LEAD_FIELDS = ['name', 'phone'];

function clean(value) {
  return String(value || '').trim();
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function dateKey(value) {
  const date = parseDate(value);
  if (!date) return 'unknown';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function hourKey(value) {
  const date = parseDate(value);
  if (!date) return 'unknown';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(date).replace(/\D/g, '').padStart(2, '0');
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function safeImageSource(value) {
  const source = clean(value);
  if (!source) return '';
  if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,[a-z0-9+/=]+$/i.test(source)) return source;
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

async function getRequiredAutomationAccount(accountId) {
  const id = clean(accountId);
  if (!id) {
    const error = new Error('accountId is required to run Automation Studio campaigns');
    error.status = 400;
    throw error;
  }
  const account = await dbGet('accounts', { id });
  if (!account) {
    const error = new Error('Automation Studio account not found');
    error.status = 404;
    throw error;
  }
  return account;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizePlatforms(value) {
  const source = Array.isArray(value) && value.length ? value : DEFAULT_PLATFORMS;
  const allowed = source.filter((platform) => DEFAULT_PLATFORMS.includes(platform));
  return [...new Set(allowed)].length ? [...new Set(allowed)] : DEFAULT_PLATFORMS;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[,|]/).map(clean).filter(Boolean);
}

function normalizeLeadFields(value) {
  const fields = normalizeArray(value).filter((field) => LEAD_FIELD_LABELS[field]);
  return [...new Set(fields.length ? fields : DEFAULT_LEAD_FIELDS)];
}

function publicBaseUrl() {
  return (process.env.APP_BASE_URL || process.env.CLIENT_BASE_URL || `http://localhost:${process.env.PORT || 3005}`).split(',')[0].replace(/\/$/, '');
}

function leadFormPublicUrl(slug) {
  return `${publicBaseUrl()}/lead-forms/${slug}`;
}

function campaignInput(body = {}) {
  const product = body.product || {};
  const productName = clean(body.productName || product.name);
  const targetGoal = clean(body.targetGoal || body.goal);
  if (!productName) {
    const error = new Error('productName is required');
    error.status = 400;
    throw error;
  }
  if (!targetGoal) {
    const error = new Error('targetGoal is required');
    error.status = 400;
    throw error;
  }
  const platforms = normalizePlatforms(body.platforms);
  const dailyMin = clampInt(body.dailyPostMin ?? body.daily_post_min, 1, MAX_DAILY, 1);
  const dailyMax = clampInt(body.dailyPostMax ?? body.daily_post_max, dailyMin, MAX_DAILY, Math.max(1, dailyMin));
  const objectiveType = OBJECTIVE_TYPES.has(body.objectiveType || body.objective_type) ? (body.objectiveType || body.objective_type) : 'click';
  const priority = PRIORITIES.has(body.priority) ? body.priority : 'normal';
  const operationSet = {
    toneStyle: clean(body.toneStyle || body.tone_style) || 'clear_operator',
    hookStyle: clean(body.hookStyle || body.hook_style) || 'situation_first',
    cardStyle: clean(body.cardStyle || body.card_style) || 'square_product_card',
    optimizationGoal: clean(body.optimizationGoal || body.optimization_goal) || objectiveType,
    conversionDestination: clean(body.conversionDestination || body.conversion_destination) || (objectiveType === 'lead' ? 'lead_form' : 'website'),
    leadOffer: clean(body.leadOffer || body.lead_offer),
    leadFields: normalizeLeadFields(body.leadFields || body.lead_fields),
    leadPrivacyNote: clean(body.leadPrivacyNote || body.lead_privacy_note),
    leadThankYouMessage: clean(body.leadThankYouMessage || body.lead_thank_you_message),
    audienceStage: clean(body.audienceStage || body.audience_stage) || 'cold',
    audiencePersona: clean(body.audiencePersona || body.audience_persona),
    audiencePain: clean(body.audiencePain || body.audience_pain),
    placementMode: clean(body.placementMode || body.placement_mode) || 'threads_instagram_feed',
    creativeFormat: clean(body.creativeFormat || body.creative_format) || 'short_copy_square_card',
    primaryMessage: clean(body.primaryMessage || body.primary_message),
    proofPoint: clean(body.proofPoint || body.proof_point),
    complianceNote: clean(body.complianceNote || body.compliance_note),
    activeTimeWindow: {
      start: clean(body.activeStart || body.active_start) || '09:00',
      end: clean(body.activeEnd || body.active_end) || '21:00'
    }
  };
  return {
    accountId: clean(body.accountId || body.account_id) || null,
    name: clean(body.name) || `${productName} 자동화 캠페인`,
    productName,
    productUrl: clean(body.productUrl || product.url || product.product_url),
    productPrice: body.productPrice ?? product.price ?? null,
    productImageUrl: clean(body.productImageUrl || product.imageUrl || product.image_url || product.product_image),
    objectiveType,
    targetGoal,
    targetAudience: clean(body.targetAudience || body.audience),
    accountHandle: clean(body.accountHandle || body.account_handle),
    priority,
    operationSet,
    nextActionNote: clean(body.nextActionNote || body.next_action_note),
    platforms,
    dailyPostMin: dailyMin,
    dailyPostMax: dailyMax,
    days: clampInt(body.days, 1, MAX_DAYS, 3),
    generationInput: {
      product,
      objectiveType,
      priority,
      operationSet,
      raw: body
    }
  };
}

function won(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '';
  return `${Math.round(number).toLocaleString('ko-KR')}원`;
}

function shortProductName(name) {
  return clean(name).replace(/\s+/g, ' ').slice(0, 34);
}

function audiencePrimary(value) {
  return clean(value).split(/[,/·|]/).map((item) => item.trim()).filter(Boolean)[0] || '바쁜 운영자';
}

function audiencePersona(value) {
  const audience = audiencePrimary(value);
  if (/^부업$/.test(audience)) return '부업을 시작하려는 분들';
  if (/관심자$/.test(audience)) return audience.replace(/관심자$/, '관심 있는 분들');
  if (/사람|분|운영자|셀러|고객|팀|브랜드|사업자|크리에이터|마케터/.test(audience)) return audience;
  return `${audience}에 관심 있는 분들`;
}

function audienceCondition(value) {
  const audience = audiencePersona(value);
  return /(분|분들|사람|사람들|운영자|셀러|고객|팀|브랜드|사업자|크리에이터|마케터)$/.test(audience)
    ? `${audience}이라면`
    : `${audience}라면`;
}

function assetCopyValue(asset) {
  if (!asset) return '';
  return clean(asset.platform === 'instagram'
    ? (asset.metadata?.caption || asset.body || asset.title)
    : (asset.body || asset.title));
}

function productPromise(productName, objectiveType) {
  const name = clean(productName).toLowerCase();
  if (/쿠자사|cujasa/.test(name)) {
    return {
      category: '어필리에이트 자동화',
      pain: '제휴 링크 수익화는 하고 싶은데 상품 선정, 글 작성, 예약 운영이 계속 번거로울 때',
      benefit: '상품 추천 콘텐츠와 어필리에이트 운영 흐름을 자동화하는 프로그램',
      proof: '반복되는 상품 추천 콘텐츠 운영을 줄이고, 운영자는 계정과 성과만 보면 됩니다.',
      lines: [
        '쿠팡 파트너스 자동화 프로그램 만들었습니다. 상품 찾기, 글 생성, 예약까지 쿠자사로 줄여보세요.',
        '쿠파스 자동화 프로그램 완성했습니다. 쿠자사로 제휴 콘텐츠 운영을 매번 손으로 하지 않아도 됩니다.',
        '자는 동안에도 예약 콘텐츠가 돌아가게, 쿠자사로 쿠팡 파트너스 운영을 자동화해보세요.',
        '쿠팡 파트너스 부업을 시작하고 싶다면, 쿠자사로 상품 추천 콘텐츠부터 자동화해보세요.',
        '상품 고르고 글 쓰고 예약하는 반복 작업, 쿠자사 하나로 줄일 수 있습니다.',
        '쿠파스 자동화로 제휴 링크 콘텐츠를 꾸준히 돌리고 싶은 분들께 쿠자사를 소개합니다.',
        '쿠팡 파트너스 수익화를 노린다면, 먼저 반복 운영부터 쿠자사로 자동화해보세요.',
        '어필리에이트 계정 운영이 막막하다면, 쿠자사로 상품 추천 글과 예약 흐름부터 잡아보세요.',
        '쿠팡 파트너스 자동화가 필요했다면, 쿠자사로 상품 선정부터 포스팅까지 가볍게 시작하세요.',
        '부업 계정을 굴리고 싶은데 시간이 없다면, 쿠자사로 제휴 콘텐츠 운영을 자동화해보세요.',
        '쿠파스 운영을 혼자 계속 하기 힘들다면, 쿠자사로 반복 작업을 대신 줄여보세요.',
        '상품 추천 콘텐츠를 꾸준히 쌓고 싶다면, 쿠자사로 자동 생성과 예약 운영을 시작하세요.'
      ]
    };
  }
  if (/자사인|jasain/.test(name)) {
    return {
      category: '자동화 운영',
      pain: '제품은 있는데 매일 보여줄 콘텐츠 흐름이 끊길 때',
      benefit: '제품별 목표에 맞춰 글과 카드 소재를 빠르게 만들 수 있는 운영 체계',
      proof: '소재 생성, 예약, 검수, 다음 액션을 한 화면에서 관리합니다.',
      lines: [
        '오늘 밀 제품이 있다면, 자사인에서 글과 카드부터 먼저 뽑아보세요.',
        '광고 소재가 여기저기 흩어졌다면, 자사인에서 예약까지 같이 보세요.',
        '제품을 어떻게 말해야 할지 애매할 때, 자사인에서 첫 문장부터 잡아보세요.',
        '반응 볼 소재가 필요하다면, 자사인에서 만들고 바로 예약해두세요.',
        '오늘 올릴 제품이 정해졌다면, 자사인에서 카드와 캡션을 먼저 만들어보세요.',
        '소재 검수와 예약을 따로 보기 번거롭다면, 자사인에서 한 번에 정리하세요.',
        '제품별로 반응을 비교하려면, 자사인에서 짧은 소재부터 여러 개 뽑아보세요.',
        '운영 메모까지 남겨야 한다면, 자사인에서 소재별 다음 액션을 같이 잡아두세요.'
      ]
    };
  }
  return {
    category: '제품 추천',
    pain: '비슷한 제품이 많아서 무엇을 기준으로 봐야 할지 헷갈릴 때',
    benefit: `${productName}을 필요한 상황과 선택 기준 중심으로 비교하게 해주는 제품`,
    proof: objectiveType === 'consultation'
      ? '상황을 남기면 더 맞는 기준으로 좁혀볼 수 있습니다.'
      : '구매 전 확인할 기준을 짧게 정리해두면 선택이 쉬워집니다.'
  };
}

function isAffiliateAutomationProduct(productName) {
  return /쿠자사|cujasa|쿠파스|쿠팡\s*파트너스|어필리에이트|affiliate/i.test(clean(productName));
}

function objectiveCta(objectiveType) {
  return {
    click: '자세히 보기',
    consultation: '상담 문의하기',
    save_follow: '저장해두기',
    awareness: '먼저 알아보기',
    lead: '무료 안내 받기'
  }[objectiveType] || '자세히 보기';
}

function primaryMessageConcept(value) {
  let concept = clean(value)
    .replace(/cusa?ja|cujasa/ig, 'CUJASA')
    .replace(/쿠자사|CUJASA/g, '')
    .replace(/수익\s*창출|수익창출/g, '수익화 운영')
    .replace(/수익\s*보장|무조건\s*수익|100%\s*수익|자동으로\s*돈\s*벌(?:기)?/g, '수익화 운영')
    .replace(/\s*(으로|로)\s+/g, ' ')
    .replace(/[.!?。]+$/g, '')
    .replace(/\s*(해\s*보세요|해주세요|해\s*주세요|하세요|해요|합니다|한다|하다|입니다|이에요|예요|됩니다|된다|되다|하자)$/g, '')
    .replace(/\s*(돕는다|돕습니다|도와요)$/g, '돕는 흐름')
    .replace(/\s+/g, ' ')
    .trim();
  const hasProfitSignal = /수익|수익화|부업|제휴|어필리에이트|파트너스/.test(concept);
  const hasAutomationSignal = /자동화|자동|운영|예약/.test(concept);
  if (hasProfitSignal && hasAutomationSignal) {
    concept = '수익화 운영 자동화';
  }
  if (!concept) return '';
  return compactSentence(concept, 42);
}

function seededAdLine(input, index) {
  const operationSet = input.operationSet || {};
  const concept = primaryMessageConcept(operationSet.primaryMessage);
  if (!concept) return '';
  const product = shortProductName(input.productName);
  const audience = audiencePersona(input.targetAudience);
  const audienceIf = audienceCondition(input.targetAudience);
  const proof = clean(operationSet.proofPoint || input.targetGoal);
  const proofPart = proof ? `${compactSentence(proof, 34)}까지` : '콘텐츠 생성과 예약까지';
  const conceptTopic = concept.replace(/자동화$/, '').trim() || concept;
  const lines = [
    `${conceptTopic}이 목표라면 ${product}로 상품 선정부터 예약까지 흐름을 잡아보세요.`,
    `매번 손으로 반복하던 ${conceptTopic} 작업, ${product}로 글 생성과 예약을 나눠서 줄여보세요.`,
    `${audience}에게는 ${product}처럼 ${conceptTopic} 흐름을 꾸준히 돌릴 운영 루틴이 필요합니다.`,
    `${conceptTopic} 흐름을 시작하고 싶다면 ${product}에서 콘텐츠 생성과 예약부터 가볍게 시작하세요.`,
    `${product}는 ${conceptTopic} 흐름과 ${proofPart} 한 번에 운영할 수 있게 돕습니다.`,
    `과장된 약속보다 꾸준한 운영이 먼저라면, ${product}로 ${concept} 기반을 잡아보세요.`,
    `제휴 콘텐츠를 오래 돌리고 싶다면 ${product}로 ${conceptTopic} 작업을 자동화해보세요.`,
    `${product}로 오늘 올릴 글부터 예약까지 묶어두고 ${conceptTopic} 흐름을 이어가세요.`,
    `상품 찾기부터 예약까지 자주 막힌다면 ${product}로 ${conceptTopic} 루틴을 먼저 정리해보세요.`,
    `${audienceIf} ${product}로 ${conceptTopic}에 필요한 반복 작업을 줄여보세요.`,
    `처음부터 큰 약속을 하기보다, ${product}로 ${conceptTopic}을 꾸준히 운영할 구조를 만들어보세요.`,
    `${proofPart} 이어가야 한다면 ${product}에서 ${conceptTopic} 소재를 여러 각도로 준비해보세요.`,
    `${product}는 ${conceptTopic}을 한 번에 끝낸다고 말하기보다, 반복 운영 시간을 줄이는 데 집중합니다.`,
    `매일 같은 글이 걱정된다면 ${product}로 ${conceptTopic} 문구와 예약 흐름을 나눠 관리해보세요.`,
    `${conceptTopic}을 혼자 붙잡고 있기보다 ${product}로 생성, 검수, 예약을 한 번에 정리하세요.`,
    `제휴 콘텐츠 운영을 오래 보려면 ${product}로 ${conceptTopic} 흐름부터 안정적으로 잡아보세요.`
  ];
  return compactSentence(lines[index % lines.length], 112);
}

function adLine(input, index) {
  const product = shortProductName(input.productName);
  const audience = audiencePrimary(input.targetAudience);
  const promise = productPromise(product, input.objectiveType);
  const cta = objectiveCta(input.objectiveType);
  const operationSet = input.operationSet || {};
  const seeded = seededAdLine(input, index);
  if (seeded) return seeded;
  if (input.objectiveType === 'lead') {
    const offer = operationSet.leadOffer || '도입 안내';
    const lines = [
      `${product} 자동화가 궁금하다면 ${offer}부터 받아보세요.`,
      `${audience}라면 ${product}로 어떤 반복 업무를 줄일 수 있는지 먼저 확인해보세요.`,
      `${product} 도입 전 체크할 내용을 ${offer}로 짧게 정리해드립니다.`
    ];
    return lines[index % lines.length];
  }
  if (input.objectiveType === 'consultation') {
    const lines = [
      `${product} 도입이 고민된다면 지금 운영 상황부터 가볍게 상담해보세요.`,
      `${audience}에게 맞는 ${product} 활용 흐름을 먼저 상담으로 확인해보세요.`,
      `${product}로 줄일 수 있는 반복 업무가 있는지 상담에서 바로 짚어드립니다.`
    ];
    return lines[index % lines.length];
  }
  if (promise.lines?.length) return promise.lines[index % promise.lines.length];
  const lines = [
    `${product} 찾고 있었다면, 가격보다 실제로 쓸 장면부터 먼저 보세요.`,
    `${audience}에게는 ${product}처럼 바로 쓰기 쉬운 쪽이 더 편할 수 있어요.`,
    `${product}는 상세 스펙보다 실제 사용 장면을 먼저 보고 고르는 게 좋습니다.`,
    `비슷한 제품이 많다면 ${product}부터 내 상황에 맞는지 확인해보세요.`
  ];
  return `${lines[index % lines.length].replace(/\s+/g, ' ').trim()} ${cta}`;
}

function compactSentence(value, limit = 96) {
  const sentence = clean(value).replace(/\s+/g, ' ');
  if (sentence.length <= limit) return sentence;
  return `${sentence.slice(0, limit - 1).trim()}…`;
}

function scoreInternalAdCopy(body, input, account = {}) {
  const text = clean(body);
  const first = scorePostHook(text);
  const engagement = scorePostEngagement(text, {
    products: [{ product_name: input.productName }]
  });
  const styleFit = validatePostStyleFit(text, account || {});
  const isAffiliate = isAffiliateAutomationProduct(input.productName);
  const checks = {
    concise: text.length >= 18 && text.length <= 115 && !text.includes('\n'),
    offerClear: isAffiliate
      ? /(쿠팡\s*파트너스|쿠파스|어필리에이트|제휴|자동화|예약|상품\s*추천|수익화)/.test(text)
      : clean(input.productName) ? text.includes(shortProductName(input.productName).slice(0, 8)) : true,
    naturalKorean: !/(이런 상황이면|먼저 보여주세요|상세 스펙만|기준은 봐야|반응이 갈립니다|고객이 바로 보는 포인트)/.test(text),
    hardPromiseSafe: !/(수익\s*보장|무조건\s*수익|100%\s*수익|자동으로\s*돈\s*벌)/.test(text),
    hasAction: /(만들|완성|줄여|돌아가|시작|자동화|예약|운영|확인|소개|받아|보기|문의)/.test(text),
    notGeneric: !/(제품 관심 전환|타깃|가격대|핵심은|상황이면)/.test(text)
  };
  const qualityScore = Math.max(0, Math.min(100, Math.round(
    18
    + (checks.concise ? 18 : 4)
    + (checks.offerClear ? 20 : 2)
    + (checks.naturalKorean ? 16 : -16)
    + (checks.hardPromiseSafe ? 12 : -30)
    + (checks.hasAction ? 12 : 2)
    + (checks.notGeneric ? 10 : -10)
    + Math.min(12, Math.round(engagement.engagementScore / 10))
  )));
  const warnings = [];
  if (!checks.concise) warnings.push('한 문장 광고로 쓰기엔 길거나 줄바꿈이 있습니다.');
  if (!checks.offerClear) warnings.push('무엇을 파는지 한눈에 약합니다.');
  if (!checks.naturalKorean) warnings.push('기존 생성 문구처럼 어색한 표현이 감지됐습니다.');
  if (!checks.hardPromiseSafe) warnings.push('수익 보장처럼 보일 수 있는 표현은 피해야 합니다.');
  if (!checks.hasAction) warnings.push('사용자가 바로 이해할 행동/효용이 약합니다.');
  if (!checks.notGeneric) warnings.push('목표/타깃 설명문처럼 보이는 표현이 섞였습니다.');
  if (!styleFit.allowed && !isAffiliate) warnings.push(...styleFit.reasons);
  return {
    qualityScore,
    qualityStatus: qualityScore >= 76 ? 'ready' : qualityScore >= 58 ? 'review' : 'weak',
    firstSentence: first.firstSentence,
    hookScore: first.score,
    engagementScore: engagement.engagementScore,
    engagementPattern: engagement.engagementPattern,
    checks,
    warnings: [...new Set(warnings)].slice(0, 6)
  };
}

function qualityReviewStatus(quality) {
  return quality.qualityStatus === 'ready' ? 'queued' : 'needs_review';
}

function enhanceAutomationAsset(asset, input, account = {}) {
  const copyField = asset.platform === 'instagram' ? 'caption' : 'body';
  const rawCopy = asset.platform === 'instagram' ? (asset.metadata?.caption || asset.body || asset.title) : (asset.body || asset.title);
  const prepared = prepareGeneratedPostBody(compactSentence(rawCopy));
  const risk = checkAndRewriteRisk(prepared.body);
  const quality = scoreInternalAdCopy(risk.body, input, account || {});
  const metadata = {
    ...(asset.metadata || {}),
    quality,
    qualityScore: quality.qualityScore,
    qualityStatus: quality.qualityStatus,
    qualityWarnings: [...new Set([...(prepared.warnings || []), ...quality.warnings])],
    riskLevel: risk.riskLevel,
    reviewStatus: qualityReviewStatus(quality),
    qualityCheckedAt: new Date().toISOString()
  };
  if (copyField === 'caption') {
    metadata.caption = risk.body;
    metadata.adCopy = risk.body;
    return {
      ...asset,
      title: asset.title,
      body: `${shortProductName(input.productName)} 카드 이미지`,
      cta: asset.cta,
      metadata
    };
  }
  return {
    ...asset,
    title: risk.body,
    body: risk.body,
    metadata
  };
}

function buildThreadsAsset(input, index) {
  const product = shortProductName(input.productName);
  const body = adLine(input, index);
  return {
    platform: 'threads',
    asset_type: 'text',
    title: body,
    body,
    cta: objectiveCta(input.objectiveType),
    metadata: { variant: index + 1, style: 'one_line_ad_copy', objectiveType: input.objectiveType, product }
  };
}

function escapeSvg(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function buildInstagramAsset(input, index) {
  const product = shortProductName(input.productName);
  const price = won(input.productPrice);
  const audience = audiencePrimary(input.targetAudience);
  const promise = productPromise(product, input.objectiveType);
  const line = adLine(input, index);
  const [lineA, lineB] = splitCardLine(line);
  const accent = ['#111827', '#0f766e', '#4338ca'][index % 3];
  const imageUrl = safeImageSource(input.productImageUrl);
  const mediaBlock = imageUrl
    ? `<image href="${escapeSvg(imageUrl)}" x="116" y="170" width="316" height="316" preserveAspectRatio="xMidYMid slice" />`
    : `<rect x="116" y="170" width="316" height="316" rx="18" fill="#f3f4f6"/><text x="274" y="338" text-anchor="middle" font-size="28" font-weight="800" fill="#9ca3af">PRODUCT</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <rect width="1080" height="1080" fill="#f8fafc"/>
  <rect x="76" y="76" width="928" height="928" rx="28" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>
  <rect x="76" y="76" width="928" height="132" rx="28" fill="${accent}"/>
  <text x="122" y="158" font-size="42" font-weight="900" fill="#ffffff">${escapeSvg(promise.category)}</text>
  <g>${mediaBlock}</g>
  <text x="584" y="258" font-size="34" font-weight="900" fill="#111827">${escapeSvg(product)}</text>
  <text x="584" y="320" font-size="26" font-weight="700" fill="#475569">${escapeSvg(audience)} 기준 추천</text>
  <rect x="584" y="370" width="330" height="56" rx="12" fill="#f1f5f9"/>
  <text x="608" y="407" font-size="24" font-weight="800" fill="${accent}">${escapeSvg(price || 'Preview only')}</text>
  <text x="122" y="640" font-size="46" font-weight="900" fill="#111827">${escapeSvg(lineA)}</text>
  <text x="122" y="704" font-size="46" font-weight="900" fill="#111827">${escapeSvg(lineB)}</text>
  <text x="122" y="772" font-size="26" font-weight="700" fill="#64748b">${escapeSvg(product)} · ${escapeSvg(audience)}</text>
  <rect x="122" y="842" width="836" height="92" rx="18" fill="#111827"/>
  <text x="540" y="900" text-anchor="middle" font-size="30" font-weight="900" fill="#ffffff">${escapeSvg(objectiveCta(input.objectiveType)).slice(0, 32)}</text>
</svg>`;
  return {
    platform: 'instagram',
    asset_type: 'image_card',
    title: `${product} 인스타그램 카드`,
    body: `${product} 카드 이미지`,
    cta: '미리보기 승인 후 수동 업로드 대기',
    image_data_url: svgDataUrl(svg),
    metadata: {
      variant: index + 1,
      style: input.operationSet?.cardStyle || 'square_product_card',
      sourceProductImageUrl: imageUrl,
      uploadPolicy: 'preview_only_no_graph_api',
      caption: line,
      adCopy: line
    }
  };
}

function campaignAssetInput(campaign) {
  return {
    productName: campaign.product_name,
    productUrl: campaign.product_url,
    productPrice: campaign.product_price,
    productImageUrl: campaign.product_image_url || campaign.generation_input?.productImageUrl,
    objectiveType: campaign.objective_type || campaign.generation_input?.objectiveType || 'click',
    targetGoal: campaign.target_goal,
    targetAudience: campaign.target_audience,
    accountHandle: campaign.account_handle,
    operationSet: campaign.operation_set || campaign.generation_input?.operationSet || {}
  };
}

function buildAutomationAssetForPlatform(input, platform, index, account = {}) {
  const builder = platform === 'instagram' ? buildInstagramAsset : buildThreadsAsset;
  return enhanceAutomationAsset(builder(input, index), input, account);
}

function splitCardLine(value) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (words.length <= 5) return [clean(value).slice(0, 24), ''];
  const mid = Math.ceil(words.length / 2);
  return [
    words.slice(0, mid).join(' ').slice(0, 24),
    words.slice(mid).join(' ').slice(0, 24)
  ];
}

function queueStatusForAsset(asset) {
  if (asset.platform === 'instagram') return 'manual_required';
  return asset.metadata?.reviewStatus === 'needs_review' ? 'manual_required' : 'scheduled';
}

function postBodyForAsset(asset) {
  if (asset.platform === 'instagram') return asset.metadata?.caption || asset.body || asset.title;
  return asset.body;
}

function trackingUrlForLink(link) {
  if (!link?.code) return '';
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3005}`;
  return `${baseUrl.replace(/\/$/, '')}/r/${link.code}`;
}

function postBodyWithTracking(asset, link) {
  const body = postBodyForAsset(asset);
  const trackingUrl = trackingUrlForLink(link);
  if (!trackingUrl) return body;
  if (String(body || '').includes(trackingUrl)) return body;
  return `${body}\n${trackingUrl}`.trim();
}

function campaignObjective(campaign) {
  return campaign.objective_type || campaign.generation_input?.objectiveType || 'click';
}

function campaignOperationSet(campaign) {
  return campaign.operation_set || campaign.generation_input?.operationSet || {};
}

async function leadFormForCampaign(campaignId) {
  const rows = await dbList('automation_studio_lead_forms', { campaign_id: campaignId }, { order: 'created_at', ascending: false }).catch(() => []);
  return rows.find((row) => row.status !== 'archived') || null;
}

function serializeLeadForm(row) {
  if (!row) return null;
  return {
    ...row,
    fields: Array.isArray(row.fields) ? row.fields : DEFAULT_LEAD_FIELDS,
    public_url: row.public_url || leadFormPublicUrl(row.slug)
  };
}

async function ensureLeadFormForCampaign(campaign, user = {}) {
  if (campaignObjective(campaign) !== 'lead') return null;
  const existing = await leadFormForCampaign(campaign.id);
  if (existing) return serializeLeadForm(existing);
  const operationSet = campaignOperationSet(campaign);
  const fields = normalizeLeadFields(operationSet.leadFields);
  const slug = `lead-${shortCode(10)}`;
  const form = await dbInsert('automation_studio_lead_forms', {
    campaign_id: campaign.id,
    project_id: campaign.project_id,
    account_id: campaign.account_id,
    slug,
    title: `${campaign.product_name} ${operationSet.leadOffer || '무료 안내'}`,
    offer: operationSet.leadOffer || '무료 도입 안내',
    fields,
    privacy_note: operationSet.leadPrivacyNote || '제출한 정보는 상담 안내와 캠페인 성과 확인 목적으로만 사용합니다.',
    thank_you_message: operationSet.leadThankYouMessage || '신청이 접수되었습니다. 운영자가 확인 후 연락드릴게요.',
    status: 'active',
    created_by: user.email || user.type || 'admin',
    public_url: leadFormPublicUrl(slug)
  });
  return serializeLeadForm(form);
}

async function createAutomationTrackingLink(campaign, post, asset) {
  let destinationUrl = safeHttpsUrl(campaign.product_url);
  if (campaignObjective(campaign) === 'lead') {
    const leadForm = await leadFormForCampaign(campaign.id);
    destinationUrl = safeHttpsUrl(leadForm?.public_url || leadFormPublicUrl(leadForm?.slug || '')) || destinationUrl;
  }
  if (!destinationUrl || !post?.id) return null;
  return dbInsert('tracking_links', {
    code: shortCode(),
    project_id: campaign.project_id,
    account_id: campaign.account_id,
    topic_id: null,
    post_id: post.id,
    product_id: null,
    destination_url: destinationUrl,
    link_type: 'custom'
  }).catch(async () => dbInsert('tracking_links', {
    code: shortCode(10),
    project_id: campaign.project_id,
    account_id: campaign.account_id,
    topic_id: null,
    post_id: post.id,
    product_id: null,
    destination_url: destinationUrl,
    link_type: 'custom'
  }).catch(() => null));
}

function campaignMediaStatus(row, assets = []) {
  const currentImage = row.product_image_url || row.generation_input?.productImageUrl || '';
  const instagramAssets = assets.filter((asset) => asset.platform === 'instagram');
  const imageAssets = instagramAssets.filter((asset) => asset.image_data_url);
  const applied = currentImage
    ? imageAssets.some((asset) => asset.metadata?.sourceProductImageUrl === safeImageSource(currentImage))
    : imageAssets.some((asset) => !asset.metadata?.sourceProductImageUrl);
  const hasImage = Boolean(currentImage);
  let status = '이미지 없음';
  if (hasImage && !imageAssets.length) status = '저장됨 · 소재 생성 필요';
  else if (hasImage && applied) status = '최신 소재에 적용됨';
  else if (hasImage) status = '소재 재생성 필요';
  else if (imageAssets.length) status = '기본 카드 이미지 사용 중';
  return {
    currentImage,
    hasImage,
    instagramAssetCount: instagramAssets.length,
    appliedToCurrentAssets: applied,
    needsRegeneration: hasImage && imageAssets.length > 0 && !applied,
    status
  };
}

async function accountReliabilitySummary(accountId) {
  if (!accountId) return null;
  const queues = (await dbList('post_queue', { account_id: accountId }, { order: 'created_at', ascending: false, limit: 50 }).catch(() => []));
  const issues = [];
  const rows = [];
  for (const queue of queues.slice(0, 20)) {
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }).catch(() => null) : null;
    const postProducts = queue.post_id ? await dbList('post_products', { post_id: queue.post_id }).catch(() => []) : [];
    const hasProduct = postProducts.length > 0;
    const reason = (() => {
      if (hasProduct && queue.post_mode !== 'link') return '상품 연결 글 댓글 링크 누락';
      if (/permission|권한|Application does not have permission|code 10/i.test(`${queue.error_category || ''} ${queue.error_message || ''}`)) return '댓글 권한 필요';
      if (['failed', 'retry'].includes(queue.status)) return '업로드 실패';
      if (queue.status === 'manual_required' || post?.status === 'needs_review') return '품질 탈락/검수 필요';
      return '';
    })();
    if (reason) issues.push(reason);
    rows.push({
      queueId: queue.id,
      postId: queue.post_id,
      status: queue.status,
      postMode: queue.post_mode,
      hasProduct,
      reason
    });
  }
  const counts = issues.reduce((acc, reason) => ({ ...acc, [reason]: (acc[reason] || 0) + 1 }), {});
  return {
    checkedQueues: rows.length,
    issueCount: issues.length,
    issues: Object.entries(counts).map(([label, count]) => ({ label, count })),
    rows: rows.filter((row) => row.reason).slice(0, 8),
    status: issues.length ? '점검 필요' : '정상'
  };
}

function campaignDiagnostics(row, assets, queues, leadForm) {
  const objective = campaignObjective(row);
  const operationSet = campaignOperationSet(row);
  const queueIssues = queues.filter((queue) => ['failed', 'retry', 'manual_required', 'skipped'].includes(queue.status));
  return {
    objective,
    destination: objective === 'lead'
      ? (leadForm?.public_url || operationSet.conversionDestination || 'lead_form')
      : (operationSet.conversionDestination || row.product_url || '전환 수집 없음'),
    media: campaignMediaStatus(row, assets),
    assets: {
      total: assets.length,
      threads: assets.filter((asset) => asset.platform === 'threads').length,
      instagram: assets.filter((asset) => asset.platform === 'instagram').length,
      needsReview: assets.filter((asset) => (asset.metadata?.reviewStatus || asset.status) === 'needs_review').length
    },
    queues: {
      total: queues.length,
      scheduled: queues.filter((queue) => queue.status === 'scheduled').length,
      manualRequired: queues.filter((queue) => queue.status === 'manual_required').length,
      failed: queues.filter((queue) => ['failed', 'retry'].includes(queue.status)).length,
      issueCount: queueIssues.length
    },
    leadForm: leadForm ? { connected: true, slug: leadForm.slug, publicUrl: leadForm.public_url } : { connected: false }
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function scheduleTimes(campaign, count) {
  const operationSet = campaign.operation_set || campaign.generation_input?.operationSet || {};
  const window = operationSet.activeTimeWindow || {};
  const times = [];
  for (let day = 0; day < campaign.days && times.length < count; day += 1) {
    const dayMax = Math.min(MAX_DAILY, Math.max(1, campaign.daily_post_max));
    const remaining = count - times.length;
    const plan = createDailySchedulePlan({
      daily_post_max: Math.min(dayMax, remaining),
      active_time_windows: [{ start: window.start || '09:00', end: window.end || '21:00' }],
      min_interval_minutes: 120
    }, addDays(new Date(), day), { rollPastToNextDay: true });
    times.push(...plan.times);
  }
  return times.slice(0, count);
}

async function enrichCampaign(row, options = {}) {
  const includeAssetImages = options.includeAssetImages !== false;
  const [allLinks, leadFormRow, account] = await Promise.all([
    dbList('automation_studio_queue_links', { campaign_id: row.id }, { order: 'created_at', ascending: true }),
    leadFormForCampaign(row.id),
    row.account_id ? dbGet('accounts', { id: row.account_id }).catch(() => null) : null
  ]);
  const currentGenerationId = row.summary?.currentGenerationId || row.generation_input?.currentGenerationId || null;
  const allAssets = await listAutomationAssetsForCampaign(row, allLinks, currentGenerationId, { includeAssetImages });
  const assetsForGeneration = currentGenerationId
    ? allAssets.filter((asset) => asset.metadata?.generationId === currentGenerationId)
    : allAssets;
  const assets = assetsForGeneration.filter((asset) => !asset.metadata?.deletedAt);
  const assetIds = new Set(assets.map((asset) => asset.id));
  const links = currentGenerationId
    ? allLinks.filter((link) => assetIds.has(link.asset_id))
    : allLinks;
  const queues = await listRowsByIds('post_queue', links.map((link) => link.queue_id).filter(Boolean));
  const queueIds = new Set(queues.map((queue) => queue.id));
  const trackingIds = new Set(queues.map((queue) => queue.tracking_link_id).filter(Boolean));
  const clickRows = await listClicksForTrackingIds([...trackingIds]);
  const stats = {
    assets: assets.length,
    scheduled: queues.filter((queue) => queueIds.has(queue.id) && ['scheduled', 'manual_required', 'posting', 'retry'].includes(queue.status)).length,
    posted: queues.filter((queue) => queue.status === 'posted').length,
    stopped: queues.filter((queue) => ['skipped'].includes(queue.status)).length,
    clicks: clickRows.filter((click) => trackingIds.has(click.tracking_link_id)).length
  };
  const assetsWithReview = assets.map((asset) => ({
    ...asset,
    review_status: asset.metadata?.reviewStatus || asset.status,
    operation_note: asset.operation_note || asset.metadata?.operationNote || '',
    reusable: Boolean(asset.reusable || asset.metadata?.reusable)
  }));
  const leadForm = serializeLeadForm(leadFormRow);
  const leadSubmissions = leadForm
    ? await dbList('automation_studio_lead_submissions', { form_id: leadForm.id }, { order: 'created_at', ascending: false }).catch(() => [])
    : [];
  const diagnostics = {
    ...campaignDiagnostics(row, assetsWithReview, queues, leadForm),
    account: account ? {
      status: account.status,
      automationStatus: account.automation_status,
      threadsTokenStatus: account.threads_token_status,
      hasThreadsToken: Boolean(account.threads_access_token)
    } : null,
    cujasaReliability: await accountReliabilitySummary(row.account_id)
  };
  return { ...row, assets: assetsWithReview, queueLinks: links, queues, stats, leadForm, leadSubmissions, diagnostics };
}

async function listAutomationAssetsForCampaign(row, allLinks = [], currentGenerationId = null, options = {}) {
  const includeAssetImages = options.includeAssetImages !== false;
  if (supabase && currentGenerationId) {
    const imageSelect = includeAssetImages ? ',image_data_url' : '';
    const baseSelect = `id,campaign_id,account_id,platform,asset_type,status,title,body,cta${imageSelect},metadata,created_at,updated_at`;
    const preferredSelect = `${baseSelect},operation_note,reusable`;
    const fetchCurrentAssets = async (select) => supabase
      .from('automation_studio_assets')
      .select(select)
      .eq('campaign_id', row.id)
      .eq('metadata->>generationId', currentGenerationId)
      .order('created_at', { ascending: true });
    let { data, error } = await fetchCurrentAssets(preferredSelect);
    if (error && /operation_note|reusable|column/i.test(error.message || '')) {
      ({ data, error } = await fetchCurrentAssets(baseSelect));
    }
    if (error) throw error;
    return data || [];
  }
  const linkedAssetIds = allLinks.map((link) => link.asset_id).filter(Boolean);
  return (await listRowsByIds('automation_studio_assets', linkedAssetIds, includeAssetImages ? '*' : 'id,campaign_id,account_id,platform,asset_type,status,title,body,cta,metadata,created_at,updated_at'))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

async function listRowsByIds(table, ids = [], select = '*') {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  if (supabase) {
    const rows = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const chunk = uniqueIds.slice(index, index + 100);
      const { data, error } = await supabase.from(table).select(select).in('id', chunk);
      if (error) throw error;
      rows.push(...(data || []));
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return uniqueIds.map((id) => byId.get(id)).filter(Boolean);
  }
  return (await Promise.all(uniqueIds.map((id) => dbGet(table, { id }).catch(() => null)))).filter(Boolean);
}

async function listClicksForTrackingIds(trackingIds = []) {
  const uniqueIds = [...new Set(trackingIds.filter(Boolean))];
  if (!uniqueIds.length) return [];
  if (supabase) {
    const rows = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const chunk = uniqueIds.slice(index, index + 100);
      const { data, error } = await supabase
        .from('click_events')
        .select('id,tracking_link_id,created_at')
        .in('tracking_link_id', chunk);
      if (error) throw error;
      rows.push(...(data || []));
    }
    return rows;
  }
  const rows = await dbList('click_events');
  const allowed = new Set(uniqueIds);
  return rows.filter((row) => allowed.has(row.tracking_link_id));
}

function addMetric(map, key, patch = {}) {
  if (!key) return;
  const row = map.get(key) || { key, clicks: 0, scheduled: 0, posted: 0, manualRequired: 0 };
  Object.entries(patch).forEach(([field, value]) => {
    row[field] = (row[field] || 0) + Number(value || 0);
  });
  map.set(key, row);
}

function serializeMetricMap(map, limit = 30) {
  return [...map.values()]
    .sort((a, b) => (b.clicks - a.clicks) || (b.posted - a.posted) || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

export async function getAutomationStudioAnalytics({ campaignId = null } = {}) {
  const campaigns = campaignId
    ? [await getAutomationCampaign(campaignId, { includeAssetImages: false })]
    : await listAutomationCampaigns({ includeAssetImages: false });
  const campaignIds = new Set(campaigns.map((campaign) => campaign.id));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const assetById = new Map();
  const queueRows = [];
  const trackingToContext = new Map();

  for (const campaign of campaigns) {
    const assets = campaign.assets || [];
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    assets.forEach((asset) => assetById.set(asset.id, { campaign, asset }));
    for (const queue of campaign.queues || []) {
      const link = (campaign.queueLinks || []).find((item) => item.queue_id === queue.id);
      const asset = assetsById.get(link?.asset_id);
      const context = { campaign, queue, asset, link };
      queueRows.push(context);
      if (queue.tracking_link_id) trackingToContext.set(queue.tracking_link_id, context);
    }
  }
  const trackingIds = [...trackingToContext.keys()];
  const [clickRows, trackingLinks] = await Promise.all([
    listClicksForTrackingIds(trackingIds),
    listRowsByIds('tracking_links', trackingIds).catch(() => [])
  ]);
  const trackingById = new Map(trackingLinks.map((link) => [link.id, link]));

  const clicks = clickRows
    .map((click) => {
      const context = trackingToContext.get(click.tracking_link_id);
      if (context) return { ...click, ...context };
      const tracking = trackingById.get(click.tracking_link_id);
      const postContext = queueRows.find((row) => row.queue.post_id && row.queue.post_id === tracking?.post_id);
      return postContext ? { ...click, ...postContext } : null;
    })
    .filter(Boolean)
    .filter((row) => campaignIds.has(row.campaign.id));

  const byDate = new Map();
  const byHour = new Map();
  const byChannel = new Map();
  const byAsset = new Map();
  const byCampaign = new Map();

  for (const { campaign, queue, asset } of queueRows) {
    addMetric(byChannel, queue.platform, {
      scheduled: ['scheduled', 'manual_required', 'retry', 'posting'].includes(queue.status) ? 1 : 0,
      posted: queue.status === 'posted' ? 1 : 0,
      manualRequired: queue.status === 'manual_required' ? 1 : 0
    });
    addMetric(byCampaign, campaign.id, {
      scheduled: ['scheduled', 'manual_required', 'retry', 'posting'].includes(queue.status) ? 1 : 0,
      posted: queue.status === 'posted' ? 1 : 0,
      manualRequired: queue.status === 'manual_required' ? 1 : 0
    });
    if (asset) {
      addMetric(byAsset, asset.id, {
        scheduled: ['scheduled', 'manual_required', 'retry', 'posting'].includes(queue.status) ? 1 : 0,
        posted: queue.status === 'posted' ? 1 : 0,
        manualRequired: queue.status === 'manual_required' ? 1 : 0
      });
    }
  }

  for (const row of clicks) {
    const createdAt = row.created_at;
    addMetric(byDate, dateKey(createdAt), { clicks: 1 });
    addMetric(byHour, hourKey(createdAt), { clicks: 1 });
    addMetric(byChannel, row.queue?.platform || row.asset?.platform || 'unknown', { clicks: 1 });
    addMetric(byCampaign, row.campaign.id, { clicks: 1 });
    if (row.asset?.id) addMetric(byAsset, row.asset.id, { clicks: 1 });
  }

  const assetRows = serializeMetricMap(byAsset, 50).map((row) => {
    const context = assetById.get(row.key) || {};
    const asset = context.asset || {};
    const campaign = context.campaign || {};
    return {
      ...row,
      assetId: row.key,
      campaignId: campaign.id,
      campaignName: campaign.name,
      platform: asset.platform,
      title: asset.metadata?.caption || asset.body || asset.title || '',
      qualityScore: asset.metadata?.qualityScore || null,
      reviewStatus: asset.review_status || asset.status
    };
  });
  const campaignRows = serializeMetricMap(byCampaign, 50).map((row) => {
    const campaign = campaignById.get(row.key) || {};
    return {
      ...row,
      campaignId: row.key,
      campaignName: campaign.name || row.key,
      productName: campaign.product_name || '',
      status: campaign.status || ''
    };
  });
  const bestAssets = assetRows.filter((row) => row.clicks > 0).slice(0, 10);
  const nextActions = [];
  if (bestAssets.length) {
    nextActions.push('클릭이 발생한 소재를 재사용 ON으로 표시하고 같은 제품/후킹 방식으로 변형 소재를 추가 생성하세요.');
  }
  const strongHours = serializeMetricMap(byHour, 5).filter((row) => row.clicks > 0).map((row) => `${row.key}시`);
  if (strongHours.length) {
    nextActions.push(`반응 시간대(${strongHours.join(', ')})에 예약 슬롯을 더 배치하세요.`);
  }
  if (!clicks.length) {
    nextActions.push('아직 클릭 데이터가 없습니다. 제품 URL이 있는 캠페인에서 추적 링크를 소재/댓글에 사용해 클릭 데이터를 먼저 쌓으세요.');
  }

  return {
    totals: {
      campaigns: campaigns.length,
      assets: campaigns.reduce((sum, campaign) => sum + (campaign.assets?.length || 0), 0),
      scheduled: queueRows.filter((row) => ['scheduled', 'manual_required', 'retry', 'posting'].includes(row.queue.status)).length,
      posted: queueRows.filter((row) => row.queue.status === 'posted').length,
      clicks: clicks.length,
      manualRequired: queueRows.filter((row) => row.queue.status === 'manual_required').length
    },
    byDate: [...byDate.values()].sort((a, b) => String(a.key).localeCompare(String(b.key))),
    byHour: [...byHour.values()].sort((a, b) => Number(a.key) - Number(b.key)),
    byChannel: serializeMetricMap(byChannel, 10),
    campaigns: campaignRows,
    assets: assetRows,
    bestAssets,
    nextActions,
    generatedAt: new Date().toISOString()
  };
}

function isDeletedCampaign(row) {
  return Boolean(row.summary?.deletedAt || row.generation_input?.deletedAt);
}

async function archiveCampaignGeneration(campaignId) {
  const links = await dbList('automation_studio_queue_links', { campaign_id: campaignId }).catch(() => []);
  for (const link of links) {
    const queue = link.queue_id ? await dbGet('post_queue', { id: link.queue_id }).catch(() => null) : null;
    if (queue && ['scheduled', 'manual_required', 'retry'].includes(queue.status)) {
      await dbUpdate('post_queue', { id: queue.id }, {
        status: 'skipped',
        error_message: 'Automation Studio campaign regenerated'
      }).catch(() => null);
    }
    await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'stopped' }).catch(() => null);
  }
  await dbUpdate('automation_studio_assets', { campaign_id: campaignId }, { status: 'stopped' }).catch(() => null);
}

export async function listAutomationCampaigns(options = {}) {
  const rows = await dbList('automation_studio_campaigns', {}, { order: 'created_at', ascending: false });
  if (options.summaryOnly) return rows.filter((row) => !isDeletedCampaign(row)).map(summarizeCampaign);
  return Promise.all(rows.filter((row) => !isDeletedCampaign(row)).map((row) => enrichCampaign(row, options)));
}

function summarizeCampaign(row) {
  const generatedAssets = Number(row.summary?.generatedAssets || 0);
  const queuedItems = Number(row.summary?.queuedItems || 0);
  return {
    ...row,
    assets: [],
    queues: [],
    queueLinks: [],
    stats: {
      assets: generatedAssets,
      scheduled: queuedItems,
      posted: 0,
      stopped: 0,
      clicks: 0
    },
    diagnostics: {
      ...campaignDiagnostics(row, [], [], null),
      cujasaReliability: null
    }
  };
}

export async function getAutomationCampaign(id, options = {}) {
  const row = await dbGet('automation_studio_campaigns', { id });
  if (!row) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  return enrichCampaign(row, options);
}

export async function createAutomationCampaign(body, user = {}) {
  const input = campaignInput(body);
  const account = await getRequiredAutomationAccount(input.accountId);
  const payload = {
    project_id: account?.project_id || null,
    account_id: account?.id || null,
    name: input.name,
    product_name: input.productName,
    product_url: input.productUrl,
    product_price: input.productPrice,
    product_image_url: input.productImageUrl,
    objective_type: input.objectiveType,
    target_goal: input.targetGoal,
    target_audience: input.targetAudience || account?.target_audience || '',
    account_handle: input.accountHandle || account?.account_handle || '',
    priority: input.priority,
    operation_set: input.operationSet,
    next_action_note: input.nextActionNote,
    platforms: input.platforms,
    daily_post_min: input.dailyPostMin,
    daily_post_max: input.dailyPostMax,
    days: input.days,
    status: 'draft',
    generation_input: input.generationInput,
    created_by: user.email || user.type || 'admin'
  };
  let campaign;
  try {
    campaign = await dbInsert('automation_studio_campaigns', payload);
  } catch (error) {
    if (!/objective_type|priority|operation_set|next_action_note|schema cache|column/i.test(error.message || '')) throw error;
    const { objective_type, priority, operation_set, next_action_note, ...fallbackPayload } = payload;
    campaign = await dbInsert('automation_studio_campaigns', {
      ...fallbackPayload,
      generation_input: {
        ...fallbackPayload.generation_input,
        objectiveType: objective_type,
        priority,
        operationSet: operation_set,
        nextActionNote: next_action_note
      }
    });
  }
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_campaign_created',
    message: campaign.name,
    payload: { campaignId: campaign.id, platforms: campaign.platforms }
  }).catch(() => null);
  const leadForm = await ensureLeadFormForCampaign(campaign, user).catch(() => null);
  if (leadForm) {
    await dbUpdate('automation_studio_campaigns', { id: campaign.id }, {
      summary: {
        ...(campaign.summary || {}),
        leadFormId: leadForm.id,
        leadFormUrl: leadForm.public_url
      }
    }).catch(() => null);
  }
  return getAutomationCampaign(campaign.id);
}

export async function runAutomationCampaign(id, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const account = await getRequiredAutomationAccount(campaign.account_id);
  if (account.status !== 'active') {
    const error = new Error(`Automation Studio account is ${account.status || 'missing'}; active account is required`);
    error.status = 409;
    error.code = 'ACCOUNT_NOT_ACTIVE';
    throw error;
  }
  if (account.automation_status !== AUTOMATION_RUNNING) {
    await setAutomationStatus(account.id, AUTOMATION_RUNNING);
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'automation_studio_account_autostarted',
      level: 'info',
      message: 'Automation Studio campaign run enabled account automation.',
      payload: { campaignId: campaign.id, previousAutomationStatus: account.automation_status || 'paused' }
    }).catch(() => null);
    account.automation_status = AUTOMATION_RUNNING;
  }
  await archiveCampaignGeneration(campaign.id);
  await ensureLeadFormForCampaign(campaign, user).catch(() => null);
  const generationId = randomUUID();
  const platforms = normalizePlatforms(campaign.platforms);
  const perPlatformCount = Math.max(1, campaign.days * clampInt(campaign.daily_post_max, 1, MAX_DAILY, 1));
  const input = campaignAssetInput(campaign);
  const variantOffset = Math.floor(Math.random() * 997);
  const generated = [];
  for (let index = 0; index < perPlatformCount; index += 1) {
    const variantIndex = index + variantOffset;
    if (platforms.includes('threads')) generated.push(buildAutomationAssetForPlatform(input, 'threads', variantIndex, account));
    if (platforms.includes('instagram')) generated.push(buildAutomationAssetForPlatform(input, 'instagram', variantIndex, account));
  }
  let assets;
  try {
    assets = await dbInsert('automation_studio_assets', generated.map((asset) => ({
      ...asset,
      campaign_id: campaign.id,
      account_id: campaign.account_id,
      status: asset.metadata?.reviewStatus || 'queued',
      operation_note: '',
      reusable: false
    })));
  } catch (error) {
    if (!/operation_note|reusable|schema cache|column/i.test(error.message || '')) throw error;
    assets = await dbInsert('automation_studio_assets', generated.map((asset) => ({
      ...asset,
      campaign_id: campaign.id,
      account_id: campaign.account_id,
      status: 'queued',
      metadata: { ...(asset.metadata || {}), generationId, operationNote: '', reusable: false }
    })));
  }
  assets = assets.map((asset) => ({
    ...asset,
    metadata: { ...(asset.metadata || {}), generationId }
  }));
  await Promise.all(assets.map((asset) => dbUpdate('automation_studio_assets', { id: asset.id }, {
    metadata: { ...(asset.metadata || {}), generationId }
  }).catch(() => null)));
  const times = scheduleTimes(campaign, assets.length);
  const queueLinks = [];
  for (const [index, asset] of assets.entries()) {
    const post = await dbInsert('posts', {
      project_id: campaign.project_id,
      account_id: campaign.account_id,
      topic_id: null,
      content_type: asset.platform === 'instagram' ? 'automation_studio_instagram_preview' : 'automation_studio_threads',
      body: postBodyForAsset(asset),
      risk_level: asset.metadata?.riskLevel || 'low',
      status: asset.platform === 'instagram' ? 'manual_required' : (asset.metadata?.reviewStatus === 'needs_review' ? 'needs_review' : 'draft'),
      metadata: {
        source: 'automation_studio',
        campaignId: campaign.id,
        assetId: asset.id,
        platform: asset.platform,
        qualityScore: asset.metadata?.qualityScore,
        qualityStatus: asset.metadata?.qualityStatus,
        qualityWarnings: asset.metadata?.qualityWarnings || [],
        uploadPolicy: asset.platform === 'instagram' ? 'preview_only_no_graph_api' : 'threads_queue_flow'
      }
    });
    const trackingLink = await createAutomationTrackingLink(campaign, post, asset);
    if (trackingLink) {
      await dbUpdate('posts', { id: post.id }, {
        body: postBodyWithTracking(asset, trackingLink),
        metadata: {
          ...(post.metadata || {}),
          trackingUrl: trackingUrlForLink(trackingLink),
          trackingLinkId: trackingLink.id
        }
      }).catch(() => null);
    }
    const queue = await dbInsert('post_queue', {
      project_id: campaign.project_id,
      account_id: campaign.account_id,
      topic_id: null,
      post_id: post.id,
      platform: asset.platform,
      scheduled_at: times[index] || new Date(Date.now() + (index + 1) * 60 * 60 * 1000).toISOString(),
      status: queueStatusForAsset(asset),
      post_mode: 'no_link',
      retry_count: 0,
      error_message: asset.platform === 'instagram'
        ? 'Instagram Graph API 업로드 제외: 미리보기/수동 대기 상태'
        : (asset.metadata?.reviewStatus === 'needs_review' ? 'Automation Studio 품질 검수 필요' : null),
      error_category: asset.platform === 'instagram'
        ? 'instagram_preview_only'
        : (asset.metadata?.reviewStatus === 'needs_review' ? 'automation_quality_review' : null),
      tracking_link_id: trackingLink?.id || null
    });
    queueLinks.push(await dbInsert('automation_studio_queue_links', {
      campaign_id: campaign.id,
      asset_id: asset.id,
      queue_id: queue.id,
      post_id: post.id,
      platform: asset.platform,
      status: queue.status === 'posted' ? 'posted' : queue.status
    }));
  }
  await dbUpdate('automation_studio_campaigns', { id: campaign.id }, {
    status: 'running',
    started_at: new Date().toISOString(),
    stopped_at: null,
    summary: {
      generatedAssets: assets.length,
      queuedItems: queueLinks.length,
      currentGenerationId: generationId,
      requestedBy: user.email || user.type || 'admin',
      copyVariantOffset: variantOffset
    }
  });
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_campaign_started',
    message: campaign.name,
    payload: { campaignId: campaign.id, assetCount: assets.length, queueCount: queueLinks.length }
  }).catch(() => null);
  return getAutomationCampaign(campaign.id);
}

export async function regenerateAutomationCampaignAssets(id, user = {}) {
  const campaign = await runAutomationCampaign(id, user);
  await dbUpdate('automation_studio_campaigns', { id }, {
    summary: {
      ...(campaign.summary || {}),
      regeneratedAt: new Date().toISOString(),
      regeneratedBy: user.email || user.type || 'admin'
    }
  }).catch(() => null);
  return getAutomationCampaign(id);
}

export async function listAutomationCampaignLeads(campaignId) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const leadForm = await leadFormForCampaign(campaignId);
  if (!leadForm) return { leadForm: null, submissions: [] };
  const submissions = await dbList('automation_studio_lead_submissions', { form_id: leadForm.id }, { order: 'created_at', ascending: false }).catch(() => []);
  return { leadForm: serializeLeadForm(leadForm), submissions };
}

async function syncRewrittenAssetTargets(campaign, asset, link) {
  const queue = link?.queue_id ? await dbGet('post_queue', { id: link.queue_id }).catch(() => null) : null;
  if (queue && ['posted', 'posting'].includes(queue.status)) {
    const error = new Error('이미 게시 중이거나 게시 완료된 소재는 랜덤 재작성할 수 없습니다.');
    error.status = 409;
    error.code = 'ASSET_ALREADY_POSTED';
    throw error;
  }
  if (link?.post_id) {
    const trackingLink = queue?.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id }).catch(() => null)
      : null;
    await dbUpdate('posts', { id: link.post_id }, {
      body: trackingLink ? postBodyWithTracking(asset, trackingLink) : postBodyForAsset(asset),
      risk_level: asset.metadata?.riskLevel || 'low',
      status: asset.platform === 'instagram'
        ? 'manual_required'
        : (asset.metadata?.reviewStatus === 'needs_review' ? 'needs_review' : 'draft'),
      metadata: {
        source: 'automation_studio',
        campaignId: campaign.id,
        assetId: asset.id,
        platform: asset.platform,
        qualityScore: asset.metadata?.qualityScore,
        qualityStatus: asset.metadata?.qualityStatus,
        qualityWarnings: asset.metadata?.qualityWarnings || [],
        rewrittenAt: asset.metadata?.rewrittenAt || null,
        uploadPolicy: asset.platform === 'instagram' ? 'preview_only_no_graph_api' : 'threads_queue_flow',
        ...(trackingLink ? { trackingUrl: trackingUrlForLink(trackingLink), trackingLinkId: trackingLink.id } : {})
      }
    }).catch(() => null);
  }
  if (queue) {
    const nextStatus = queueStatusForAsset(asset);
    await dbUpdate('post_queue', { id: queue.id }, {
      status: nextStatus,
      error_message: asset.platform === 'instagram'
        ? 'Instagram Graph API 업로드 제외: 미리보기/수동 대기 상태'
        : (asset.metadata?.reviewStatus === 'needs_review' ? 'Automation Studio 품질 검수 필요' : null),
      error_category: asset.platform === 'instagram'
        ? 'instagram_preview_only'
        : (asset.metadata?.reviewStatus === 'needs_review' ? 'automation_quality_review' : null)
    }).catch(() => null);
    await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: nextStatus }).catch(() => null);
  }
}

export async function rewriteAutomationAsset(campaignId, assetId, user = {}, options = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const asset = await dbGet('automation_studio_assets', { id: assetId });
  if (!asset || asset.campaign_id !== campaignId) {
    const error = new Error('Asset not found');
    error.status = 404;
    throw error;
  }
  const [link] = await dbList('automation_studio_queue_links', { asset_id: assetId }).catch(() => []);
  const linkedQueue = link?.queue_id ? await dbGet('post_queue', { id: link.queue_id }).catch(() => null) : null;
  if (linkedQueue && ['posted', 'posting'].includes(linkedQueue.status)) {
    const error = new Error('이미 게시 중이거나 게시 완료된 소재는 랜덤 재작성할 수 없습니다.');
    error.status = 409;
    error.code = 'ASSET_ALREADY_POSTED';
    throw error;
  }
  const account = campaign.account_id ? await dbGet('accounts', { id: campaign.account_id }).catch(() => null) : null;
  const input = campaignAssetInput(campaign);
  const currentCopy = assetCopyValue(asset);
  const siblingCopies = Array.isArray(options.existingCopies)
    ? new Set(options.existingCopies.map(clean).filter(Boolean))
    : new Set((await dbList('automation_studio_assets', {
      campaign_id: campaignId,
      platform: asset.platform
    }).catch(() => []))
      .filter((item) => item.id !== asset.id && !item.metadata?.deletedAt && !['stopped', 'archived'].includes(item.status))
      .map(assetCopyValue)
      .filter(Boolean));
  let rewritten = null;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const variantIndex = Math.floor(Math.random() * 997) + attempt;
    const candidate = buildAutomationAssetForPlatform(input, asset.platform, variantIndex, account || {});
    const candidateCopy = assetCopyValue(candidate);
    if (candidateCopy && candidateCopy !== currentCopy && !siblingCopies.has(candidateCopy)) {
      rewritten = candidate;
      break;
    }
  }
  rewritten ||= buildAutomationAssetForPlatform(input, asset.platform, Math.floor(Math.random() * 997), account || {});
  const metadata = {
    ...(asset.metadata || {}),
    ...(rewritten.metadata || {}),
    generationId: asset.metadata?.generationId || campaign.summary?.currentGenerationId || null,
    operationNote: asset.operation_note || asset.metadata?.operationNote || '',
    reusable: Boolean(asset.reusable || asset.metadata?.reusable),
    rewrittenAt: new Date().toISOString(),
    rewrittenBy: user.email || user.type || 'admin',
    previousCopy: compactSentence(currentCopy, 140)
  };
  const patch = {
    title: rewritten.title,
    body: rewritten.body,
    cta: rewritten.cta,
    image_data_url: rewritten.image_data_url || asset.image_data_url || null,
    status: metadata.reviewStatus || 'queued',
    metadata,
    operation_note: asset.operation_note || '',
    reusable: Boolean(asset.reusable)
  };
  let updated;
  try {
    [updated] = await dbUpdate('automation_studio_assets', { id: asset.id }, patch);
  } catch (error) {
    if (!/operation_note|reusable|image_data_url|status|schema cache|column|check constraint/i.test(error.message || '')) throw error;
    [updated] = await dbUpdate('automation_studio_assets', { id: asset.id }, {
      title: patch.title,
      body: patch.body,
      cta: patch.cta,
      metadata
    });
  }
  await syncRewrittenAssetTargets(campaign, { ...asset, ...patch, ...updated }, link);
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_asset_rewritten',
    message: `${asset.platform}:${asset.id}`,
    payload: { campaignId, assetId, platform: asset.platform }
  }).catch(() => null);
  if (options.returnDetail === false) return { ok: true, asset: updated || { ...asset, ...patch } };
  return getAutomationCampaign(campaignId);
}

export async function updateAutomationAsset(campaignId, assetId, body = {}, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const asset = await dbGet('automation_studio_assets', { id: assetId });
  if (!asset || asset.campaign_id !== campaignId) {
    const error = new Error('Asset not found');
    error.status = 404;
    throw error;
  }
  const nextStatus = ASSET_STATUSES.has(body.status) ? body.status : null;
  const title = clean(body.title ?? asset.title);
  const assetBody = clean(body.body ?? body.copyText ?? asset.body);
  const cta = clean(body.cta ?? asset.cta);
  const caption = clean(body.caption ?? asset.metadata?.caption);
  const operationNote = clean(body.operationNote ?? body.operation_note ?? asset.operation_note ?? asset.metadata?.operationNote);
  const reusable = typeof body.reusable === 'boolean' ? body.reusable : Boolean(asset.reusable || asset.metadata?.reusable);
  const account = campaign.account_id ? await dbGet('accounts', { id: campaign.account_id }).catch(() => null) : null;
  const input = {
    productName: campaign.product_name,
    productUrl: campaign.product_url,
    productPrice: campaign.product_price,
    productImageUrl: campaign.product_image_url || campaign.generation_input?.productImageUrl,
    objectiveType: campaign.objective_type || campaign.generation_input?.objectiveType || 'click',
    targetGoal: campaign.target_goal,
    targetAudience: campaign.target_audience,
    accountHandle: campaign.account_handle,
    operationSet: campaign.operation_set || campaign.generation_input?.operationSet || {}
  };
  const qualityDraft = enhanceAutomationAsset({
    ...asset,
    title,
    body: assetBody,
    cta,
    metadata: {
      ...(asset.metadata || {}),
      ...(caption ? { caption, adCopy: caption } : {})
    }
  }, input, account);
  const qualityMetadata = qualityDraft.metadata || {};
  const finalCaption = asset.platform === 'instagram' ? (qualityMetadata.caption || caption) : caption;
  const metadata = {
    ...(asset.metadata || {}),
    ...qualityMetadata,
    ...(finalCaption ? { caption: finalCaption, adCopy: finalCaption } : {}),
    reviewStatus: nextStatus || qualityMetadata.reviewStatus || asset.metadata?.reviewStatus || asset.status,
    operationNote,
    reusable,
    reviewedBy: user.email || user.type || 'admin',
    reviewedAt: new Date().toISOString()
  };
  const patch = {
    metadata,
    title: asset.platform === 'instagram' ? title : qualityDraft.title,
    body: asset.platform === 'instagram' ? assetBody : qualityDraft.body,
    cta,
    ...(nextStatus ? { status: nextStatus } : {}),
    operation_note: operationNote,
    reusable
  };
  let updated;
  try {
    [updated] = await dbUpdate('automation_studio_assets', { id: assetId }, patch);
  } catch (error) {
    if (!/operation_note|reusable|status|schema cache|column|check constraint/i.test(error.message || '')) throw error;
    [updated] = await dbUpdate('automation_studio_assets', { id: assetId }, { metadata });
  }
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_asset_reviewed',
    message: `${asset.platform}:${nextStatus || metadata.reviewStatus}`,
    payload: { campaignId, assetId, status: nextStatus || metadata.reviewStatus, reusable, operationNote }
  }).catch(() => null);
  const [link] = await dbList('automation_studio_queue_links', { asset_id: assetId }).catch(() => []);
  if (link?.post_id) {
    await dbUpdate('posts', { id: link.post_id }, {
      body: asset.platform === 'instagram' ? (metadata.caption || assetBody || title) : (qualityDraft.body || assetBody)
    }).catch(() => null);
  }
  if (link?.queue_id) {
    const queue = await dbGet('post_queue', { id: link.queue_id }).catch(() => null);
    if (asset.platform === 'threads' && nextStatus === 'approved' && queue?.status === 'manual_required' && queue?.error_category === 'automation_quality_review') {
      await dbUpdate('post_queue', { id: link.queue_id }, {
        status: 'scheduled',
        error_message: null,
        error_category: null
      }).catch(() => null);
      await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'scheduled' }).catch(() => null);
    }
    if (['rejected', 'stopped'].includes(nextStatus) && ['scheduled', 'manual_required', 'retry'].includes(queue?.status)) {
      await dbUpdate('post_queue', { id: link.queue_id }, {
        status: 'skipped',
        error_message: 'Automation Studio asset rejected or stopped'
      }).catch(() => null);
      await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'stopped' }).catch(() => null);
    }
  }
  return getAutomationCampaign(campaignId);
}

export async function updateAutomationCampaign(campaignId, body = {}, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const nextActionNote = clean(body.nextActionNote ?? body.next_action_note ?? campaign.next_action_note ?? campaign.generation_input?.nextActionNote);
  const hasProductImageUrl = Object.prototype.hasOwnProperty.call(body, 'productImageUrl') || Object.prototype.hasOwnProperty.call(body, 'product_image_url');
  const productImageUrl = hasProductImageUrl ? clean(body.productImageUrl ?? body.product_image_url) : campaign.product_image_url;
  const hasProductUrl = Object.prototype.hasOwnProperty.call(body, 'productUrl') || Object.prototype.hasOwnProperty.call(body, 'product_url');
  const productUrl = hasProductUrl ? clean(body.productUrl ?? body.product_url) : campaign.product_url;
  const summary = {
    ...(campaign.summary || {}),
    nextActionNote,
    ...(hasProductImageUrl && productImageUrl ? { productImageUpdatedAt: new Date().toISOString(), productImageClearedAt: null } : {}),
    ...(hasProductImageUrl && !productImageUrl ? { productImageClearedAt: new Date().toISOString() } : {}),
    lastUpdatedBy: user.email || user.type || 'admin',
    lastUpdatedAt: new Date().toISOString()
  };
  const patch = {
    next_action_note: nextActionNote,
    summary,
    ...(hasProductImageUrl ? { product_image_url: productImageUrl } : {}),
    ...(hasProductUrl ? { product_url: productUrl } : {})
  };
  let updated;
  try {
    [updated] = await dbUpdate('automation_studio_campaigns', { id: campaignId }, patch);
  } catch (error) {
    if (!/next_action_note|product_image_url|product_url|schema cache|column/i.test(error.message || '')) throw error;
    [updated] = await dbUpdate('automation_studio_campaigns', { id: campaignId }, {
      summary,
      generation_input: {
        ...(campaign.generation_input || {}),
        nextActionNote,
        ...(hasProductImageUrl ? { productImageUrl } : {}),
        ...(hasProductUrl ? { productUrl } : {})
      }
    });
  }
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_campaign_updated',
    message: campaign.name,
    payload: { campaignId, nextActionNote }
  }).catch(() => null);
  return getAutomationCampaign(updated?.id || campaignId);
}

export async function getPublicLeadForm(slug) {
  const form = await dbGet('automation_studio_lead_forms', { slug: clean(slug) });
  if (!form || form.status !== 'active') {
    const error = new Error('Lead form not found');
    error.status = 404;
    throw error;
  }
  const campaign = form.campaign_id ? await dbGet('automation_studio_campaigns', { id: form.campaign_id }).catch(() => null) : null;
  return {
    id: form.id,
    slug: form.slug,
    title: form.title,
    offer: form.offer,
    fields: Array.isArray(form.fields) ? form.fields : DEFAULT_LEAD_FIELDS,
    fieldLabels: LEAD_FIELD_LABELS,
    privacyNote: form.privacy_note,
    thankYouMessage: form.thank_you_message,
    productName: campaign?.product_name || '',
    campaignName: campaign?.name || ''
  };
}

export async function submitPublicLeadForm(slug, body = {}, requestMeta = {}) {
  const form = await dbGet('automation_studio_lead_forms', { slug: clean(slug) });
  if (!form || form.status !== 'active') {
    const error = new Error('Lead form not found');
    error.status = 404;
    throw error;
  }
  const fields = normalizeLeadFields(form.fields);
  const payload = {};
  fields.forEach((field) => {
    payload[field] = clean(body[field]);
  });
  const missing = fields.filter((field) => !payload[field] && ['name', 'phone', 'email'].includes(field));
  if (missing.length) {
    const error = new Error(`Required lead fields missing: ${missing.join(', ')}`);
    error.status = 400;
    error.code = 'lead_required_fields_missing';
    throw error;
  }
  if (body.privacyAccepted !== true && body.privacy_accepted !== true) {
    const error = new Error('Privacy consent is required');
    error.status = 400;
    error.code = 'lead_privacy_required';
    throw error;
  }
  const submission = await dbInsert('automation_studio_lead_submissions', {
    form_id: form.id,
    campaign_id: form.campaign_id,
    project_id: form.project_id,
    account_id: form.account_id,
    payload,
    status: 'new',
    source_url: clean(body.sourceUrl || body.source_url || requestMeta.referer),
    user_agent: clean(requestMeta.userAgent),
    metadata: {
      submittedFrom: 'public_lead_form',
      fieldCount: fields.length
    }
  });
  return {
    ok: true,
    id: submission.id,
    message: form.thank_you_message || '신청이 접수되었습니다.'
  };
}

export async function expandAutomationAsset(campaignId, assetId, body = {}, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const asset = await dbGet('automation_studio_assets', { id: assetId });
  if (!asset || asset.campaign_id !== campaignId || asset.metadata?.deletedAt) {
    const error = new Error('Asset not found');
    error.status = 404;
    throw error;
  }
  const sourceCopy = clean(asset.metadata?.caption || asset.body || asset.title);
  const operationSet = campaign.operation_set || campaign.generation_input?.operationSet || {};
  const platforms = normalizePlatforms(body.platforms || [asset.platform]);
  const expansion = await createAutomationCampaign({
    accountId: campaign.account_id,
    name: clean(body.name) || `${campaign.product_name} 확장 캠페인`,
    productName: campaign.product_name,
    productUrl: campaign.product_url,
    productPrice: campaign.product_price,
    productImageUrl: campaign.product_image_url || campaign.generation_input?.productImageUrl,
    objectiveType: campaign.objective_type || campaign.generation_input?.objectiveType || 'click',
    targetGoal: clean(body.targetGoal) || `${campaign.target_goal} · 성과 소재 확장`,
    targetAudience: campaign.target_audience,
    accountHandle: campaign.account_handle,
    priority: body.priority || campaign.priority || 'normal',
    days: body.days ?? Math.min(MAX_DAYS, Math.max(1, Number(campaign.days || 3))),
    dailyPostMin: body.dailyPostMin ?? campaign.daily_post_min ?? 1,
    dailyPostMax: body.dailyPostMax ?? campaign.daily_post_max ?? 1,
    platforms,
    toneStyle: operationSet.toneStyle,
    hookStyle: body.hookStyle || operationSet.hookStyle || 'situation_first',
    cardStyle: operationSet.cardStyle,
    activeStart: operationSet.activeTimeWindow?.start,
    activeEnd: operationSet.activeTimeWindow?.end,
    optimizationGoal: operationSet.optimizationGoal,
    conversionDestination: operationSet.conversionDestination,
    leadOffer: operationSet.leadOffer,
    leadFields: operationSet.leadFields,
    audienceStage: operationSet.audienceStage,
    audiencePersona: operationSet.audiencePersona,
    audiencePain: operationSet.audiencePain,
    placementMode: operationSet.placementMode,
    creativeFormat: operationSet.creativeFormat,
    primaryMessage: sourceCopy,
    proofPoint: operationSet.proofPoint,
    complianceNote: operationSet.complianceNote,
    nextActionNote: clean(body.nextActionNote) || `성과 소재 "${sourceCopy.slice(0, 48)}" 기반 확장 초안`
  }, user);
  await dbUpdate('automation_studio_campaigns', { id: expansion.id }, {
    summary: {
      ...(expansion.summary || {}),
      sourceCampaignId: campaign.id,
      sourceAssetId: asset.id,
      expansionReason: 'best_performing_asset',
      expandedAt: new Date().toISOString()
    }
  }).catch(() => null);
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_asset_expanded',
    message: `${campaign.name}:${asset.platform}`,
    payload: { sourceCampaignId: campaign.id, sourceAssetId: asset.id, expansionCampaignId: expansion.id }
  }).catch(() => null);
  return getAutomationCampaign(expansion.id);
}

export async function stopAutomationCampaign(id, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const links = await dbList('automation_studio_queue_links', { campaign_id: id });
  for (const link of links) {
    const queue = link.queue_id ? await dbGet('post_queue', { id: link.queue_id }) : null;
    if (queue && ['scheduled', 'manual_required', 'retry'].includes(queue.status)) {
      await dbUpdate('post_queue', { id: queue.id }, {
        status: 'skipped',
        error_message: 'Automation Studio campaign stopped'
      });
      await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'stopped' });
    }
  }
  await dbUpdate('automation_studio_assets', { campaign_id: id }, { status: 'stopped' });
  await dbUpdate('automation_studio_campaigns', { id }, {
    status: 'stopped',
    stopped_at: new Date().toISOString()
  });
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_campaign_stopped',
    message: campaign.name,
    payload: { campaignId: campaign.id, requestedBy: user.email || user.type || 'admin' }
  }).catch(() => null);
  return getAutomationCampaign(id);
}

export async function deleteAutomationAsset(campaignId, assetId, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  const asset = await dbGet('automation_studio_assets', { id: assetId });
  if (!asset || asset.campaign_id !== campaignId) {
    const error = new Error('Asset not found');
    error.status = 404;
    throw error;
  }
  const links = await dbList('automation_studio_queue_links', { asset_id: assetId }).catch(() => []);
  for (const link of links) {
    if (link.queue_id) {
      await dbUpdate('post_queue', { id: link.queue_id }, {
        status: 'skipped',
        error_message: 'Automation Studio asset deleted'
      }).catch(() => null);
    }
    await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'stopped' }).catch(() => null);
  }
  await dbUpdate('automation_studio_assets', { id: assetId }, {
    status: 'stopped',
    metadata: {
      ...(asset.metadata || {}),
      deletedAt: new Date().toISOString(),
      deletedBy: user.email || user.type || 'admin'
    }
  });
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_asset_deleted',
    message: `${asset.platform}:${asset.title}`,
    payload: { campaignId, assetId }
  }).catch(() => null);
  return getAutomationCampaign(campaignId);
}

export async function deleteAutomationSet(campaignId, platform, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id: campaignId });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  if (!DEFAULT_PLATFORMS.includes(platform)) {
    const error = new Error('Invalid platform');
    error.status = 400;
    throw error;
  }
  const links = await dbList('automation_studio_queue_links', { campaign_id: campaignId }).catch(() => []);
  for (const link of links.filter((item) => item.platform === platform)) {
    if (link.queue_id) {
      await dbUpdate('post_queue', { id: link.queue_id }, {
        status: 'skipped',
        error_message: 'Automation Studio operation set deleted'
      }).catch(() => null);
    }
    await dbUpdate('automation_studio_queue_links', { id: link.id }, { status: 'stopped' }).catch(() => null);
  }
  const assets = await dbList('automation_studio_assets', { campaign_id: campaignId }).catch(() => []);
  const nextPlatforms = (campaign.platforms || []).filter((item) => item !== platform);
  await Promise.all(assets.filter((asset) => asset.platform === platform).map((asset) => dbUpdate('automation_studio_assets', { id: asset.id }, {
    status: 'stopped',
    metadata: {
      ...(asset.metadata || {}),
      deletedAt: new Date().toISOString(),
      deletedBy: user.email || user.type || 'admin'
    }
  }).catch(() => null)));
  await dbUpdate('automation_studio_campaigns', { id: campaignId }, {
    platforms: nextPlatforms,
    summary: {
      ...(campaign.summary || {}),
      [`${platform}SetDeletedAt`]: new Date().toISOString()
    }
  }).catch(() => null);
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_set_deleted',
    message: `${campaign.name}:${platform}`,
    payload: { campaignId, platform }
  }).catch(() => null);
  return getAutomationCampaign(campaignId);
}

export async function deleteAutomationCampaign(id, user = {}) {
  const campaign = await dbGet('automation_studio_campaigns', { id });
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  await archiveCampaignGeneration(id);
  await dbUpdate('automation_studio_campaigns', { id }, {
    status: 'stopped',
    stopped_at: new Date().toISOString(),
    summary: {
      ...(campaign.summary || {}),
      deletedAt: new Date().toISOString(),
      deletedBy: user.email || user.type || 'admin'
    }
  });
  await logActivity({
    account_id: campaign.account_id,
    project_id: campaign.project_id,
    action: 'automation_studio_campaign_deleted',
    message: campaign.name,
    payload: { campaignId: id }
  }).catch(() => null);
  return { id, deleted: true };
}
