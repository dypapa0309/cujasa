import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, Bot, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, CreditCard, Download, FileText, Landmark, Link2, LogOut, PauseCircle, PlayCircle, RefreshCw, RotateCw, Search, Settings, ShieldCheck, Sparkles, Upload, Users, UserCircle, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';
import { PRODUCTS, CURRENT_PRODUCT, productById } from '../../config/products.js';
import {
  commentStyleOptions,
  contentIntensityOptions,
  contentModeOptions,
  emojiLevelOptions,
  productMentionOptions
} from '../../config/contentStrategy.js';

const MAX_DAILY_POSTS = 5;

const cujasaActions = [
  { key: 'run', label: '자동화 실행', icon: PlayCircle, hint: '오늘 예약을 만들고 실행 상태를 확인해요.' },
  { key: 'settings', label: '설정 확인', icon: Settings, hint: 'Threads, 쿠팡 API, 콘텐츠 기준을 점검해요.' },
  { key: 'posts', label: '포스팅 현황', icon: FileText, hint: '예약, 완료, 확인 필요 글을 봐요.' },
  { key: 'home', label: '성과 보기', icon: BarChart3, hint: '예약 수와 클릭 성과를 요약해요.' }
];

const productPreviewActions = [
  { key: 'dexor', label: 'DEXOR', icon: Search, hint: '캠페인에 맞는 블로그 후보를 고르는 솔루션이에요.' },
  { key: 'spread', label: 'SPREAD', icon: Sparkles, hint: '캠페인 운영과 제출물 확인을 줄이는 솔루션이에요.' },
  { key: 'polibot', label: 'POLIBOT', icon: ShieldCheck, hint: '보험 보장분석과 상품 추천을 정리하는 솔루션이에요.' },
  { key: 'infludex', label: 'INFLUDEX', icon: BarChart3, hint: '인스타그램 인플루언서를 카테고리와 등급으로 분석해요.' }
];

const dexorActions = [
  { key: 'dexor-upload', productId: 'dexor', label: '후보 업로드', icon: Upload, hint: '블로그 URL이나 후보 파일을 넣는 첫 화면이에요.' },
  { key: 'dexor-grade', productId: 'dexor', label: '등급 분석', icon: Search, hint: 'S/A/B/C/D 기준으로 후보 등급과 분석 기준을 확인해요.' },
  { key: 'dexor-download', productId: 'dexor', label: '후보 다운로드', icon: Download, hint: '선정 후보 내보내기 흐름을 준비해요.' }
];

const spreadActions = [
  { key: 'spread-campaign', productId: 'spread', label: '캠페인 추천', icon: Sparkles, hint: '목표와 상품 유형으로 캠페인 초안을 만들어요.' },
  { key: 'spread-applicants', productId: 'spread', label: '참여자 선정', icon: Users, hint: '신청자와 선정 기준을 비교해요.' },
  { key: 'spread-review', productId: 'spread', label: '제출물 검수', icon: ClipboardCheck, hint: '제출 URL과 필수 조건을 점검해요.' }
];

const polibotActions = [
  { key: 'polibot-upload', productId: 'polibot', label: 'PDF 업로드', icon: Upload, hint: '보험 상품 PDF와 메모를 넣고 분석 준비 상태를 만들어요.' },
  { key: 'polibot-recommend', productId: 'polibot', label: '상품 추천', icon: Sparkles, hint: '고객 조건과 보장 니즈로 추천 초안을 만들어요.' },
  { key: 'polibot-customers', productId: 'polibot', label: '고객 관리', icon: Users, hint: '상담 고객과 메모를 정리해요.' },
  { key: 'polibot-download', productId: 'polibot', label: '결과 다운로드', icon: Download, hint: '추천 결과를 CSV로 내려받아요.' }
];

const infludexActions = [
  { key: 'infludex-upload', productId: 'infludex', label: '후보 업로드', icon: Upload, hint: '인스타그램 계정 URL, 카테고리, 반응 지표를 넣어요.' },
  { key: 'infludex-grade', productId: 'infludex', label: '씨랭 분석', icon: Search, hint: 'DIAMOND/S/A/B/C/D 등급과 카테고리를 확인해요.' },
  { key: 'infludex-download', productId: 'infludex', label: '결과 다운로드', icon: Download, hint: '분석 결과를 CSV로 내려받아요.' }
];

const workspaceActions = [
  { key: 'account-settings', label: '계정 설정', icon: UserCircle, hint: 'JASAIN 로그인 정보와 보유 솔루션을 확인해요.' },
  { key: 'billing', label: '결제', icon: CreditCard, hint: 'JASAIN 계정의 결제 상태와 이용권을 확인해요.' }
];

const productTaskActions = {
  cujasa: cujasaActions,
  dexor: dexorActions,
  spread: spreadActions,
  polibot: polibotActions,
  infludex: []
};

const actions = [...cujasaActions, ...workspaceActions, ...productPreviewActions, ...dexorActions, ...spreadActions, ...polibotActions, ...infludexActions];
const pendingSubscriptionKey = 'cujasa_pending_subscription';

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/25';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';
const dexorCategoryOptions = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const dexorScoreRows = [
  ['S', '90점 이상', '최우선 후보'],
  ['A', '80-89점', '우선 선정 후보'],
  ['B', '70-79점', '검토 가능 후보'],
  ['C', '60-69점', '보조 후보'],
  ['D', '60점 미만', '제외 또는 재검토']
];
const betaFaqItems = [
  {
    id: 'what-cujasa',
    patterns: ['쿠자사 뭐야', 'cujasa 뭐야', '쿠자사란', 'cujasa란', '쿠자사 설명', 'cujasa 설명'],
    answer: 'CUJASA는 주제 선정, 쿠팡 파트너스 상품 검색, 콘텐츠 생성, Threads 예약 업로드를 한 화면에서 처리하는 자동화 솔루션이에요. 지금은 텍스트 기반 Threads 자동화가 중심이고, 이후 이미지/영상 포맷과 다른 제휴 채널까지 확장할 예정이에요.',
    actions: [{ label: '자동화 실행', actionKey: 'run' }, { label: '설정 열기', actionKey: 'settings' }]
  },
  {
    id: 'jasain-products',
    patterns: ['자사인 뭐야', 'jasain 뭐야', '솔루션 뭐 있어', '제품 뭐 있어', '무슨 서비스'],
    answer: 'JASAIN은 자동화 솔루션 허브예요. CUJASA는 제휴 콘텐츠와 Threads 업로드, DEXOR는 블로그 후보 분석, SPREAD는 캠페인 운영, POLIBOT은 보험 보장분석, INFLUDEX는 인스타그램 인플루언서 분석을 맡아요.',
    actions: [{ label: 'DEXOR 열기', actionKey: 'dexor-upload' }, { label: 'INFLUDEX 열기', actionKey: 'infludex-upload' }]
  },
  {
    id: 'coupang-api',
    patterns: ['쿠팡 api', 'api 키', 'access key', 'secret key', '파트너', 'tracking', '트래킹'],
    answer: '쿠팡 파트너스 API 키는 설정 확인 패널의 쿠팡 API 섹션에 입력해요. Access Key, Secret Key, Partner ID, Tracking Code를 저장하면 CUJASA가 실제 쿠팡 상품을 검색하고 링크 글에 연결해요. 비워두면 기존 저장값은 유지돼요.',
    actions: [{ label: '설정 열기', actionKey: 'settings' }]
  },
  {
    id: 'trial',
    patterns: ['무료체험', '무료 체험', '몇 번', '5회', '체험', '무료'],
    answer: '무료 체험은 실제 Threads 업로드 5회까지 사용할 수 있어요. 체험 횟수를 모두 쓰면 자동화 실행이 막히고, 결제 후 계속 사용할 수 있어요.',
    actions: [{ label: '자동화 실행', actionKey: 'run' }, { label: '결제 확인', actionKey: 'billing' }]
  },
  {
    id: 'real-products',
    patterns: ['실상품', '실 상품', '링크 필요', '상품 링크', '검색 링크', '수익화 링크'],
    answer: '실상품 링크는 쿠팡 API에서 실제 상품으로 확인된 링크예요. 검색 실패 임시상품이나 검색 URL은 수익화 링크로 쓰지 않아요. 링크 글을 예약하려면 먼저 실상품이 검색되고 콘텐츠에 연결되어야 해요.',
    actions: [{ label: '포스팅 현황', actionKey: 'posts' }, { label: '설정 열기', actionKey: 'settings' }]
  },
  {
    id: 'threads',
    patterns: ['threads', '스레드', '쓰레드', '연결 안', '연동 안', '토큰', '로그인'],
    answer: 'Threads 연결은 브라우저의 threads.net 로그인 상태를 기준으로 진행돼요. 앱만 로그인되어 있으면 실패할 수 있으니 Chrome 또는 Safari에서 올바른 Threads 계정으로 로그인한 뒤 다시 연결해 주세요.',
    actions: [{ label: '설정 열기', actionKey: 'settings' }]
  },
  {
    id: 'schedule',
    patterns: ['시간', '업로드 시간', '스케줄', '예약 시간', '첫 업로드'],
    answer: '업로드 시간은 설정 확인 패널의 포스팅 스케줄에서 첫 업로드 시각 하나로 관리해요. 하루 여러 개가 예약되면 이 시각부터 설정된 간격으로 뒤에 배치돼요.',
    actions: [{ label: '설정 열기', actionKey: 'settings' }, { label: '포스팅 현황', actionKey: 'posts' }]
  },
  {
    id: 'pricing',
    patterns: ['결제', '가격', '월정액', '영구', '환불', '입금', '구매'],
    answer: '결제는 JASAIN 계정 단위로 관리해요. 무료 체험 이후에는 결제 상태에 따라 자동화 사용 권한이 유지돼요. 결제 패널에서 현재 상태와 상품을 확인할 수 있어요.',
    actions: [{ label: '결제 확인', actionKey: 'billing' }]
  },
  {
    id: 'dexor-credit',
    patterns: ['덱서 크레딧', 'dexor 크레딧', '크레딧 충전', '남은 횟수', '분석 횟수', '5천원', '만원', '가상계좌'],
    answer: 'DEXOR는 무료 5회 이후 크레딧을 충전해서 써요. 충전은 가상계좌 전용이고 5천원 10회, 1만원 25회, 5만원 150회, 10만원 350회 기준이에요. 입금 확인이 서버에 들어온 뒤 크레딧이 반영돼요.',
    actions: [{ label: '결제 확인', actionKey: 'billing' }, { label: '등급 분석', actionKey: 'dexor-grade' }]
  },
  {
    id: 'dexor-quality',
    patterns: ['블로그 품질', '품질 분석', '등급 기준', '씨랭', '씨랭크', '최적화', '준최적화', '좋은 블로그', '광고성'],
    answer: 'DEXOR는 분석 카테고리를 먼저 정한 뒤 후보 URL, 네이버 블로그 여부, 최근글일, 방문/조회 추정, 댓글/공감, 광고성 메모를 기준으로 S/A/B/C/D 순서로 정리해요. CSV에 후보 카테고리와 품질 컬럼을 넣으면 이유와 점수가 더 구체적으로 나와요.',
    actions: [{ label: '후보 업로드', actionKey: 'dexor-upload' }, { label: '등급 분석', actionKey: 'dexor-grade' }]
  },
  {
    id: 'affiliate-expansion',
    patterns: ['어필리에이트', '제휴 채널', '토스 쉐어', '토스쉐어', '쿠팡 말고', '링크 비율', '1:1', '1:2:1'],
    answer: 'CUJASA 확장은 제휴 채널을 최대 3개까지 붙이는 방향으로 잡고 있어요. 1차는 쿠팡 파트너스, 토스 쉐어링크/수동 링크, 커스텀 제휴 링크로 보고 있고, 링크 노출은 1:1 또는 1:2:1 같은 가중치로 랜덤 배치하는 구조가 적합해요.',
    actions: [{ label: '설정 열기', actionKey: 'settings' }]
  },
  {
    id: 'spread-automation',
    patterns: ['스프레드 자동화', 'spread 자동화', '캠페인 등록', '신청자', '신청 마감', '리스트 다운로드', '제출물'],
    answer: 'SPREAD는 광고주가 캠페인을 등록하고, 신청자가 들어오고, 마감 후 참여자 리스트와 제출물 검수를 정리하는 방향의 자동화로 확장할 수 있어요. 지금은 캠페인 추천, 참여자 선정, 제출물 검수 v1 작업 패널이 준비돼 있어요.',
    actions: [{ label: '캠페인 추천', actionKey: 'spread-campaign' }, { label: '참여자 선정', actionKey: 'spread-applicants' }]
  },
  {
    id: 'polibot',
    patterns: ['polibot', '폴리봇', '보험 분석', '보장분석', '보험 추천', '보험 pdf', '암보장', '보장 상품', '상품 추천', '생활비', '진단비'],
    answer: 'POLIBOT은 보험 상품 PDF와 고객 조건을 정리해서 보장분석과 상품 추천 초안을 만드는 솔루션이에요. PDF 업로드, 고객 프로필, 추천 결과 다운로드 흐름으로 써요.',
    actions: [{ label: 'PDF 업로드', actionKey: 'polibot-upload' }, { label: '상품 추천', actionKey: 'polibot-recommend' }]
  },
  {
    id: 'infludex',
    patterns: ['infludex', '인플루덱스', '인스타 분석', '인스타그램 분석', '씨랭', 'c-rank', '카테고리 어디'],
    answer: 'INFLUDEX는 인스타그램 후보 계정을 카테고리, 팔로워, 평균 좋아요/댓글, 최근 활동, 광고성 메모 기준으로 DIAMOND/S/A/B/C/D 등급으로 정리해요. 결과에는 카테고리와 등급 사유가 같이 보여요.',
    actions: [{ label: '후보 업로드', actionKey: 'infludex-upload' }, { label: '씨랭 분석', actionKey: 'infludex-grade' }]
  },
  {
    id: 'dexor-spread',
    patterns: ['dexor', '덱서', 'spread', '스프레드', '블로그 선정', '캠페인'],
    answer: 'DEXOR는 블로그 후보 업로드, 등급 분석, 후보 다운로드 흐름으로 써요. SPREAD는 캠페인 추천, 참여자 선정, 제출물 검수 흐름으로 써요. 보유 제품이면 바로 작업 패널을 열고, 아직 보유 전이면 제품 시작 화면을 먼저 보여줘요.',
    actions: [
      { label: 'DEXOR 열기', actionKey: 'dexor-upload' },
      { label: 'SPREAD 열기', actionKey: 'spread-campaign' }
    ]
  },
  {
    id: 'setup-error',
    patterns: ['오류', '에러', '실패', '안돼', '안 되', '세팅', '설정 문제'],
    answer: '오류나 세팅 문제는 대부분 Threads 연결, 쿠팡 API 키, 실상품 연결, 결제 권한 중 하나에서 생겨요. 먼저 설정 확인에서 저장값을 점검하고, 자동화 실행에서 사전 점검을 돌려보세요.',
    actions: [{ label: '설정 열기', actionKey: 'settings' }, { label: '자동화 실행', actionKey: 'run' }]
  }
];

function findFaqAnswer(value = '') {
  const text = value.toLowerCase().replace(/\s+/g, ' ');
  return betaFaqItems.find((item) => item.patterns.some((pattern) => text.includes(pattern.toLowerCase())));
}

function clampDailyPostCount(value, fallback = 1) {
  const number = Number(value);
  return Math.min(MAX_DAILY_POSTS, Math.max(0, Number.isFinite(number) ? number : fallback));
}

function statusLabel(status) {
  return {
    scheduled: '예약',
    posted: '완료',
    failed: '실패',
    retry: '재시도',
    manual_required: '확인 필요',
    skipped: '제외'
  }[status] || status || '대기';
}

function price(value) {
  return `${Number(value || 0).toLocaleString()}원`;
}

function formatBillingDate(value) {
  return value ? new Date(value).toLocaleDateString('ko-KR') : '-';
}

function billingTitle(billing) {
  if (billing?.plan === 'onetime' && billing?.status === 'paid') return '영구 이용 중';
  if (billing?.status === 'active') return `${formatBillingDate(billing.paidUntil)}까지 이용 가능`;
  if (billing?.status === 'past_due') return '이용 기간 만료';
  if (billing?.status === 'pending') return '입금 대기';
  if (billing?.status === 'paid') return '이용 가능';
  return '결제 전';
}

function loadTossSdk() {
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-toss-payments]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.TossPayments));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://js.tosspayments.com/v2/standard';
    script.async = true;
    script.dataset.tossPayments = 'true';
    script.onload = () => resolve(window.TossPayments);
    script.onerror = () => reject(new Error('Toss 결제 모듈을 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
}

async function requestTossPayment(toss) {
  if (toss.clientKey === 'test_ck_dev_placeholder') {
    throw new Error('TOSS_CLIENT_KEY를 설정한 뒤 결제를 진행할 수 있어요.');
  }
  const TossPayments = await loadTossSdk();
  const tossPayments = TossPayments(toss.clientKey);
  const payment = tossPayments.payment({ customerKey: toss.customerKey });
  await payment.requestPayment({
    method: toss.method,
    amount: { currency: 'KRW', value: Number(toss.amount) },
    orderId: toss.orderId,
    orderName: toss.orderName,
    successUrl: toss.successUrl,
    failUrl: toss.failUrl
  });
}

async function requestBillingAuth(toss) {
  if (toss.clientKey === 'test_ck_dev_placeholder') {
    throw new Error('TOSS_CLIENT_KEY를 설정한 뒤 자동결제를 등록할 수 있어요.');
  }
  const TossPayments = await loadTossSdk();
  const tossPayments = TossPayments(toss.clientKey);
  const payment = tossPayments.payment({ customerKey: toss.customerKey });
  await payment.requestBillingAuth({
    method: toss.method,
    customerKey: toss.customerKey,
    successUrl: toss.successUrl,
    failUrl: toss.failUrl
  });
}

function parseSettingsDraft(value = '') {
  const text = value.trim();
  if (!/(타겟|대상|여성|남성|주방|용품|톤|말투|반말|존댓말|포스팅|글)/.test(text)) return null;

  const targetMatch = text.match(/((?:\d{2,4}대|\d{2,4})\s*(?:여성|남성|주부|직장인|자취생|부모|엄마|아빠|대학생|청년|중년)?|(?:여성|남성|주부|직장인|자취생|부모|엄마|아빠|대학생|청년|중년))/);
  const toneMatch = text.match(/(반말|존댓말|친근(?:한|하게)?|전문적(?:인|으로)?|담백(?:한|하게)?|짧(?:은|게)?|유머(?:러스)?|정보성)/);
  const scopeMatch = text.match(/([가-힣A-Za-z0-9]{2,20}(?:용품|제품|상품|아이템|가전|식품|생활용품|주방용품|청소용품))/)
    || text.match(/(?:대해|대한|관련|주제로|카테고리(?:는)?|상품(?:은)?|용품(?:은)?|포스팅(?:해줘|하기)?\s*)([가-힣A-Za-z0-9\s]{2,24}?)(?:에 대해|으로|로|를|을|포스팅|글|$)/);

  const values = {};
  if (targetMatch?.[1]) values.target_audience = targetMatch[1].replace(/\s+/g, ' ').trim();
  if (toneMatch?.[1]) values.tone = toneMatch[1].replace(/하게$|한$|인$|으로$/g, '').trim();
  if (scopeMatch?.[1]) {
    values.content_scope = scopeMatch[1]
      .replace(/^(으로|로|를|을|에|대해|대한)\s*/, '')
      .replace(/\s*(에 대해|에 대한|으로|로|를|을|포스팅|글).*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const meaningful = ['target_audience', 'tone', 'content_scope'].filter((key) => values[key]);
  if (meaningful.length < 2) return null;
  return values;
}

const POLIBOT_NEED_KEYWORDS = ['암', '암보장', '유사암', '뇌', '심장', '질병', '상해', '입원', '수술', '실손', '실비', '간병', '치매', '운전자', '어린이', '태아', '생활비', '진단비'];

function parsePolibotDraft(value = '') {
  const text = value.trim();
  if (!/(폴리봇|polibot|보험|보장|암|실비|실손|진단비|생활비|상품\s*추천|추천)/i.test(text)) return null;
  const needs = [...new Set(POLIBOT_NEED_KEYWORDS
    .filter((keyword) => text.includes(keyword))
    .map((keyword) => (keyword === '암보장' ? '암' : keyword)))];
  const age = text.match(/(\d{2})\s*세/)?.[1] || text.match(/(\d{2})\s*살/)?.[1] || '';
  const name = text.match(/\d{2}\s*세\s*([가-힣]{2,4})(?:은|는|이|가|님|씨)?/)?.[1]
    || text.match(/([가-힣]{2,4})(?:은|는|이|가|님|씨)?\s*\d{2}\s*(?:세|살)/)?.[1]
    || text.match(/([가-힣]{2,4})\s*(?:고객|님|씨)/)?.[1]
    || '';
  const gender = /여성|여자|여\b/.test(text) ? '여성' : /남성|남자|남\b/.test(text) ? '남성' : '';
  const budget = text.match(/월\s*(\d{1,3})\s*만/)?.[1] || text.match(/(\d{1,3})\s*만원/)?.[1] || '';

  if (!age && needs.length === 0 && !/(보험|보장|상품\s*추천)/.test(text)) return null;
  return {
    name,
    age,
    gender,
    needs: needs.join('\n'),
    budget,
    company: '전체 보험사'
  };
}

function getGrantUsage(grant, productId) {
  const settings = grant?.settingsSummary || grant?.settings || {};
  const usageRoot = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const usage = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(usage.limit)) ? Math.max(0, Number(usage.limit)) : 5;
  const used = Number.isFinite(Number(usage.used)) ? Math.max(0, Number(usage.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, Number.isFinite(Number(usage.remaining)) ? Number(usage.remaining) : limit - used)
  };
}

function workspaceUsage(workspace) {
  const usage = workspace?.usage && typeof workspace.usage === 'object' ? workspace.usage : {};
  const limit = Number.isFinite(Number(usage.limit)) ? Math.max(0, Number(usage.limit)) : 5;
  const used = Number.isFinite(Number(usage.used)) ? Math.max(0, Number(usage.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, Number.isFinite(Number(usage.remaining)) ? Number(usage.remaining) : limit - used)
  };
}

function sortDexorResults(results = []) {
  const order = { S: 0, A: 1, B: 2, C: 3, D: 4, '씨랭크/다이아': 0, '최적화': 1, '준최적화': 2, '일반': 3, '제외/재검토': 4 };
  return [...results].sort((a, b) => {
    const aLabel = a.scoreLabel || a.grade || '';
    const bLabel = b.scoreLabel || b.grade || '';
    const gradeDelta = (order[aLabel] ?? 99) - (order[bLabel] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
}

function dexorScoreComment(score) {
  const value = Number(score || 0);
  if (value >= 90) return '최우선으로 볼 만한 후보예요.';
  if (value >= 80) return '우선 선정 후보에 가까워요.';
  if (value >= 70) return '조건을 확인하며 검토할 후보예요.';
  if (value >= 60) return '보조 후보로 보는 편이 좋아요.';
  return '제외하거나 다시 검토하는 편이 좋아요.';
}

function sortInfludexResults(results = []) {
  const order = { DIAMOND: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
  return [...results].sort((a, b) => {
    const gradeDelta = (order[a.grade] ?? 99) - (order[b.grade] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.handle || a.url || '').localeCompare(String(b.handle || b.url || ''));
  });
}

export default function CustomerBetaPage({
  account,
  accounts = [],
  currentUser,
  trialStatus,
  reloadTrialStatus,
  setupStatus,
  reloadSetupStatus,
  setTab,
  onLogout,
  reloadAccounts,
  reloadCurrentUser,
  onSelectAccount,
  pipelineResult,
  onPipelineDone,
  onPipelineRunningChange
}) {
  const toast = useToast();
  const [queue, setQueue] = useState([]);
  const [posts, setPosts] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [activeActionKey, setActiveActionKey] = useState('');
  const [drawerClosing, setDrawerClosing] = useState(false);
  const initialUrlProductId = productById(new URLSearchParams(window.location.search).get('product'))?.id || CURRENT_PRODUCT.id;
  const initialUrlProductHandledRef = useRef(false);
  const [selectedProductId, setSelectedProductId] = useState(initialUrlProductId);
  const [showOtherProducts, setShowOtherProducts] = useState(false);
  const [messages, setMessages] = useState([]);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [assistantDraft, setAssistantDraft] = useState(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [businessInfoOpen, setBusinessInfoOpen] = useState(false);
  const [supportInfoOpen, setSupportInfoOpen] = useState(false);
  const [startingProductId, setStartingProductId] = useState('');
  const chatEndRef = useRef(null);
  const lastPromptRef = useRef({ value: '', at: 0 });

  const loadWorkspaceData = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    setLoadError('');
    try {
      const [queueRows, postRows, analyticsData] = await Promise.all([
        api.get(`/api/accounts/${account.id}/queue`),
        api.get(`/api/accounts/${account.id}/posts`),
        api.get(`/api/accounts/${account.id}/analytics`)
      ]);
      setQueue(Array.isArray(queueRows) ? queueRows : []);
      setPosts(Array.isArray(postRows) ? postRows : []);
      setAnalytics(analyticsData || null);
    } catch (err) {
      console.error(err);
      setLoadError('운영 데이터를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [account?.id]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData, pipelineResult]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const summary = useMemo(() => {
    const scheduled = queue.filter((row) => row.status === 'scheduled').length;
    const posted = queue.filter((row) => row.status === 'posted').length;
    const needsReview = queue.filter((row) => ['failed', 'retry', 'manual_required', 'skipped'].includes(row.status)).length;
    return {
      scheduled,
      posted,
      needsReview,
      clicks: analytics?.totalClicks ?? analytics?.accountClicks ?? 0
    };
  }, [queue, analytics]);

  const activeProducts = useMemo(() => (currentUser?.products || [])
    .filter((grant) => grant.status !== 'suspended')
    .map((grant) => productById(grant.productId) || {
      id: grant.productId,
      name: grant.name || grant.productId,
      description: grant.description || ''
    })
    .filter((product) => product?.id), [currentUser?.products]);
  const grantedProductIds = new Set(activeProducts.map((product) => product.id));
  const visibleProducts = activeProducts.length ? activeProducts : [CURRENT_PRODUCT];
  const otherProducts = PRODUCTS.filter((product) => !grantedProductIds.has(product.id));
  const selectedProduct = visibleProducts.find((product) => product.id === selectedProductId)
    || (activeActionKey === selectedProductId ? otherProducts.find((product) => product.id === selectedProductId) : null)
    || visibleProducts[0]
    || productById(selectedProductId)
    || CURRENT_PRODUCT;
  const productGrantById = useMemo(() => Object.fromEntries((currentUser?.products || []).map((grant) => [grant.productId, grant])), [currentUser?.products]);
  const selectedProductGrant = productGrantById[selectedProduct.id];
  const selectedProductGranted = grantedProductIds.has(selectedProduct.id);
  const selectedProductUsage = getGrantUsage(selectedProductGrant, selectedProduct.id);
  const selectedProductPreparing = selectedProduct.status === 'preparing' || selectedProduct.id === 'infludex';
  const productActions = selectedProductGranted && !selectedProductPreparing ? (productTaskActions[selectedProduct.id] || []) : [];
  const activeAction = actions.find((action) => action.key === activeActionKey) || null;
  const needsThreadsReconnect = selectedProduct.id === CURRENT_PRODUCT.id
    && account?.id
    && (!account.has_threads_access_token || (account.threads_token_status && account.threads_token_status !== 'connected'));

  useEffect(() => {
    if (initialUrlProductHandledRef.current) return;
    const urlProductId = productById(new URLSearchParams(window.location.search).get('product'))?.id;
    if (!urlProductId) {
      initialUrlProductHandledRef.current = true;
      return;
    }
    const urlProduct = productById(urlProductId);
    if (!urlProduct) {
      initialUrlProductHandledRef.current = true;
      return;
    }
    setSelectedProductId(urlProductId);
    if (!grantedProductIds.has(urlProductId) && urlProductId !== CURRENT_PRODUCT.id) {
      setShowOtherProducts(true);
      setActiveActionKey(urlProductId);
    }
    initialUrlProductHandledRef.current = true;
  }, [grantedProductIds]);

  const openAction = (action) => {
    if (!action) {
      return;
    }
    setDrawerClosing(false);
    setActiveActionKey(action.key);
  };

  const openWorkspaceAction = (actionOrKey) => {
    const action = typeof actionOrKey === 'string'
      ? actions.find((item) => item.key === actionOrKey)
      : actionOrKey;
    if (!action) return;

    const previewProductIds = ['dexor', 'spread', 'polibot', 'infludex'];
    const productId = action.productId || (previewProductIds.includes(action.key) ? action.key : '');
    if (productId === 'infludex') {
      setSelectedProductId('infludex');
      setShowOtherProducts(true);
      openOtherProduct(productById('infludex'));
      return;
    }
    if (action.productId && !grantedProductIds.has(action.productId)) {
      const product = productById(action.productId);
      if (product) {
        setShowOtherProducts(true);
        openOtherProduct(product);
      }
      return;
    }
    if (previewProductIds.includes(action.key) && !grantedProductIds.has(action.key)) {
      const product = productById(action.key);
      if (product) {
        setShowOtherProducts(true);
        openOtherProduct(product);
      }
      return;
    }
    if (productId && productId !== selectedProductId) {
      setSelectedProductId(productId);
    }
    openAction(action);
  };

  const applyAssistantResult = (result, fallbackValue = '') => {
    if (!result) return false;
    const actionKey = result.action || result.recommendedAction || '';
    if (actionKey) {
      setAssistantDraft({
        id: Date.now(),
        actionKey,
        values: result.draft || {},
        intent: result.intent || ''
      });
      if (actionKey === 'settings' && result.draft && Object.keys(result.draft).length) {
        setSettingsDraft({ id: Date.now(), values: result.draft });
      }
      openWorkspaceAction(actionKey);
    }
    if (result.answer) {
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          content: result.answer,
          actions: Array.isArray(result.buttons) && result.buttons.length ? result.buttons : result.actions || []
        }
      ].slice(-8));
      return true;
    }
    if (actionKey) return true;
    return Boolean(fallbackValue);
  };

  const resolvePromptAction = (value = '') => {
    const text = value.toLowerCase();
    const byKey = (key) => actions.find((item) => item.key === key);
    if (/계정|로그아웃|비밀번호|아이디|이메일|연락처|회원/.test(text)) return byKey('account-settings');
    if (/결제|가격|월정액|영구|환불|입금|구매|카드/.test(text)) return byKey('billing');
    if (/덱서|dexor|블로그|후보/.test(text)) {
      if (!grantedProductIds.has('dexor')) return byKey('dexor');
      if (/분석|등급|점수|씨랭|씨랭크|최적화|준최적화|s\/a|s등급|a등급/.test(text)) return byKey('dexor-grade');
      if (/다운로드|내보내|csv|엑셀|xlsx/.test(text)) return byKey('dexor-download');
      return byKey('dexor-upload');
    }
    if (/스프레드|spread|캠페인|참여자|신청자|제출|검수/.test(text)) {
      if (!grantedProductIds.has('spread')) return byKey('spread');
      if (/참여자|신청자|선정|후보/.test(text)) return byKey('spread-applicants');
      if (/제출|검수|url|키워드|금지/.test(text)) return byKey('spread-review');
      return byKey('spread-campaign');
    }
    if (/폴리봇|polibot|보험|보장|암|실비|실손|진단비|생활비|상품\s*추천/.test(text)) {
      if (!grantedProductIds.has('polibot')) return byKey('polibot');
      if (/자료|pdf|업로드|문서|보험사|데이터/.test(text)) return byKey('polibot-upload');
      if (/고객|목록|관리|저장/.test(text)) return byKey('polibot-customers');
      if (/다운로드|내보내|csv|엑셀|결과/.test(text)) return byKey('polibot-download');
      return byKey('polibot-recommend');
    }
    if (/설정|api|threads|쿠팡|세팅/.test(text)) return byKey('settings');
    if (/실행|자동화|예약|시작/.test(text)) return byKey('run');
    if (/포스팅|글|현황|결과/.test(text)) return byKey('posts');
    if (/성과|분석|클릭|대시/.test(text)) return byKey('home');
    return null;
  };

  const closeDrawer = () => {
    setDrawerClosing(true);
    window.setTimeout(() => {
      setActiveActionKey('');
      setDrawerClosing(false);
    }, 260);
  };

  const selectProduct = (product) => {
    setSelectedProductId(product.id);
    setActiveActionKey('');
  };

  const openOtherProduct = (product) => {
    setSelectedProductId(product.id);
    setActiveActionKey(product.id);
  };

  const startProduct = async (productId) => {
    if (!productId) return;
    setStartingProductId(productId);
    try {
      await api.post(`/api/auth/products/${encodeURIComponent(productId)}/start`);
      await reloadCurrentUser?.();
      setSelectedProductId(productId);
      setShowOtherProducts(false);
      setActiveActionKey('');
      toast('제품 사용을 시작했어요.', 'success');
    } catch (err) {
      toast(err?.message || '제품 사용 시작에 실패했어요.', 'error');
    } finally {
      setStartingProductId('');
    }
  };

  const submitPrompt = async (event) => {
    event.preventDefault();
    if (assistantLoading) return;
    const value = prompt.trim();
    if (!value) return;
    if ([...value].length < 2) {
      setPrompt('');
      return;
    }
    const now = Date.now();
    if (lastPromptRef.current.value === value && now - lastPromptRef.current.at < 900) {
      return;
    }
    lastPromptRef.current = { value, at: now };
    setPrompt('');
    setMessages((prev) => [...prev, { id: `user-${now}`, role: 'user', content: value }].slice(-8));
    setAssistantLoading(true);
    try {
      const assistant = await api.post('/api/workspace-assistant/message', {
        message: value,
        currentProduct: selectedProduct.id,
        currentAction: activeActionKey,
        availableProducts: activeProducts.map((product) => product.id)
      });
      if (applyAssistantResult(assistant, value)) return;
    } catch (err) {
      console.warn('[workspace-assistant-fallback]', err.message);
    } finally {
      setAssistantLoading(false);
    }
    const action = resolvePromptAction(value);
    if (value.length < 2 && !action) return;
    if (/작업|기능|메뉴|뭐\s*있|뭐있|할\s*수|뭘\s*할/.test(value)) {
      const taskNames = productActions.map((item) => item.label);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${now + 1}`,
          role: 'assistant',
          content: taskNames.length > 0
            ? `${selectedProduct.name}에서는 ${taskNames.join(', ')} 작업을 바로 열 수 있어요. 아래 버튼을 누르거나 왼쪽 Tasks에서 선택해 주세요.`
            : `${selectedProduct.name}은 아직 시작 전이에요. 먼저 제품 시작하기를 누르면 작업이 열려요.`,
          actions: productActions.map((item) => ({ label: item.label, actionKey: item.key }))
        }
      ].slice(-6));
      return;
    }
    const draft = parseSettingsDraft(value);
    if (draft) {
      setSettingsDraft({ id: Date.now(), values: draft });
      setDrawerClosing(false);
      setActiveActionKey('settings');
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          content: '설정 초안을 채웠어요. 오른쪽 설정 패널에서 타깃, 톤, 카테고리를 확인한 뒤 저장하면 반영돼요. 자동화 실행은 저장 후 직접 시작해 주세요.',
          actions: [{ label: '설정 확인', actionKey: 'settings' }]
        }
      ].slice(-6));
      return;
    }
    const polibotDraft = parsePolibotDraft(value);
    if (polibotDraft) {
      setAssistantDraft({ id: Date.now(), actionKey: 'polibot-recommend', values: polibotDraft });
      setDrawerClosing(false);
      if (grantedProductIds.has('polibot')) {
        setSelectedProductId('polibot');
        setActiveActionKey('polibot-recommend');
      } else {
        setSelectedProductId('polibot');
        setActiveActionKey('polibot');
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now() + 1}`,
          role: 'assistant',
          content: grantedProductIds.has('polibot')
            ? 'POLIBOT 상품 추천 초안을 채웠어요. 오른쪽 패널에서 고객 조건을 확인한 뒤 추천 초안 만들기를 눌러주세요.'
            : 'POLIBOT에서 처리할 수 있는 보험 추천 요청이에요. 먼저 POLIBOT 시작하기를 누르면 추천 초안을 이어서 쓸 수 있어요.',
          actions: grantedProductIds.has('polibot')
            ? [{ label: '상품 추천 열기', actionKey: 'polibot-recommend' }, { label: '자료 확인', actionKey: 'polibot-upload' }]
            : [{ label: 'POLIBOT 시작', actionKey: 'polibot' }]
        }
      ].slice(-6));
      return;
    }
    const faq = findFaqAnswer(value);
    if (faq) {
      setMessages((prev) => [
        ...prev,
        { id: `assistant-${Date.now() + 1}`, role: 'assistant', content: faq.answer, actions: faq.actions || [] }
      ].slice(-6));
      return;
    }
    if (action) {
      openWorkspaceAction(action);
      return;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: '아직 정확히 맞는 답변을 찾지 못했어요. “쿠팡 API 어디에 넣어?”, “무료체험 몇 번?”, “Threads 연결 안돼”, “실상품 링크가 뭐야?”처럼 조금 더 구체적으로 입력해보세요.',
        actions: [
          { label: '설정 열기', actionKey: 'settings' },
          { label: '자동화 실행', actionKey: 'run' }
        ]
      }
    ].slice(-6));
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#111111] text-zinc-100 supports-[height:100dvh]:min-h-dvh">
      <div className="grid min-h-screen min-w-0 supports-[height:100dvh]:min-h-dvh lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/10 bg-[#191919] px-4 py-5 lg:block">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-3 px-2">
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white">
                <img src="/jasain_logo.png" alt="JASAIN" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-black">JASAIN</div>
                <div className="truncate text-xs text-zinc-500">워크스페이스</div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              <SidebarGroup label="Solutions">
                {visibleProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectProduct(product)}
                    className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold ${selectedProduct.id === product.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    {product.name}
                    {selectedProduct.id === product.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </button>
                ))}
                {otherProducts.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowOtherProducts((prev) => !prev)}
                      className="mt-1 flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-black text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                    >
                      <span>다른 제품 더 보기</span>
                      <ChevronDown size={14} className={`transition-transform ${showOtherProducts ? 'rotate-180' : ''}`} />
                    </button>
                    {showOtherProducts && otherProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => openOtherProduct(product)}
                        className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-bold text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                      >
                        {product.name}
                        {activeActionKey === product.id && <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />}
                      </button>
                    ))}
                  </>
                )}
              </SidebarGroup>

              {productActions.length > 0 && (
                <SidebarGroup label="Tasks">
                  {productActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.key}
                        type="button"
                        onClick={() => openWorkspaceAction(action)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold ${activeActionKey === action.key ? 'bg-white/10 text-white' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}`}
                      >
                        <Icon size={17} />
                        {action.label}
                      </button>
                    );
                  })}
                </SidebarGroup>
              )}
              {selectedProductPreparing && (
                <SidebarGroup label="Tasks">
                  <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-relaxed text-zinc-500">
                    {selectedProduct.name}는 서비스 준비중이에요. 목록에는 표시하지만 기능 사용은 검수 후 열어둘게요.
                  </div>
                </SidebarGroup>
              )}

              {selectedProduct.id === CURRENT_PRODUCT.id ? (
                <SidebarGroup label="CUJASA 계정">
                  {accounts.slice(0, 6).map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectAccount?.(index)}
                      className={`rounded-xl px-3 py-2 text-left text-sm ${item.id === account?.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'}`}
                    >
                      <div className="truncate font-semibold">{item.name}</div>
                      <div className="mt-0.5 truncate text-xs text-zinc-600">{item.account_handle || 'Threads 미연결'}</div>
                    </button>
                  ))}
                  {accounts.length === 0 && (
                    <div className="rounded-xl px-3 py-2 text-xs leading-relaxed text-zinc-600">
                      연결된 CUJASA 계정이 없어요. 설정에서 Threads 계정을 먼저 연결해 주세요.
                    </div>
                  )}
                </SidebarGroup>
              ) : (
                <SidebarGroup label={`${selectedProduct.name} 상태`}>
                  <div className="rounded-xl bg-black/20 px-3 py-3">
                    <div className="text-xs font-bold text-zinc-500">남은 무료 사용</div>
                    <div className="mt-1 text-2xl font-black text-zinc-100">{selectedProductUsage.remaining}</div>
                    <div className="mt-1 text-[11px] text-zinc-600">{selectedProductUsage.used} / {selectedProductUsage.limit}회 사용</div>
                  </div>
                </SidebarGroup>
              )}
            </div>

            <div className="border-t border-white/10 pt-4">
              <div className="rounded-2xl bg-black/20 p-3">
                <div className="flex items-center gap-2 text-xs font-black text-zinc-200">
                  <UserCircle size={15} />
                  계정
                </div>
                <div className="mt-1 truncate text-xs text-zinc-500">{currentUser?.email || currentUser?.username}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => openWorkspaceAction('account-settings')} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-300 hover:bg-white/10">계정 설정</button>
                  <button type="button" onClick={() => openWorkspaceAction('billing')} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-300 hover:bg-white/10">결제</button>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-black text-zinc-950"
                >
                  <LogOut size={14} />
                  로그아웃
                </button>
              </div>
              <div className="mt-4 grid gap-1 text-[11px] leading-relaxed text-zinc-600">
                <button type="button" onClick={() => setSupportInfoOpen(true)} className="flex items-center justify-between gap-1 text-left font-bold text-zinc-500 hover:text-zinc-300">
                  <span className="inline-flex items-center gap-1"><Bot size={12} />고객센터</span>
                  <ChevronRight size={12} />
                </button>
                <button type="button" onClick={() => setPrivacyOpen(true)} className="flex items-center gap-1 text-left font-bold text-zinc-500 hover:text-zinc-300">
                  <ShieldCheck size={12} />
                  개인정보처리방침
                </button>
                <button type="button" onClick={() => setBusinessInfoOpen(true)} className="flex items-center justify-between gap-1 text-left font-bold text-zinc-500 hover:text-zinc-300">
                  <span className="inline-flex items-center gap-1"><Landmark size={12} />사업자정보</span>
                  <ChevronRight size={12} />
                </button>
                <div className="pt-1 text-zinc-700">© 2026 JASAIN</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="relative flex min-h-screen min-w-0 flex-col overflow-hidden supports-[height:100dvh]:min-h-dvh">
          <header className="shrink-0 border-b border-white/10 px-4 py-3 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white">
                  <img src="/jasain_logo.png" alt="JASAIN" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-black">JASAIN</div>
                  <div className="truncate text-xs text-zinc-500">워크스페이스</div>
                </div>
              </div>
              <button type="button" onClick={() => openWorkspaceAction('account-settings')} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-400">
                계정
              </button>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${selectedProduct.id === product.id ? 'border-white/30 bg-white text-zinc-950' : 'border-white/10 text-zinc-500'}`}
                >
                  {product.name}
                </button>
              ))}
              {otherProducts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowOtherProducts((prev) => !prev)}
                  className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-500"
                >
                  더 보기
                </button>
              )}
            </div>
            {showOtherProducts && otherProducts.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {otherProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => openOtherProduct(product)}
                    className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-500"
                  >
                    {product.name}
                  </button>
                ))}
              </div>
            )}
            {selectedProduct.id === CURRENT_PRODUCT.id && accounts.length > 0 && (
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {accounts.slice(0, 6).map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectAccount?.(index)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black ${item.id === account?.id ? 'border-white/25 bg-white/10 text-white' : 'border-white/10 text-zinc-500'}`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )}
          </header>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 pb-3 lg:px-10 lg:py-6">
            <div className={`mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col ${messages.length > 0 ? 'justify-end' : 'justify-start pt-10 sm:pt-14 lg:pt-[12vh]'}`}>
              {messages.length === 0 && (
              <div className="text-center">
                <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-400 lg:mb-5">
                  <Bot size={14} />
                  {selectedProduct.name}
                </div>
                <h1 className="text-[32px] font-semibold leading-tight tracking-normal text-zinc-100 sm:text-5xl">무엇을 자동화할까요?</h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-zinc-500 lg:mt-4">
                  필요한 작업을 입력하거나 왼쪽에서 선택해 주세요. 실행과 설정도 오른쪽 작업 패널 안에서 처리해요.
                </p>
                {needsThreadsReconnect && (
                  <button
                    type="button"
                    onClick={() => openWorkspaceAction('settings')}
                    className="mx-auto mt-5 flex max-w-xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left text-sm text-zinc-300 hover:bg-white/10"
                  >
                    <span>
                      <span className="block font-black text-zinc-100">Threads 재연결이 필요해요</span>
                      <span className="mt-1 block text-xs leading-relaxed text-zinc-500">기존 설정과 예약 기록은 유지돼요. 설정 확인에서 Threads만 다시 연결해 주세요.</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-zinc-500" />
                  </button>
                )}
              </div>
              )}

              {messages.length > 0 && (
                <section className="mb-5 min-h-0 flex-1 overflow-y-auto px-1 py-4 text-left">
                  <div className="mx-auto grid w-full max-w-3xl gap-3">
                    {messages.map((message) => (
                      <BetaChatMessage key={message.id} message={message} onOpenAction={openWorkspaceAction} />
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                </section>
              )}

              <form onSubmit={submitPrompt} className={`mx-auto w-full max-w-3xl min-w-0 ${messages.length > 0 ? 'sticky bottom-3 lg:bottom-5' : 'mt-6 lg:mt-7'}`}>
                <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#242424] p-3 shadow-2xl shadow-black/30 lg:rounded-[28px] lg:p-4">
                  <textarea
                    value={prompt}
                    disabled={assistantLoading}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.nativeEvent?.isComposing || event.isComposing)) return;
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        submitPrompt(event);
                      }
                    }}
                    rows={messages.length > 0 ? 2 : 3}
                    placeholder="예: 오늘 자동화 실행해줘, 설정 확인하고 싶어, 포스팅 현황 보여줘"
                    className="min-h-[64px] w-full resize-none bg-transparent px-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-wait disabled:opacity-60 sm:text-base lg:min-h-[90px]"
                  />
                  {assistantLoading && (
                    <div className="px-2 pb-1 text-xs font-bold text-zinc-600">JASAIN Assistant가 확인 중이에요...</div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/5 pt-3 lg:mt-3">
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-500">CUJASA</span>
                      <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-500">{selectedProduct.name}</span>
                    </div>
                    <button type="submit" disabled={assistantLoading} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-950 hover:bg-white disabled:cursor-wait disabled:opacity-60">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              </form>

              <div className="mx-auto mt-3 flex w-full max-w-4xl gap-2 overflow-x-auto pb-2 lg:hidden">
                {productActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.key}
                      type="button"
                      onClick={() => openWorkspaceAction(action)}
                      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-bold text-zinc-300 hover:border-white/20 hover:bg-white/10 hover:text-white"
                    >
                      <Icon size={16} />
                      {action.label}
                    </button>
                  );
                })}
              </div>

            </div>
          </section>

          {activeAction && (
            <TaskDrawer
              action={activeAction}
              account={account}
              currentUser={currentUser}
              queue={queue}
              posts={posts}
              summary={summary}
              analytics={analytics}
              loading={loading}
              loadError={loadError}
              trialStatus={trialStatus}
              reloadTrialStatus={reloadTrialStatus}
              setupStatus={setupStatus}
              reloadSetupStatus={reloadSetupStatus}
              reloadAccounts={reloadAccounts}
              reloadCurrentUser={reloadCurrentUser}
              reloadWorkspaceData={loadWorkspaceData}
              settingsDraft={settingsDraft}
              assistantDraft={assistantDraft}
              pipelineResult={pipelineResult}
              onPipelineDone={onPipelineDone}
              onPipelineRunningChange={onPipelineRunningChange}
              onLogout={onLogout}
              onOpenPrivacy={() => setPrivacyOpen(true)}
              onStartProduct={startProduct}
              onOpenAction={openWorkspaceAction}
              startingProductId={startingProductId}
              closing={drawerClosing}
              onClose={closeDrawer}
            />
          )}
          {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
          {businessInfoOpen && <BusinessInfoModal onClose={() => setBusinessInfoOpen(false)} />}
          {supportInfoOpen && <SupportInfoModal onClose={() => setSupportInfoOpen(false)} />}
        </main>
      </div>
    </div>
  );
}

function SidebarGroup({ label, children }) {
  return (
    <div className="mt-7">
      <div className="px-2 text-xs font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-2 grid gap-1">{children}</div>
    </div>
  );
}

function BetaChatMessage({ message, onOpenAction }) {
  const isUser = message.role === 'user';
  const handleAction = (action) => {
    if (action.actionKey) onOpenAction(action.actionKey);
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[86%] rounded-3xl px-4 py-3 text-sm leading-relaxed ${isUser ? 'bg-white text-zinc-950' : 'bg-black/25 text-zinc-200'}`}>
        {message.content}
        {!isUser && message.actions?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.actions.map((action) => (
              <button
                key={`${message.id}-${action.label}`}
                type="button"
                onClick={() => handleAction(action)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskDrawer(props) {
  const { action, loadError, closing, onClose } = props;
  const Icon = action.icon;
  const compactPreview = ['dexor', 'spread', 'polibot', 'infludex'].includes(action.key);

  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-300 lg:pointer-events-none ${closing ? 'bg-black/0 opacity-0 lg:bg-transparent' : 'bg-black/30 opacity-100 lg:bg-transparent'}`}>
      <button type="button" aria-label="닫기" className="absolute inset-0 lg:hidden" onClick={onClose} />
      <aside className={`pointer-events-auto absolute inset-x-0 bottom-0 overflow-y-auto rounded-t-[28px] border border-white/10 bg-[#191919] p-4 shadow-2xl shadow-black/50 transition-all duration-300 ease-out lg:left-auto lg:right-4 lg:w-[min(640px,calc(100vw-340px))] lg:rounded-[28px] lg:p-5 ${compactPreview ? 'max-h-[72vh] lg:top-16 lg:bottom-auto lg:max-h-[calc(100vh-8rem)]' : 'max-h-[82vh] lg:inset-y-4 lg:max-h-none'} ${closing ? 'translate-y-full opacity-0 lg:translate-x-8 lg:translate-y-0' : 'translate-y-0 opacity-100 lg:translate-x-0'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-zinc-100">
              <Icon size={19} />
            </div>
            <div>
              <div className="text-lg font-black text-zinc-100">{action.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{action.hint}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          {loadError && <Notice tone="error">{loadError}</Notice>}
          {action.key === 'run' && <BetaRunPanel {...props} />}
          {action.key === 'settings' && <BetaSettingsPanel {...props} />}
          {action.key === 'posts' && <BetaPostsPanel {...props} />}
          {action.key === 'home' && <BetaHomePanel {...props} />}
          {action.key === 'account-settings' && <BetaAccountSettingsPanel {...props} />}
          {action.key === 'billing' && <BetaBillingPanel {...props} />}
          {action.key === 'dexor-upload' && <DexorUploadPanel assistantDraft={props.assistantDraft} onOpenGrade={() => props.onOpenAction?.('dexor-grade')} />}
          {action.key === 'dexor-grade' && <DexorGradePanel reloadCurrentUser={props.reloadCurrentUser} onOpenUpload={() => props.onOpenAction?.('dexor-upload')} onOpenBilling={() => props.onOpenAction?.('billing')} />}
          {action.key === 'dexor-download' && <DexorDownloadPanel onOpenUpload={() => props.onOpenAction?.('dexor-upload')} />}
          {action.key === 'spread-campaign' && <SpreadCampaignPanel assistantDraft={props.assistantDraft} reloadCurrentUser={props.reloadCurrentUser} />}
          {action.key === 'spread-applicants' && <SpreadApplicantsPanel reloadCurrentUser={props.reloadCurrentUser} />}
          {action.key === 'spread-review' && <SpreadReviewPanel reloadCurrentUser={props.reloadCurrentUser} />}
          {action.key === 'polibot-upload' && <PolibotUploadPanel />}
          {action.key === 'polibot-recommend' && <PolibotRecommendPanel assistantDraft={props.assistantDraft} reloadCurrentUser={props.reloadCurrentUser} />}
          {action.key === 'polibot-customers' && <PolibotCustomersPanel />}
          {action.key === 'polibot-download' && <PolibotDownloadPanel />}
          {action.key === 'infludex-upload' && <InfludexUploadPanel onOpenGrade={() => props.onOpenAction?.('infludex-grade')} />}
          {action.key === 'infludex-grade' && <InfludexGradePanel reloadCurrentUser={props.reloadCurrentUser} onOpenUpload={() => props.onOpenAction?.('infludex-upload')} />}
          {action.key === 'infludex-download' && <InfludexDownloadPanel onOpenUpload={() => props.onOpenAction?.('infludex-upload')} />}
          {['dexor', 'spread', 'polibot', 'infludex'].includes(action.key) && <ProductPreview action={action} onStartProduct={props.onStartProduct} starting={props.startingProductId === action.key} />}
        </div>
      </aside>
    </div>
  );
}

function BetaRunPanel({
  account,
  trialStatus,
  reloadTrialStatus,
  reloadAccounts,
  reloadWorkspaceData,
  onPipelineDone,
  onPipelineRunningChange
}) {
  const toast = useToast();
  const actionRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [lastCheck, setLastCheck] = useState(null);
  const [runError, setRunError] = useState('');

  const automationRunning = account?.automation_status === 'running';
  const trialBlocked = trialStatus?.plan === 'free' && trialStatus.blocked;

  const runPreflight = async ({ mode = null } = {}) => {
    if (!account?.id) return null;
    setChecking(true);
    setRunError('');
    try {
      const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : '';
      const result = await api.get(`/api/accounts/${account.id}/preflight${suffix}`);
      setLastCheck(result);
      toast(result.canPublish ? '현재 설정 점검을 통과했어요.' : '자동화 전에 조치할 항목이 있어요.', result.canPublish ? 'success' : 'error');
      return result;
    } catch (err) {
      const fallback = err.preflight || {
        canPublish: false,
        checks: [{ status: 'error', title: '점검에 실패했어요', message: err.message || '잠시 후 다시 시도해 주세요.' }]
      };
      setLastCheck(fallback);
      toast('사전 점검에 실패했어요.', 'error');
      return fallback;
    } finally {
      setChecking(false);
    }
  };

  const setAutomation = async (nextStatus) => {
    if (!account?.id || actionRef.current) return;
    if (nextStatus === 'running' && trialBlocked) {
      toast('무료 체험 포스팅 5회를 모두 사용했어요. 결제 후 계속 이용할 수 있어요.', 'error');
      return;
    }
    actionRef.current = true;
    setActioning(true);
    setRunError('');
    try {
      if (nextStatus === 'running') {
        const check = await runPreflight({ mode: 'start' });
        if (!check?.canPublish) return;
        onPipelineRunningChange?.(true, { percent: 0, stage: 'starting', label: '예약 작업을 준비하고 있어요' });
      }

      const result = await api.patch(`/api/accounts/${account.id}/automation`, {
        automationStatus: nextStatus,
        runNow: nextStatus === 'running'
      });

      await reloadAccounts?.();
      await reloadTrialStatus?.();
      await reloadWorkspaceData?.();

      if (nextStatus === 'paused') {
        onPipelineRunningChange?.(false);
        toast('자동화를 중지했어요.', 'success');
        return;
      }

      if (result?.alreadyRunning || result?.status === 'accepted') {
        toast(result.message || '예약 작업을 시작했어요.', 'success');
        onPipelineRunningChange?.(true, result.run?.progress || { percent: 5, stage: 'starting', label: '예약 작업을 시작했어요' });
        return;
      }

      const pipelineResult = result?.pipelineResult || result;
      const queuedCount = pipelineResult?.queuedCount ?? pipelineResult?.steps?.queued ?? null;
      if (pipelineResult?.ok === false || pipelineResult?.status === 'error' || queuedCount === 0) {
        const message = pipelineResult?.message || pipelineResult?.error || '예약 작업을 완료하지 못했어요.';
        setRunError(message);
        toast(message, 'error');
        onPipelineRunningChange?.(false);
        return;
      }

      toast('자동화가 켜졌고 오늘 예약을 만들었어요.', 'success');
      onPipelineDone?.(pipelineResult);
      onPipelineRunningChange?.(false);
    } catch (err) {
      if (err.networkError && nextStatus === 'running') {
        toast(err.message || '요청 연결이 끊겼지만 서버 작업 상태를 확인하고 있어요.', 'info');
        onPipelineRunningChange?.(true, { percent: 5, stage: 'checking', label: '서버 작업 상태를 확인하고 있어요' });
        return;
      }
      if (err.preflight) setLastCheck(err.preflight);
      const message = err.message || '자동화 실행에 실패했어요.';
      setRunError(message);
      toast(message, 'error');
      onPipelineRunningChange?.(false);
    } finally {
      actionRef.current = false;
      setActioning(false);
    }
  };

  return (
    <>
      <PanelCard>
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-white/10 p-3 text-zinc-100">
            {automationRunning ? <RotateCw size={22} /> : <PlayCircle size={22} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-black text-zinc-100">{automationRunning ? '자동화 진행 중' : '자동화 중지됨'}</div>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              {automationRunning ? '서버가 설정값 기준으로 예약과 업로드를 관리해요.' : '자동화를 시작하면 오늘 예약을 만들고 이후 매일 운영해요.'}
            </p>
            <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-400">
              <span className="font-black text-zinc-100">{account?.name || '계정 없음'}</span>
              {account?.account_handle && <span className="ml-2 text-zinc-600">{account.account_handle}</span>}
            </div>
          </div>
        </div>
      </PanelCard>

      <PanelCard title="사전 점검">
        {lastCheck ? <PreflightSummary check={lastCheck} /> : <Notice>글을 올리지 않고 현재 설정과 토큰만 확인해요.</Notice>}
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <DarkButton variant="ghost" onClick={() => runPreflight()} disabled={checking || actioning}>
            {checking ? '점검 중...' : '사전 점검'}
          </DarkButton>
          <DarkButton onClick={() => setAutomation(automationRunning ? 'paused' : 'running')} disabled={checking || actioning}>
            {actioning
              ? '처리 중...'
              : automationRunning
                ? <span className="inline-flex items-center justify-center gap-2"><PauseCircle size={18} /> 자동화 중지</span>
                : trialBlocked ? '결제 후 계속하기' : '자동화 시작'}
          </DarkButton>
        </div>
      </PanelCard>

      {runError && <Notice tone="error">{runError}</Notice>}
    </>
  );
}

function BetaSettingsPanel({ account, trialStatus, reloadAccounts, reloadSetupStatus, reloadWorkspaceData, settingsDraft }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [connectingThreads, setConnectingThreads] = useState(false);
  const [appliedDraftId, setAppliedDraftId] = useState(null);

  useEffect(() => {
    if (!account) {
      setForm(null);
      return;
    }
    setForm({
      name: account.name || '',
      account_handle: account.account_handle || '',
      target_audience: account.target_audience || '',
      content_scope: account.content_scope || '',
      tone: account.tone || '',
      content_mode: account.content_mode || 'empathy',
      content_intensity: account.content_intensity || 'normal',
      seasonality_enabled: account.seasonality_enabled !== false,
      comment_induction_style: account.comment_induction_style || 'soft_question',
      product_mention_style: account.product_mention_style || 'natural',
      emoji_level: account.emoji_level || 'low',
      safe_debate_enabled: Boolean(account.safe_debate_enabled),
      content_style_note: account.content_style_note || '',
      forbidden_topics: Array.isArray(account.forbidden_topics) ? account.forbidden_topics.join('\n') : '',
      forbidden_words: Array.isArray(account.forbidden_words) ? account.forbidden_words.join('\n') : '',
      daily_post_max: clampDailyPostCount(account.daily_post_max, 5),
      first_upload_time: Array.isArray(account.active_time_windows) && account.active_time_windows[0]?.start ? account.active_time_windows[0].start : '09:00',
      coupang_access_key: '',
      coupang_secret_key: '',
      coupang_partner_id: '',
      coupang_tracking_code: ''
    });
  }, [account]);

  useEffect(() => {
    if (!settingsDraft?.id || !settingsDraft.values || appliedDraftId === settingsDraft.id) return;
    setForm((prev) => prev ? ({ ...prev, ...settingsDraft.values }) : prev);
    setAppliedDraftId(settingsDraft.id);
  }, [settingsDraft, appliedDraftId]);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateContentMode = (value) => setForm((prev) => ({
    ...prev,
    content_mode: value,
    safe_debate_enabled: value === 'safe_debate' ? true : prev.safe_debate_enabled
  }));

  const save = async () => {
    if (!account?.id || !form) return;
    if (trialStatus?.plan === 'free' && trialStatus.blocked) {
      toast('무료 체험 포스팅 5회를 모두 사용했어요. 결제 후 계속 이용할 수 있어요.', 'error');
      return;
    }
    if (!form.target_audience.trim() || !form.content_scope.trim()) {
      toast('타깃층과 다룰 카테고리를 입력해 주세요.', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, {
        ...form,
        daily_post_min: 0,
        daily_post_max: clampDailyPostCount(form.daily_post_max, 5),
        active_time_windows: [{ start: form.first_upload_time || '09:00', end: form.first_upload_time || '09:00' }],
        forbidden_topics: form.forbidden_topics.split('\n').map((item) => item.trim()).filter(Boolean),
        forbidden_words: form.forbidden_words.split('\n').map((item) => item.trim()).filter(Boolean)
      });
      await reloadAccounts?.();
      await reloadSetupStatus?.();
      await reloadWorkspaceData?.();
      toast('설정을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '설정을 저장하지 못했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const connectThreads = async () => {
    if (!account?.id) return;
    setConnectingThreads(true);
    try {
      const payload = await api.get(`/api/auth/threads/start?accountId=${account.id}`);
      if (payload?.url) window.location.href = payload.url;
    } catch (err) {
      toast(err.message || 'Threads 연결을 시작하지 못했어요.', 'error');
      setConnectingThreads(false);
    }
  };

  if (!form) return <Notice>계정 설정을 불러오는 중이에요.</Notice>;

  return (
    <>
      {settingsDraft?.id === appliedDraftId && (
        <Notice>
          채팅에서 만든 설정 초안이에요. 타깃, 톤, 카테고리를 확인한 뒤 설정 저장을 눌러야 실제로 반영돼요.
        </Notice>
      )}

      <CollapsiblePanel title="Threads 연결">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
          <div>
            <div className="text-sm font-black text-zinc-100">{account?.has_threads_access_token ? '연결됨' : '미연결'}</div>
            <div className="mt-1 text-xs text-zinc-500">{account?.account_handle || 'Threads 핸들 미입력'}</div>
          </div>
          <DarkButton variant="ghost" size="sm" onClick={connectThreads} disabled={connectingThreads}>
            <Link2 size={15} />
            {connectingThreads ? '이동 중...' : account?.has_threads_access_token ? '다시 연결' : 'Threads 연결'}
          </DarkButton>
        </div>
        {!account?.has_threads_access_token && (
          <Notice>
            Threads 재연결이 필요해요. 기존 설정, 예약 기록, 결제 정보는 유지되고 Threads 연결만 다시 진행하면 돼요.
          </Notice>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel title="운영 설정" defaultOpen={settingsDraft?.id === appliedDraftId}>
        <div className="grid gap-3">
          <label className={labelClass}>계정명<input className={inputClass} value={form.name} onChange={(e) => update('name', e.target.value)} /></label>
          <label className={labelClass}>Threads 핸들<input className={inputClass} value={form.account_handle} onChange={(e) => update('account_handle', e.target.value)} placeholder="@myhandle" /></label>
          <label className={labelClass}>타깃층<textarea className={inputClass} rows="2" value={form.target_audience} onChange={(e) => update('target_audience', e.target.value)} /></label>
          <label className={labelClass}>다룰 카테고리<textarea className={inputClass} rows="2" value={form.content_scope} onChange={(e) => update('content_scope', e.target.value)} /></label>
          <label className={labelClass}>톤<input className={inputClass} value={form.tone} onChange={(e) => update('tone', e.target.value)} /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="쿠팡 API">
        <div className="grid gap-3">
          <label className={labelClass}>Access Key<input className={inputClass} value={form.coupang_access_key} onChange={(e) => update('coupang_access_key', e.target.value)} placeholder={account?.has_coupang_access_key ? '저장됨 - 변경 시에만 입력' : 'Access Key'} /></label>
          <label className={labelClass}>Secret Key<input type="password" className={inputClass} value={form.coupang_secret_key} onChange={(e) => update('coupang_secret_key', e.target.value)} placeholder={account?.has_coupang_secret_key ? '저장됨 - 변경 시에만 입력' : 'Secret Key'} /></label>
          <label className={labelClass}>Partner ID<input className={inputClass} value={form.coupang_partner_id} onChange={(e) => update('coupang_partner_id', e.target.value)} placeholder={account?.has_coupang_partner_id ? '저장됨 - 변경 시에만 입력' : 'Partner ID'} /></label>
          <label className={labelClass}>Tracking Code<input className={inputClass} value={form.coupang_tracking_code} onChange={(e) => update('coupang_tracking_code', e.target.value)} placeholder={account?.has_coupang_tracking_code ? '저장됨 - 변경 시에만 입력' : 'Tracking Code'} /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="콘텐츠 설정">
        <div className="grid gap-4">
          <div className="grid gap-2">
            {contentModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => updateContentMode(option.value)}
                className={`rounded-2xl border px-4 py-3 text-left text-sm ${form.content_mode === option.value ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-black/25 text-zinc-300 hover:bg-white/5'}`}
              >
                <div className="font-black">{option.label}</div>
                <div className="mt-1 text-xs text-zinc-500">{option.description}</div>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DarkSelect label="강도" value={form.content_intensity} onChange={(value) => update('content_intensity', value)} options={contentIntensityOptions} />
            <DarkSelect label="댓글 유도" value={form.comment_induction_style} onChange={(value) => update('comment_induction_style', value)} options={commentStyleOptions} />
            <DarkSelect label="상품 언급" value={form.product_mention_style} onChange={(value) => update('product_mention_style', value)} options={productMentionOptions} />
            <DarkSelect label="이모지" value={form.emoji_level} onChange={(value) => update('emoji_level', value)} options={emojiLevelOptions} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">
            계절감 반영
            <input type="checkbox" checked={form.seasonality_enabled} onChange={(e) => update('seasonality_enabled', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">
            안전 논쟁형 허용
            <input
              type="checkbox"
              checked={form.safe_debate_enabled}
              onChange={(e) => setForm((prev) => ({
                ...prev,
                safe_debate_enabled: e.target.checked,
                content_mode: !e.target.checked && prev.content_mode === 'safe_debate' ? 'question' : prev.content_mode
              }))}
            />
          </label>
          <label className={labelClass}>추가 요청사항<textarea className={inputClass} rows="3" value={form.content_style_note} onChange={(e) => update('content_style_note', e.target.value)} placeholder="예: 너무 광고처럼 쓰지 말기, 자취생 말투 유지" /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="포스팅 스케줄">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>첫 업로드 시각<input type="time" className={inputClass} value={form.first_upload_time} onChange={(e) => update('first_upload_time', e.target.value)} /></label>
          <label className={labelClass}>하루 최대 업로드<input type="number" min="0" max={MAX_DAILY_POSTS} className={inputClass} value={form.daily_post_max} onChange={(e) => update('daily_post_max', e.target.value)} /></label>
        </div>
        <p className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
          하루 여러 개를 예약하면 첫 업로드 시각부터 일정 간격으로 배치돼요.
        </p>
      </CollapsiblePanel>

      <CollapsiblePanel title="금지/제외 규칙">
        <div className="grid gap-3">
          <label className={labelClass}>다루지 말 것<textarea className={inputClass} rows="3" value={form.forbidden_topics} onChange={(e) => update('forbidden_topics', e.target.value)} placeholder={'의약품\n다이어트 보조제\n건강 효능 단정'} /></label>
          <label className={labelClass}>금지어<textarea className={inputClass} rows="3" value={form.forbidden_words} onChange={(e) => update('forbidden_words', e.target.value)} placeholder={'100% 효과\n치료/예방\n체중감량 보장'} /></label>
        </div>
      </CollapsiblePanel>

      <DarkButton onClick={save} disabled={saving}>{saving ? '저장 중...' : '설정 저장'}</DarkButton>
    </>
  );
}

function BetaAccountSettingsPanel({ currentUser, account, accounts, onLogout, onOpenPrivacy }) {
  const grantedProducts = (currentUser?.products || [])
    .filter((grant) => grant.status !== 'suspended')
    .map((grant) => ({
      ...grant,
      product: productById(grant.productId) || { id: grant.productId, name: grant.productId }
    }));

  return (
    <>
      <PanelCard>
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/10 text-zinc-100">
            <UserCircle size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-black uppercase tracking-wide text-zinc-500">JASAIN Account</div>
            <h2 className="mt-1 truncate text-xl font-black text-zinc-100">
              {currentUser?.username || currentUser?.email || '로그인 사용자'}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              제품 운영 설정과 분리된 JASAIN 계정 정보예요.
            </p>
          </div>
        </div>
      </PanelCard>

      <PanelCard title="로그인 정보">
        <div className="grid gap-2">
          <AccountInfoRow label="이메일" value={currentUser?.email || '-'} />
          <AccountInfoRow label="고객명" value={currentUser?.username || '등록된 이름 없음'} />
          <AccountInfoRow label="연락처" value={currentUser?.phone || '계정 API에서 연락처를 불러오도록 연결 예정'} />
          <AccountInfoRow label="선택 계정" value={account?.name || '선택된 CUJASA 계정 없음'} />
          <AccountInfoRow label="등록 계정 수" value={`${accounts?.length || 0}개`} />
        </div>
      </PanelCard>

      <PanelCard title="보유 솔루션">
        {grantedProducts.length > 0 ? (
          <div className="grid gap-2">
            {grantedProducts.map((grant) => (
              <div key={grant.productId} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
                <div>
                  <div className="text-sm font-black text-zinc-100">{grant.product.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">{grant.product.description || grant.productId}</div>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-500">
                  {grant.status || 'active'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Notice>아직 연결된 제품 권한을 불러오지 못했어요.</Notice>
        )}
      </PanelCard>

      <PanelCard title="계정 액션">
        <div className="grid gap-2">
          <DarkButton variant="ghost" onClick={onOpenPrivacy}>
            <ShieldCheck size={16} />
            개인정보처리방침 보기
          </DarkButton>
          <DarkButton variant="ghost" disabled>
            비밀번호 변경 준비 중
          </DarkButton>
          <DarkButton onClick={onLogout}>
            <LogOut size={16} />
            로그아웃
          </DarkButton>
        </div>
      </PanelCard>

      <Notice>
        Threads 핸들, 쿠팡 API, 콘텐츠 톤과 타깃은 CUJASA 제품 설정이에요. 왼쪽 Tasks의 설정 확인에서 관리해요.
      </Notice>
    </>
  );
}

function BetaBillingPanel({ currentUser, reloadCurrentUser }) {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [billing, setBilling] = useState(null);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [busy, setBusy] = useState('');
  const [redirectHandled, setRedirectHandled] = useState(false);

  const productsById = useMemo(() => Object.fromEntries(products.map((product) => [product.id, product])), [products]);
  const latestWaiting = payments.find((payment) => payment.status === 'waiting_for_deposit');
  const activeSubscription = subscriptions.find((subscription) => subscription.status === 'active');
  const dexorProducts = products.filter((product) => (product.app_product_id || product.appProductId) === 'dexor');
  const dexorGrant = (currentUser?.products || []).find((grant) => grant.productId === 'dexor');
  const dexorUsage = getGrantUsage(dexorGrant, 'dexor');

  const load = useCallback(async () => {
    const [{ products: nextProducts }, status] = await Promise.all([
      api.get('/api/billing/products'),
      api.get('/api/billing/status')
    ]);
    setProducts(nextProducts || []);
    setBilling(status.billing);
    setPayments(status.payments || []);
    setSubscriptions(status.subscriptions || []);
  }, []);

  useEffect(() => {
    load().catch(() => toast('결제 정보를 불러오지 못했어요.', 'error'));
  }, [load, toast]);

  useEffect(() => {
    if (redirectHandled) return;
    const params = new URLSearchParams(window.location.search);
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    const authKey = params.get('authKey');
    const customerKey = params.get('customerKey');
    const code = params.get('code');
    const message = params.get('message');
    const isBillingPath = window.location.pathname.startsWith('/billing/');
    if (!isBillingPath && !paymentKey && !authKey && !code) return;

    setRedirectHandled(true);
    const finish = async () => {
      try {
        setBusy('redirect');
        if (code) {
          toast(message || '결제가 완료되지 않았어요.', 'error');
          return;
        }
        if (paymentKey && orderId && amount) {
          await api.post('/api/billing/toss/success', { paymentKey, orderId, amount: Number(amount) });
          toast('결제 요청을 확인했어요.', 'success');
        } else if (authKey) {
          const pending = JSON.parse(localStorage.getItem(pendingSubscriptionKey) || '{}');
          await api.post('/api/billing/billing-auth', {
            productId: 'monthly_59000',
            subscriptionId: pending.subscriptionId,
            authKey,
            customerKey: customerKey || pending.customerKey
          });
          localStorage.removeItem(pendingSubscriptionKey);
          toast('월정액 자동결제를 등록했어요.', 'success');
        }
        await load();
        await reloadCurrentUser?.();
      } catch (err) {
        toast(err.message || '결제 처리에 실패했어요.', 'error');
      } finally {
        setBusy('');
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash || '#tab=beta'}`);
      }
    };
    finish();
  }, [redirectHandled, load, toast]);

  const startOnetime = async () => {
    setBusy('onetime');
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', { productId: 'onetime_590000' });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '결제를 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startMonthly = async () => {
    setBusy('monthly');
    try {
      const payload = await api.post('/api/billing/billing-auth', { productId: 'monthly_59000' });
      localStorage.setItem(pendingSubscriptionKey, JSON.stringify({
        subscriptionId: payload.subscription.id,
        customerKey: payload.toss.customerKey
      }));
      await requestBillingAuth(payload.toss);
    } catch (err) {
      toast(err.message || '자동결제를 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startDexorCredit = async (productId) => {
    setBusy(productId);
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', { productId });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '크레딧 충전을 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PanelCard>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-zinc-500">내 결제 상태</div>
            <h2 className="mt-2 text-xl font-black text-zinc-100">{billingTitle(billing)}</h2>
            <p className="mt-1 text-sm leading-relaxed text-zinc-500">
              {currentUser?.email || currentUser?.username || 'JASAIN 계정'} · Threads 계정 {billing?.maxAccounts ?? currentUser?.maxAccounts ?? 2}개
            </p>
          </div>
          <button type="button" onClick={() => load().catch(() => {})} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-zinc-500 hover:bg-white/10 hover:text-zinc-100" title="새로고침">
            <RefreshCw size={17} />
          </button>
        </div>
        {billing?.status === 'past_due' && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">
            확인 필요 · 자동화 실행이 잠시 중지됐어요. 월결제를 연장하거나 영구구매로 전환해 주세요.
          </div>
        )}
        {billing?.paidUntil && billing?.status !== 'past_due' && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
            이용 가능 기간 {formatBillingDate(billing.paidUntil)}까지
          </div>
        )}
      </PanelCard>

      {latestWaiting && (
        <PanelCard title="입금 대기 중">
          <div className="flex gap-3 text-sm text-zinc-400">
            <Landmark size={18} className="mt-0.5 shrink-0 text-zinc-300" />
            <div className="grid gap-1">
              <span>주문번호 {latestWaiting.orderId}</span>
              <span>{productsById[latestWaiting.productId]?.name || 'CUJASA 베이직'} · {price(latestWaiting.amount)}</span>
              {latestWaiting.virtualAccount && (
                <span>계좌 {latestWaiting.virtualAccount.bankCode || '은행'} {latestWaiting.virtualAccount.accountNumber}</span>
              )}
            </div>
          </div>
        </PanelCard>
      )}

      <div className="grid gap-3">
        <BetaPlanCard
          icon={Landmark}
          title="베이직 영구구매"
          priceText="590,000원"
          caption="가상계좌 결제"
          product={productsById.onetime_590000}
          busy={busy === 'onetime'}
          onClick={startOnetime}
        />
        <BetaPlanCard
          icon={CreditCard}
          title={billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액'}
          priceText="59,000원 / 월"
          caption={activeSubscription ? `활성 · 다음 결제 ${formatBillingDate(activeSubscription.nextBillingAt)}` : '자동결제 준비 중'}
          product={productsById.monthly_59000}
          busy={busy === 'monthly'}
          onClick={startMonthly}
        />
      </div>

      <PanelCard title="DEXOR 크레딧 충전">
        <ProductUsageStrip usage={dexorUsage} />
        <div className="grid gap-2">
          {dexorProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => startDexorCredit(product.id)}
              disabled={busy === product.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>
                <span className="block text-sm font-black text-zinc-100">{product.name}</span>
                <span className="mt-0.5 block text-xs text-zinc-600">가상계좌 입금 확인 후 크레딧이 반영돼요.</span>
              </span>
              <span className="shrink-0 text-sm font-black text-zinc-100">{price(product.amount)}</span>
            </button>
          ))}
          {dexorProducts.length === 0 && <Notice>DEXOR 크레딧 상품이 아직 등록되지 않았어요.</Notice>}
        </div>
      </PanelCard>

      <PanelCard title="최근 결제">
        {payments.length > 0 ? (
          <div className="grid gap-3">
            {payments.slice(0, 5).map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-3 border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
                <div>
                  <div className="text-sm font-bold text-zinc-200">{productsById[payment.productId]?.name || payment.productId}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">{payment.orderId}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-black text-zinc-100">{price(payment.amount)}</div>
                  <BetaPaymentStatus status={payment.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Notice>아직 결제 내역이 없어요.</Notice>
        )}
      </PanelCard>
    </>
  );
}

function AccountInfoRow({ label, value }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-black/25 px-4 py-3">
      <div className="text-[11px] font-black uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="break-words text-sm font-bold text-zinc-200">{value}</div>
    </div>
  );
}

function BetaPlanCard({ icon: Icon, title, priceText, caption, product, busy, onClick }) {
  return (
    <PanelCard>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-zinc-100">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-black text-zinc-100">{title}</h3>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-bold text-zinc-500">
              <ShieldCheck size={12} />
              계정 {product?.max_accounts ?? 2}개
            </span>
          </div>
          <div className="mt-1 text-2xl font-black text-zinc-100">{priceText}</div>
          <div className="mt-1 text-sm text-zinc-500">{caption}</div>
        </div>
      </div>
      <DarkButton onClick={onClick} disabled={busy || !product} className="mt-4 w-full">
        {busy ? '진행 중...' : '결제하기'}
      </DarkButton>
    </PanelCard>
  );
}

function BetaPaymentStatus({ status }) {
  const label = {
    created: '생성',
    waiting_for_deposit: '입금 대기',
    paid: '완료',
    failed: '실패',
    canceled: '취소'
  }[status] || status;
  return (
    <div className="mt-0.5 flex items-center justify-end gap-1 text-xs font-bold text-zinc-500">
      {status === 'paid' && <CheckCircle2 size={13} />}
      {label}
    </div>
  );
}

function BetaPostsPanel({ account, currentUser, queue, posts, loading, reloadWorkspaceData, pipelineResult }) {
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState({});
  const [loadingDetailId, setLoadingDetailId] = useState('');
  const [dismissingId, setDismissingId] = useState('');

  const scheduled = queue.filter((row) => row.status === 'scheduled').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const posted = queue.filter((row) => row.status === 'posted').sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
  const needsAttention = queue.filter((row) => ['failed', 'retry', 'manual_required'].includes(row.status)).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

  const toggleDetail = async (queueId) => {
    if (expandedId === queueId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(queueId);
    if (detail[queueId]) return;
    setLoadingDetailId(queueId);
    try {
      const payload = await api.get(`/api/queue/detail/${queueId}`);
      setDetail((prev) => ({ ...prev, [queueId]: payload }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingDetailId('');
    }
  };

  const dismissQueue = async (queueId) => {
    if (dismissingId) return;
    setDismissingId(queueId);
    try {
      await api.post(`/api/queue/${queueId}/dismiss`, { reason: 'customer_confirmed' });
      await reloadWorkspaceData?.();
      setExpandedId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDismissingId('');
    }
  };

  if (loading) return <Notice>포스팅 현황을 불러오는 중이에요.</Notice>;

  return (
    <>
      {pipelineResult && <PipelineResultCard pipelineResult={pipelineResult} account={account} currentUser={currentUser} />}
      <QueueSection title={`확인 필요 (${needsAttention.length})`} rows={needsAttention} posts={posts} expandedId={expandedId} detail={detail} loadingDetailId={loadingDetailId} dismissingId={dismissingId} onToggle={toggleDetail} onDismiss={dismissQueue} />
      <QueueSection title={`예약됨 (${scheduled.length})`} rows={scheduled} posts={posts} expandedId={expandedId} detail={detail} loadingDetailId={loadingDetailId} onToggle={toggleDetail} />
      <QueueSection title={`완료 (${posted.length})`} rows={posted} posts={posts} expandedId={expandedId} detail={detail} loadingDetailId={loadingDetailId} onToggle={toggleDetail} />
      {queue.length === 0 && <Notice>아직 예약 또는 업로드 기록이 없어요.</Notice>}
    </>
  );
}

function BetaHomePanel({ queue, analytics, loading, summary }) {
  const upcomingScheduled = queue
    .filter((row) => row.status === 'scheduled' && new Date(row.scheduled_at) >= new Date())
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 5);
  const recentPosted = queue
    .filter((row) => row.status === 'posted' && row.posted_at)
    .sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))
    .slice(0, 5);

  return (
    <>
      <MetricGrid summary={summary} loading={loading} />
      <PanelCard title="다가오는 예약">
        <SimpleQueueRows rows={upcomingScheduled} emptyText="다가오는 예약이 없어요." />
      </PanelCard>
      <PanelCard title="최근 포스팅">
        <SimpleQueueRows rows={recentPosted} emptyText="최근 포스팅이 없어요." />
      </PanelCard>
      <Notice>총 클릭 {analytics?.totalClicks ?? 0}회 기준으로 표시해요.</Notice>
    </>
  );
}

function DexorUploadPanel({ assistantDraft, onOpenGrade }) {
  const toast = useToast();
  const [urls, setUrls] = useState('');
  const [fileName, setFileName] = useState('');
  const [targetCategory, setTargetCategory] = useState('맛집');
  const [saving, setSaving] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const urlCount = urls.split(/\s+/).map((item) => item.trim()).filter(Boolean).length;
  const usage = workspaceUsage(workspace);

  const loadCandidateFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    if (!/\.csv$|\.txt$/i.test(file.name)) {
      toast('CSV 파일은 URL과 품질 컬럼을 읽고, 엑셀 파일은 우선 파일명만 저장해요.', 'info');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '').trim();
      if (text) setUrls((prev) => [prev.trim(), text].filter(Boolean).join('\n'));
    };
    reader.onerror = () => toast('파일을 읽지 못했어요.', 'error');
    reader.readAsText(file);
  };

  useEffect(() => {
    api.get('/api/product-workspace/dexor')
      .then((data) => {
        setWorkspace(data || {});
        if (Array.isArray(data?.candidates)) setUrls(data.candidates.map((item) => item.url).join('\n'));
        if (data?.fileName) setFileName(data.fileName);
        if (data?.targetCategory) setTargetCategory(data.targetCategory);
      })
      .catch((err) => toast(err.message || 'DEXOR 후보를 불러오지 못했어요.', 'error'));
  }, [toast]);

  useEffect(() => {
    if (assistantDraft?.actionKey !== 'dexor-upload' || !assistantDraft.values) return;
    if (assistantDraft.values.targetCategory) setTargetCategory(assistantDraft.values.targetCategory);
    if (assistantDraft.values.urls) setUrls(String(assistantDraft.values.urls));
  }, [assistantDraft]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/dexor/candidates', { urls, fileName, targetCategory });
      setWorkspace(next);
      setConfirmOpen(true);
    } catch (err) {
      toast(err.message || '후보 저장에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/dexor/reset', {});
      setWorkspace(next);
      setUrls('');
      setFileName('');
      setTargetCategory('맛집');
      setConfirmOpen(false);
      toast('새 후보를 올릴 준비가 됐어요.', 'success');
    } catch (err) {
      toast(err.message || '초기화에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="후보 입력">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <label className={labelClass}>
            기본 카테고리
            <select
              className={inputClass}
              value={dexorCategoryOptions.includes(targetCategory) ? targetCategory : '기타'}
              onChange={(event) => setTargetCategory(event.target.value)}
            >
              {dexorCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            분석 카테고리
            <input
              className={inputClass}
              value={targetCategory}
              onChange={(event) => setTargetCategory(event.target.value)}
              placeholder="예: 맛집, 뷰티, 육아"
            />
          </label>
        </div>
        <label className={labelClass}>
          블로그 URL
          <textarea
            className={inputClass}
            rows="7"
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            placeholder={'https://blog.naver.com/example1\nhttps://blog.naver.com/example2'}
          />
        </label>
        <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-500">
          현재 입력 후보 {urlCount}개 · {targetCategory || '선택한'} 카테고리 기준으로 S/A/B/C/D 랭크를 분석해요.
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <DarkButton onClick={save} disabled={saving || (urlCount === 0 && !fileName)}>
          {saving ? '저장 중...' : '후보 저장'}
        </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={saving || (!workspace?.candidates?.length && !workspace?.analysisResults?.length && !fileName)}>
            새로 올리기
          </DarkButton>
        </div>
      </PanelCard>
      <PanelCard title="파일 업로드">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/25 px-4 py-5 text-sm font-bold text-zinc-300 hover:bg-white/5">
          <span className="inline-flex items-center gap-2">
            <Upload size={17} />
            {fileName || '엑셀 또는 CSV 후보 파일 선택'}
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(event) => loadCandidateFile(event.target.files?.[0])}
          />
        </label>
        <p className="mt-3 text-xs leading-relaxed text-zinc-600">
          CSV는 URL, 블로그명, 후보 카테고리, 최근글일, 방문/조회, 댓글/공감, 광고성 메모 컬럼을 읽어 분석에 반영해요. 엑셀 파일은 이번 단계에서 파일명만 저장해요.
        </p>
      </PanelCard>
      {workspace?.candidates?.length > 0 && (
        <PanelCard title="저장된 후보">
          <SimpleInfoList items={workspace.candidates.slice(0, 8).map((item) => `${item.url}${item.candidateCategory ? ` · ${item.candidateCategory}` : ''}`)} />
        </PanelCard>
      )}
      {confirmOpen && (
        <DarkConfirmModal
          title="후보를 저장했어요"
          description="이제 저장한 후보를 기준으로 등급 분석을 볼 수 있어요."
          primaryLabel="등급 분석 열기"
          secondaryLabel="계속 업로드"
          onPrimary={() => {
            setConfirmOpen(false);
            onOpenGrade?.();
          }}
          onSecondary={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}

function DexorGradePanel({ reloadCurrentUser, onOpenUpload, onOpenBilling }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const [scoreHelpOpen, setScoreHelpOpen] = useState(false);
  const results = sortDexorResults(Array.isArray(workspace.analysisResults) ? workspace.analysisResults : []);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const usage = workspaceUsage(workspace);
  const gradeRows = dexorScoreRows.map(([grade, range, description]) => [
    grade,
    results.filter((item) => (item.scoreLabel || item.grade) === grade).length,
    `${range} · ${description}`
  ]);

  const load = useCallback(() => {
    api.get('/api/product-workspace/dexor')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || 'DEXOR 분석 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const next = await api.post('/api/product-workspace/dexor/analyze');
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('등급 분석을 완료했어요.', 'success');
    } catch (err) {
      toast(err.message || '등급 분석에 실패했어요.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = async () => {
    setAnalyzing(true);
    try {
      const next = await api.post('/api/product-workspace/dexor/reset', {});
      setWorkspace(next);
      onOpenUpload?.();
      toast('새 후보를 올릴 준비가 됐어요.', 'success');
    } catch (err) {
      toast(err.message || '초기화에 실패했어요.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <>
      <PanelCard
        title={(
          <span className="inline-flex items-center gap-2">
            등급 요약
            <button
              type="button"
              onClick={() => setScoreHelpOpen((prev) => !prev)}
              className="grid h-5 w-5 place-items-center rounded-full border border-white/15 text-[11px] font-black text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              aria-label="등급 기준 보기"
            >
              ?
            </button>
          </span>
        )}
      >
        <ProductUsageStrip usage={usage} />
        {scoreHelpOpen && (
          <div className="mb-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
            <div className="grid gap-1">
              {dexorScoreRows.map(([label, range, description]) => (
                <div key={label} className="flex items-center justify-between gap-3">
                  <span className="font-bold text-zinc-300">{label}</span>
                  <span className="text-right">{range} · {description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {gradeRows.map(([grade, count, label]) => (
            <div key={grade} className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-base font-black text-zinc-100">{grade}</div>
              <div className="mt-2 text-lg font-black text-zinc-300">{count}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={analyze} disabled={analyzing || candidates.length === 0 || usage.remaining <= 0}>
            {analyzing ? '분석 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : `후보 ${candidates.length}개 분석`}
          </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={analyzing || (candidates.length === 0 && results.length === 0)}>
            새로 올리기
          </DarkButton>
        </div>
        {usage.remaining <= 0 && (
          <div className="mt-3 grid gap-2">
            <Notice>무료 분석 횟수를 모두 사용했어요. 크레딧을 충전하면 바로 다시 분석할 수 있어요.</Notice>
            <DarkButton variant="ghost" onClick={onOpenBilling}>크레딧 충전</DarkButton>
          </div>
        )}
      </PanelCard>
      <PanelCard title="분석 결과">
        {results.length === 0 ? (
          <Notice>후보 업로드 후 분석을 실행하면 이곳에 결과가 표시돼요.</Notice>
        ) : (
          <div className="grid gap-2">
          {results.slice(0, 10).map((item) => {
            const displayRank = ({ '씨랭크/다이아': 'S', '최적화': 'A', '준최적화': 'B', '일반': 'C', '제외/재검토': 'D' })[item.scoreLabel || item.grade] || item.scoreLabel || item.grade;
            return (
              <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-zinc-200">{item.blogName || item.url}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-600">{item.url}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="rounded-full border border-white/10 px-2.5 py-1 text-xs font-black text-zinc-100">{displayRank}</div>
                    <div className="mt-1 text-xs font-black text-zinc-500">{item.score}점</div>
                  </div>
                </div>
                <div className="mt-2 text-xs font-bold text-zinc-300">{item.scoreComment || dexorScoreComment(item.score)}</div>
              </div>
            );
          })}
          </div>
        )}
      </PanelCard>
    </>
  );
}

function DexorDownloadPanel({ onOpenUpload }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [resetting, setResetting] = useState(false);
  const results = sortDexorResults(Array.isArray(workspace.analysisResults) ? workspace.analysisResults : []);
  const usage = workspaceUsage(workspace);

  useEffect(() => {
    api.get('/api/product-workspace/dexor')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '다운로드 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const downloadCsv = () => {
    const header = ['url', 'blogName', 'targetCategory', 'candidateCategory', 'rank', 'score', 'comment', 'summary'];
    const rows = results.map((item) => [
      item.url || '미입력',
      item.blogName || '미입력',
      item.targetCategory || workspace.targetCategory || '미입력',
      item.candidateCategory || '미입력',
      item.scoreLabel || item.grade || '미입력',
      item.score ?? '미입력',
      item.scoreComment || dexorScoreComment(item.score),
      item.reasonSummary || item.reasons?.slice(0, 2).join(' | ') || '기본 지표 기준'
    ].map(csvEscape).join(','));
    const csv = `\uFEFF${[header.join(','), ...rows].join('\r\n')}`;
    downloadTextFile('dexor-candidates.csv', csv, 'text/csv;charset=utf-8');
  };

  const reset = async () => {
    setResetting(true);
    try {
      const next = await api.post('/api/product-workspace/dexor/reset', {});
      setWorkspace(next);
      onOpenUpload?.();
      toast('새 후보를 올릴 준비가 됐어요.', 'success');
    } catch (err) {
      toast(err.message || '초기화에 실패했어요.', 'error');
    } finally {
      setResetting(false);
    }
  };

  return (
    <>
      <PanelCard title="내보내기">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-2">
          <DarkButton onClick={downloadCsv} disabled={results.length === 0}>
            <Download size={16} />
            CSV 다운로드
          </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={resetting || results.length === 0}>
            새로 올리기
          </DarkButton>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-600">
          분석 결과 {results.length}개를 CSV로 내려받아요.
        </p>
      </PanelCard>
      <PanelCard title="포함 항목">
        <SimpleInfoList items={['블로그 URL', '블로그명', '목표/후보 카테고리', 'S/A/B/C/D 랭크', '점수와 점수 해석', '주요 판단 이유']} />
      </PanelCard>
    </>
  );
}

function SpreadCampaignPanel({ assistantDraft, reloadCurrentUser }) {
  const toast = useToast();
  const [draft, setDraft] = useState({ goal: '', channel: '', product: '' });
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);
  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => {
        setWorkspace(data || {});
        if (data?.campaignDraft) {
          setDraft({
            goal: data.campaignDraft.goal || '',
            channel: data.campaignDraft.channel || '',
            product: data.campaignDraft.product || ''
          });
        }
      })
      .catch((err) => toast(err.message || 'SPREAD 캠페인 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  useEffect(() => {
    if (assistantDraft?.actionKey !== 'spread-campaign' || !assistantDraft.values) return;
    setDraft((prev) => ({
      goal: assistantDraft.values.goal || prev.goal,
      channel: assistantDraft.values.channel || prev.channel,
      product: assistantDraft.values.product || prev.product
    }));
  }, [assistantDraft]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/spread/campaign', draft);
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('캠페인 초안을 만들었어요.', 'success');
    } catch (err) {
      toast(err.message || '캠페인 초안 생성에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="캠페인 추천 초안">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>목표<input className={inputClass} value={draft.goal} onChange={(event) => update('goal', event.target.value)} placeholder="예: 신제품 체험단 모집" /></label>
          <label className={labelClass}>채널<input className={inputClass} value={draft.channel} onChange={(event) => update('channel', event.target.value)} placeholder="예: 블로그, Threads, 인스타그램" /></label>
          <label className={labelClass}>상품 유형<input className={inputClass} value={draft.product} onChange={(event) => update('product', event.target.value)} placeholder="예: 주방용품, 뷰티, 생활가전" /></label>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0}>{saving ? '생성 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}</DarkButton>
          {usage.remaining <= 0 && <Notice>무료 사용 횟수를 모두 사용했어요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
        </div>
      </PanelCard>
      {workspace.campaignDraft && (
        <PanelCard title="추천 결과">
          <div className="text-lg font-black text-zinc-100">{workspace.campaignDraft.headline}</div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-500">{workspace.campaignDraft.mission}</p>
          <div className="mt-3 grid gap-2">
            {workspace.campaignDraft.checklist?.map((item) => (
              <div key={item} className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">{item}</div>
            ))}
          </div>
        </PanelCard>
      )}
    </>
  );
}

function SpreadApplicantsPanel({ reloadCurrentUser }) {
  const toast = useToast();
  const [form, setForm] = useState({ applicants: '', criteria: '' });
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '참여자 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/spread/applicants', form);
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('참여자 선정 초안을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '참여자 선정에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows = Array.isArray(workspace.applicants) ? workspace.applicants : [];

  return (
    <>
      <PanelCard title="참여자 입력">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>신청자 목록<textarea className={inputClass} rows="4" value={form.applicants} onChange={(event) => setForm((prev) => ({ ...prev, applicants: event.target.value }))} placeholder={'신청자 A\n신청자 B\n신청자 C'} /></label>
          <label className={labelClass}>선정 기준<textarea className={inputClass} rows="3" value={form.criteria} onChange={(event) => setForm((prev) => ({ ...prev, criteria: event.target.value }))} placeholder={'최근 활동성\n카테고리 적합도\n제출 가능 일정'} /></label>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0}>{saving ? '정리 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '참여자 선정 정리'}</DarkButton>
          {usage.remaining <= 0 && <Notice>무료 사용 횟수를 모두 사용했어요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
        </div>
      </PanelCard>
      <PanelCard title="참여자 선정">
        <div className="grid gap-2">
          {rows.length === 0 && <Notice>신청자 목록을 입력하면 선정 초안이 표시돼요.</Notice>}
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
              <div>
                <div className="text-sm font-black text-zinc-200">{row.name}</div>
                <div className="mt-0.5 text-xs text-zinc-600">{row.reason}</div>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-500">{row.status} · {row.score}</span>
            </div>
          ))}
        </div>
      </PanelCard>
    </>
  );
}

function SpreadReviewPanel({ reloadCurrentUser }) {
  const toast = useToast();
  const [form, setForm] = useState({ url: '', required: '', forbidden: '' });
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '검수 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/spread/review', form);
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('제출물 검수 초안을 만들었어요.', 'success');
    } catch (err) {
      toast(err.message || '제출물 검수에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const review = workspace.submissionReview;

  return (
    <>
      <PanelCard title="제출물 입력">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>제출 URL<input className={inputClass} value={form.url} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} placeholder="https://..." /></label>
          <label className={labelClass}>필수 키워드<textarea className={inputClass} rows="3" value={form.required} onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.value }))} placeholder={'브랜드명\n제품명\n필수 해시태그'} /></label>
          <label className={labelClass}>금지 표현<textarea className={inputClass} rows="3" value={form.forbidden} onChange={(event) => setForm((prev) => ({ ...prev, forbidden: event.target.value }))} placeholder={'100% 보장\n치료\n과장 표현'} /></label>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0}>{saving ? '검수 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '제출물 검수'}</DarkButton>
          {usage.remaining <= 0 && <Notice>무료 사용 횟수를 모두 사용했어요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
        </div>
      </PanelCard>
      <PanelCard title="제출물 검수">
        {!review ? (
          <Notice>제출 URL과 기준을 입력하면 검수 초안이 표시돼요.</Notice>
        ) : (
          <div className="grid gap-2">
            {review.checks?.map((check) => (
              <div key={`${check.label}-${check.detail}`} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
                <div>
                  <div className="text-sm font-black text-zinc-200">{check.label}</div>
                  <div className="mt-0.5 text-xs text-zinc-600">{check.detail}</div>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-500">{check.passed ? '통과' : '확인'}</span>
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </>
  );
}

function PolibotUploadPanel() {
  const toast = useToast();
  const [form, setForm] = useState({ month: '', note: '' });
  const [files, setFiles] = useState([]);
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);

  useEffect(() => {
    api.get('/api/product-workspace/polibot')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || 'POLIBOT 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const loadKnowledgeFiles = async (fileList) => {
    const selected = Array.from(fileList || []).slice(0, 40);
    const loaded = await Promise.all(selected.map((file) => new Promise((resolve) => {
      const base = { name: file.name, size: file.size, type: file.type };
      if (/\.(jpg|jpeg|png|webp)$/i.test(file.name) || file.size > 12 * 1024 * 1024) {
        resolve(base);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (/\.(csv|txt)$/i.test(file.name)) {
          resolve({ ...base, text: String(reader.result || '').slice(0, 12000) });
          return;
        }
        const result = String(reader.result || '');
        resolve({ ...base, base64: result.includes(',') ? result.split(',').pop() : result });
      };
      reader.onerror = () => resolve(base);
      if (/\.(csv|txt)$/i.test(file.name)) reader.readAsText(file);
      else reader.readAsDataURL(file);
    })));
    setFiles(loaded);
  };

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/polibot/knowledge', { ...form, files });
      setWorkspace(next);
      toast('월별 보험 자료를 지식베이스에 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '저장에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="월별 보험 자료">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>자료 월<input className={inputClass} value={form.month} onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))} placeholder="예: 2026-05" /></label>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/25 px-4 py-5 text-sm font-bold text-zinc-300 hover:bg-white/5">
            <span className="inline-flex items-center gap-2">
              <Upload size={17} />
              {files.length ? `${files.length}개 자료 선택됨` : 'PDF/PPTX/CSV/JPEG 자료 선택'}
            </span>
            <input
              type="file"
              multiple
              accept=".pdf,.ppt,.pptx,.csv,.txt,.jpg,.jpeg,.png"
              className="hidden"
              onChange={(event) => loadKnowledgeFiles(event.target.files)}
            />
          </label>
          <label className={labelClass}>메모<textarea className={inputClass} rows="4" value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="상품군, 보험사, 보장 특이사항을 적어주세요." /></label>
          <DarkButton onClick={save} disabled={saving || (files.length === 0 && !form.note.trim())}>{saving ? '저장 중...' : '월별 자료 저장'}</DarkButton>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-600">
          PDF/PPTX/CSV/TXT는 텍스트를 추출해 월별 지식베이스로 저장해요. 12MB가 넘는 파일과 이미지는 이번 단계에서 파일명과 메모만 저장해요.
        </p>
      </PanelCard>
      {workspace.knowledgeSources?.length > 0 && (
        <PanelCard title="월별 자료 목록">
          <SimpleInfoList items={workspace.knowledgeSources.slice(0, 10).map((item) => `${item.month} · ${item.fileName} · ${(item.companies || [item.company]).filter(Boolean).slice(0, 3).join(', ') || '미분류'} · ${item.productGroup || '종합 보장'}`)} />
        </PanelCard>
      )}
    </>
  );
}

function PolibotRecommendPanel({ assistantDraft, reloadCurrentUser }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', age: '', gender: '', needs: '', budget: '', company: '전체 보험사' });
  const [workspace, setWorkspace] = useState({});
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  const [saveMemo, setSaveMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);
  const companies = ['전체 보험사', ...(workspace.catalog?.companies || [])];

  useEffect(() => {
    api.get('/api/product-workspace/polibot')
      .then((data) => {
        setWorkspace(data || {});
        const firstCompany = data?.catalog?.companies?.[0];
        setForm((prev) => ({ ...prev, company: prev.company || firstCompany || '전체 보험사' }));
      })
      .catch((err) => toast(err.message || '추천 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  useEffect(() => {
    if (assistantDraft?.actionKey !== 'polibot-recommend' || !assistantDraft.values) return;
    const values = assistantDraft.values;
    setForm((prev) => ({
      ...prev,
      name: values.name ?? prev.name,
      age: values.age ?? prev.age,
      gender: values.gender ?? prev.gender,
      needs: Array.isArray(values.needs) ? values.needs.join('\n') : values.needs ?? prev.needs,
      budget: values.budget ?? prev.budget,
      company: values.company || prev.company || '전체 보험사'
    }));
  }, [assistantDraft]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/polibot/recommend', form);
      setWorkspace(next);
      await reloadCurrentUser?.();
      setSelectedRecommendation(null);
      toast('추천 초안을 만들었어요.', 'success');
    } catch (err) {
      toast(err.message || '추천 생성에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveCustomer = async (recommendation) => {
    try {
      const next = await api.post('/api/product-workspace/polibot/customers', {
        profile: workspace.customerProfile || form,
        recommendationId: recommendation.id,
        selectedRecommendation: recommendation,
        memo: saveMemo
      });
      setWorkspace(next);
      toast('고객목록에 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '고객 저장에 실패했어요.', 'error');
    }
  };

  return (
    <>
      <PanelCard title="고객 조건">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>고객명<input className={inputClass} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="이효진" /></label>
            <label className={labelClass}>나이<input className={inputClass} value={form.age} onChange={(event) => setForm((prev) => ({ ...prev, age: event.target.value }))} placeholder="45" /></label>
            <label className={labelClass}>성별<input className={inputClass} value={form.gender} onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))} placeholder="남성/여성" /></label>
          </div>
          <label className={labelClass}>필요 보장<textarea className={inputClass} rows="3" value={form.needs} onChange={(event) => setForm((prev) => ({ ...prev, needs: event.target.value }))} placeholder={'암\n입원\n수술'} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>예산<input className={inputClass} value={form.budget} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} placeholder="10" /></label>
            <DarkSelect
              label="보험사"
              value={form.company}
              onChange={(value) => setForm((prev) => ({ ...prev, company: value }))}
              options={companies.map((company) => ({ value: company, label: company }))}
            />
          </div>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0}>{saving ? '추천 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}</DarkButton>
        </div>
      </PanelCard>
      <PanelCard title="추천 결과">
        {workspace.recommendations?.length ? (
          <div className="grid gap-2">
            {workspace.recommendations.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedRecommendation(item)} className="rounded-2xl bg-black/25 px-4 py-3 text-left hover:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">추천 조합</div>
                    <div className="text-sm font-black text-zinc-200">{item.name}</div>
                    <div className="mt-1 text-[11px] font-bold text-zinc-600">{item.type === 'bundle' ? '조합 추천' : '단품 추천'}</div>
                  </div>
                  <span className="text-sm font-black text-zinc-100">{item.score}</span>
                </div>
                {item.coverageGap && <div className="mt-2 text-xs leading-relaxed text-zinc-500">{item.coverageGap}</div>}
              </button>
            ))}
            <label className={`${labelClass} mt-2`}>저장 메모<textarea className={inputClass} rows="3" value={saveMemo} onChange={(event) => setSaveMemo(event.target.value)} placeholder="상담 중 남길 메모를 적어두세요." /></label>
          </div>
        ) : <Notice>{workspace.recommendationNotice || '고객 조건을 입력하면 추천 초안이 표시돼요.'}</Notice>}
      </PanelCard>
      {selectedRecommendation && (
        <PolibotRecommendationModal
          recommendation={selectedRecommendation}
          profile={workspace.customerProfile}
          onClose={() => setSelectedRecommendation(null)}
          onSave={() => saveCustomer(selectedRecommendation)}
        />
      )}
    </>
  );
}

function PolibotRecommendationModal({ recommendation, profile, onClose, onSave }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/60">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black text-zinc-100">{recommendation.name}</div>
            <div className="mt-1 text-xs font-bold text-zinc-600">{recommendation.type === 'bundle' ? '조합 추천' : '단품 추천'} · 점수 {recommendation.score}</div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100"><X size={18} /></button>
        </div>
        <div className="mt-5 grid gap-3">
          <Notice>{recommendation.headline || recommendation.reason}</Notice>
          <div className="grid gap-2 rounded-2xl bg-black/25 p-4 text-sm text-zinc-400">
            <AccountInfoRow label="추천 조합" value={recommendation.name || '-'} />
            <AccountInfoRow label="고객 조건" value={[profile?.name, profile?.age ? `${profile.age}세` : '', profile?.gender].filter(Boolean).join(' · ') || '미입력'} />
            <AccountInfoRow label="필요 보장" value={(profile?.needs || []).join(', ') || '미입력'} />
            <AccountInfoRow label="보완 포인트" value={recommendation.coverageGap || '-'} />
            <AccountInfoRow label="보험료 메모" value={recommendation.premium || '-'} />
            <AccountInfoRow label="주의 조건" value={(recommendation.cautions || []).join(', ') || '추가 확인 필요'} />
          </div>
          <div className="grid gap-2">
            <div className="text-xs font-black text-zinc-500">근거 자료</div>
            {(recommendation.evidence || []).map((source) => (
              <div key={`${source.month}-${source.fileName}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm">
                <div className="font-black text-zinc-200">{source.month} · {source.fileName}</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {(source.companies || [source.company]).filter(Boolean).join(', ') || '보험사 미분류'} · {source.productGroup || '상품군 미분류'} · {(source.keywords || []).slice(0, 6).join(', ') || '키워드 없음'}
                </div>
                {source.summary && <div className="mt-2 text-xs leading-relaxed text-zinc-600">{source.summary}</div>}
              </div>
            ))}
          </div>
          <DarkButton onClick={onSave}>고객목록에 저장</DarkButton>
        </div>
      </div>
    </div>
  );
}

function PolibotCustomersPanel() {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', age: '', memo: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/api/product-workspace/polibot')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '고객 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const openCustomer = (customer) => {
    setSelectedCustomer(customer);
    setEditing(false);
    setEditForm({ name: customer.name || '', age: customer.age || '', memo: customer.memo || '' });
  };

  const saveEdit = async () => {
    if (!selectedCustomer) return;
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/polibot/customers', {
        ...selectedCustomer,
        ...editForm,
        id: selectedCustomer.id
      });
      setWorkspace(next);
      const updated = next.customers?.find((item) => item.id === selectedCustomer.id);
      setSelectedCustomer(updated || null);
      setEditing(false);
      toast('고객 정보를 수정했어요.', 'success');
    } catch (err) {
      toast(err.message || '고객 수정에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="고객 목록">
        {workspace.customers?.length ? (
          <div className="grid gap-2">
            {workspace.customers.map((item) => (
              <button key={item.id} type="button" onClick={() => openCustomer(item)} className="rounded-2xl bg-black/25 px-4 py-3 text-left hover:bg-white/5">
                <div className="text-sm font-black text-zinc-200">{item.name}{item.age ? ` · ${item.age}세` : ''}</div>
                <div className="mt-1 text-xs text-zinc-500">{item.selectedRecommendation?.name || item.memo || '추천 저장 고객'}</div>
              </button>
            ))}
          </div>
        ) : <Notice>추천 결과에서 고객목록에 저장하면 여기에 보여요.</Notice>}
      </PanelCard>
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-black text-zinc-100">{selectedCustomer.name}</div>
                <div className="mt-1 text-xs font-bold text-zinc-600">{selectedCustomer.age || '-'}세 · {selectedCustomer.gender || '성별 미입력'}</div>
              </div>
              <button type="button" onClick={() => setSelectedCustomer(null)} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100"><X size={18} /></button>
            </div>
            {editing ? (
              <div className="mt-5 grid gap-3">
                <label className={labelClass}>고객명<input className={inputClass} value={editForm.name} onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))} /></label>
                <label className={labelClass}>나이<input className={inputClass} value={editForm.age} onChange={(event) => setEditForm((prev) => ({ ...prev, age: event.target.value }))} /></label>
                <label className={labelClass}>메모<textarea className={inputClass} rows="4" value={editForm.memo} onChange={(event) => setEditForm((prev) => ({ ...prev, memo: event.target.value }))} /></label>
                <DarkButton onClick={saveEdit} disabled={saving}>{saving ? '저장 중...' : '수정 저장'}</DarkButton>
              </div>
            ) : (
              <div className="mt-5 grid gap-3 text-sm text-zinc-400">
                <AccountInfoRow label="필요 보장" value={(selectedCustomer.needs || []).join(', ') || '미입력'} />
                <AccountInfoRow label="추천 결과" value={selectedCustomer.selectedRecommendation?.name || '미선택'} />
                <AccountInfoRow label="메모" value={selectedCustomer.memo || '메모 없음'} />
                <DarkButton variant="ghost" onClick={() => setEditing(true)}>수정</DarkButton>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function PolibotDownloadPanel() {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [filters, setFilters] = useState({ query: '', from: '', to: '', productGroup: '', month: '', target: 'all', type: 'recommendations' });

  useEffect(() => {
    api.get('/api/product-workspace/polibot')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '다운로드 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const filteredCustomers = (workspace.customers || []).filter((customer) => {
    const text = [customer.name, customer.memo, customer.selectedRecommendation?.name].filter(Boolean).join(' ');
    if (filters.query && !text.includes(filters.query)) return false;
    const date = customer.updatedAt || customer.createdAt || '';
    if (filters.from && date && date.slice(0, 10) < filters.from) return false;
    if (filters.to && date && date.slice(0, 10) > filters.to) return false;
    if (filters.productGroup && !JSON.stringify(customer).includes(filters.productGroup)) return false;
    if (filters.month && !JSON.stringify(customer).includes(filters.month)) return false;
    return true;
  });

  const downloadCsv = () => {
    const rowsSource = filters.target === 'latest'
      ? [{ name: workspace.customerProfile?.name || '현재 추천', recommendations: workspace.recommendations || [] }]
      : filteredCustomers;
    let header = [];
    let rows = [];
    if (filters.type === 'customers') {
      header = ['customerName', 'age', 'gender', 'needs', 'budget', 'selectedRecommendation', 'memo', 'savedAt'];
      rows = rowsSource.map((customer) => [
        customer.name,
        customer.age,
        customer.gender,
        (customer.needs || []).join(' | '),
        customer.budget,
        customer.selectedRecommendation?.name || '',
        customer.memo || '',
        customer.updatedAt || customer.createdAt || ''
      ].map(csvEscape).join(','));
    } else if (filters.type === 'evidence') {
      header = ['customerName', 'recommendation', 'month', 'fileName', 'company', 'productGroup', 'keywords', 'summary'];
      rows = rowsSource.flatMap((customer) => (customer.recommendations || workspace.recommendations || []).flatMap((rec) => (rec.evidence || []).map((source) => [
        customer.name,
        rec.name,
        source.month,
        source.fileName,
        (source.companies || [source.company]).filter(Boolean).join(' | '),
        source.productGroup,
        (source.keywords || []).join(' | '),
        source.summary || ''
      ].map(csvEscape).join(','))));
    } else {
      header = ['customerName', 'recommendationName', 'type', 'score', 'coverageGap', 'premium', 'cautions', 'evidenceProducts', 'evidenceFiles'];
      rows = rowsSource.flatMap((customer) => (customer.recommendations || workspace.recommendations || []).map((rec) => [
        customer.name,
        rec.name,
        rec.type === 'bundle' ? '조합' : '단품',
        rec.score,
        rec.coverageGap,
        rec.premium,
        (rec.cautions || []).join(' | '),
        (rec.evidence || []).flatMap((source) => source.productNames || []).join(' | '),
        (rec.evidence || []).map((source) => `${source.month} ${source.fileName}`).join(' | ')
      ].map(csvEscape).join(',')));
    }
    downloadTextFile('polibot-results.csv', `\uFEFF${[header.join(','), ...rows].join('\r\n')}`, 'text/csv;charset=utf-8');
  };

  return (
    <PanelCard title="결과 다운로드">
      <div className="grid gap-3">
        <label className={labelClass}>고객명 검색<input className={inputClass} value={filters.query} onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))} placeholder="고객명 또는 추천명" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>시작일<input type="date" className={inputClass} value={filters.from} onChange={(event) => setFilters((prev) => ({ ...prev, from: event.target.value }))} /></label>
          <label className={labelClass}>종료일<input type="date" className={inputClass} value={filters.to} onChange={(event) => setFilters((prev) => ({ ...prev, to: event.target.value }))} /></label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DarkSelect label="상품군" value={filters.productGroup} onChange={(value) => setFilters((prev) => ({ ...prev, productGroup: value }))} options={[{ value: '', label: '전체 상품군' }, ...(workspace.catalog?.productGroups || []).map((item) => ({ value: item, label: item }))]} />
          <DarkSelect label="자료 월" value={filters.month} onChange={(value) => setFilters((prev) => ({ ...prev, month: value }))} options={[{ value: '', label: '전체 월' }, ...(workspace.catalog?.months || []).map((item) => ({ value: item, label: item }))]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DarkSelect label="대상" value={filters.target} onChange={(value) => setFilters((prev) => ({ ...prev, target: value }))} options={[{ value: 'all', label: '저장 고객 전체' }, { value: 'latest', label: '현재 추천 결과' }]} />
          <DarkSelect label="다운로드 종류" value={filters.type} onChange={(value) => setFilters((prev) => ({ ...prev, type: value }))} options={[{ value: 'recommendations', label: '추천 결과' }, { value: 'customers', label: '고객별 상담 요약' }, { value: 'evidence', label: '근거 자료 요약' }]} />
        </div>
        <DarkButton onClick={downloadCsv} disabled={filters.target !== 'latest' && filteredCustomers.length === 0 && !workspace.recommendations?.length}>
          <Download size={16} />
          CSV 다운로드
        </DarkButton>
      </div>
    </PanelCard>
  );
}

function InfludexUploadPanel({ onOpenGrade }) {
  const toast = useToast();
  const [rows, setRows] = useState('');
  const [fileName, setFileName] = useState('');
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const usage = workspaceUsage(workspace);

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || 'INFLUDEX 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/infludex/candidates', { rows, fileName });
      setWorkspace(next);
      toast('인스타그램 후보를 저장했어요.', 'success');
      onOpenGrade?.();
    } catch (err) {
      toast(err.message || '후보 저장에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="후보 입력">
        <ProductUsageStrip usage={usage} />
        <label className={labelClass}>
          후보 목록
          <textarea
            className={inputClass}
            rows="7"
            value={rows}
            onChange={(event) => setRows(event.target.value)}
            placeholder={'url 또는 @handle, 카테고리, 팔로워, 평균 좋아요, 평균 댓글, 최근 게시일, 광고성 메모\nhttps://instagram.com/example, 뷰티, 35000, 1200, 45, 2026-05-01'}
          />
        </label>
        <label className={`${labelClass} mt-3`}>파일명<input className={inputClass} value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="infludex_candidates.csv" /></label>
        <DarkButton className="mt-3 w-full" onClick={save} disabled={saving || !rows.trim()}>{saving ? '저장 중...' : '후보 저장'}</DarkButton>
      </PanelCard>
      {workspace.candidates?.length > 0 && (
        <PanelCard title="저장된 후보">
          <SimpleInfoList items={workspace.candidates.slice(0, 8).map((item) => item.handle ? `@${item.handle}` : item.url)} />
        </PanelCard>
      )}
    </>
  );
}

function InfludexGradePanel({ reloadCurrentUser, onOpenUpload }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const usage = workspaceUsage(workspace);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const results = sortInfludexResults(Array.isArray(workspace.infludexResults) ? workspace.infludexResults : []);

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '분석 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const next = await api.post('/api/product-workspace/infludex/analyze');
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('씨랭 분석을 완료했어요.', 'success');
    } catch (err) {
      toast(err.message || '씨랭 분석에 실패했어요.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const reset = async () => {
    setAnalyzing(true);
    try {
      const next = await api.post('/api/product-workspace/infludex/reset', {});
      setWorkspace(next);
      onOpenUpload?.();
      toast('새 후보를 올릴 준비가 됐어요.', 'success');
    } catch (err) {
      toast(err.message || '초기화에 실패했어요.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <>
      <PanelCard title="씨랭 분석">
        <ProductUsageStrip usage={usage} />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={analyze} disabled={analyzing || candidates.length === 0 || usage.remaining <= 0}>
            {analyzing ? '분석 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : `후보 ${candidates.length}개 분석`}
          </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={analyzing || (candidates.length === 0 && results.length === 0)}>초기화</DarkButton>
        </div>
      </PanelCard>
      <PanelCard title="분석 결과">
        {results.length === 0 ? (
          <Notice>후보를 저장하고 씨랭 분석을 실행하면 결과가 표시돼요.</Notice>
        ) : (
          <div className="grid gap-2">
            {results.map((item) => (
              <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-zinc-200">{item.handle ? `@${item.handle}` : item.url}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{item.category}</div>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-200">{item.grade} · {item.score}</span>
                </div>
                <div className="mt-2 text-xs leading-relaxed text-zinc-600">{item.reasons?.join(' · ')}</div>
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </>
  );
}

function InfludexDownloadPanel({ onOpenUpload }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const results = sortInfludexResults(Array.isArray(workspace.infludexResults) ? workspace.infludexResults : []);

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '다운로드 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const downloadCsv = () => {
    const header = ['url', 'handle', 'category', 'grade', 'score', 'followers', 'avgLikes', 'avgComments', 'engagementRate', 'reasons'];
    const rows = results.map((item) => [
      item.url,
      item.handle,
      item.category,
      item.grade,
      item.score,
      item.followerCount,
      item.avgLikes,
      item.avgComments,
      item.engagementRate,
      item.reasons?.join(' | ')
    ].map(csvEscape).join(','));
    downloadTextFile('infludex-results.csv', `\uFEFF${[header.join(','), ...rows].join('\r\n')}`, 'text/csv;charset=utf-8');
  };

  return (
    <PanelCard title="결과 다운로드">
      <div className="grid gap-2">
        <DarkButton onClick={downloadCsv} disabled={results.length === 0}>
          <Download size={16} />
          CSV 다운로드
        </DarkButton>
        <DarkButton variant="ghost" onClick={onOpenUpload}>새 후보 업로드</DarkButton>
      </div>
    </PanelCard>
  );
}

const productPreviewContent = {
  dexor: {
    title: 'DEXOR',
    subtitle: '블로그 선정 자동화',
    motto: '캠페인 글이 노출될 블로그를 먼저 고릅니다.',
    description: '분석 카테고리와 후보 URL을 넣으면 S/A/B/C/D 기준으로 좋은 후보부터 정리해요.',
    cta: 'DEXOR 시작하기'
  },
  spread: {
    title: 'SPREAD',
    subtitle: '추천 캠페인 운영 자동화',
    motto: '캠페인 운영의 반복 작업을 한곳에서 줄여요.',
    description: '캠페인 추천, 참여자 선정, 제출물 검수를 한 흐름으로 묶어 운영자가 판단할 일만 남겨요.',
    cta: 'SPREAD 시작하기'
  },
  polibot: {
    title: 'POLIBOT',
    subtitle: '보험 보장분석 자동화',
    motto: '보험 상품과 고객 조건을 빠르게 비교해요.',
    description: 'PDF 업로드, 고객 프로필, 보장 니즈를 바탕으로 추천 초안과 비교 결과를 정리해요.',
    cta: 'POLIBOT 시작하기'
  },
  infludex: {
    title: 'INFLUDEX',
    subtitle: '인스타그램 인플루언서 분석',
    motto: '카테고리와 반응 지표로 후보를 먼저 걸러요.',
    description: '인스타그램 계정 후보를 DIAMOND/S/A/B/C/D 등급으로 정리하고 결과를 다운로드해요.',
    cta: 'INFLUDEX 시작하기'
  }
};

function ProductPreview({ action, onStartProduct, starting }) {
  const product = productPreviewContent[action.key] || productPreviewContent.dexor;
  const preparing = action.key === 'infludex';
  return (
    <PanelCard className="self-start">
      <div className="text-xs font-black uppercase tracking-wide text-zinc-500">{product.subtitle}</div>
      <h2 className="mt-3 text-3xl font-black text-zinc-100">{product.title}</h2>
      <p className="mt-4 text-lg font-black leading-snug text-zinc-100">{product.motto}</p>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">{product.description}</p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">
        {preparing ? '서비스 준비중이에요. 기능은 테스트 검수 후 열어둘게요.' : '시작하면 왼쪽 Tasks에 이 제품의 기능이 바로 열려요.'}
      </div>
      <button
        type="button"
        onClick={() => onStartProduct?.(action.key)}
        disabled={starting || preparing}
        className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {preparing ? '서비스 준비중' : starting ? '시작하는 중...' : product.cta}
      </button>
    </PanelCard>
  );
}

function PreflightSummary({ check }) {
  return (
    <div className="grid gap-2">
      <div className={`rounded-2xl border px-4 py-3 text-sm font-black ${check.canPublish ? 'border-white/20 bg-white/10 text-zinc-100' : 'border-white/10 bg-black/25 text-zinc-300'}`}>
        {check.canPublish ? '현재 설정 점검을 통과했어요.' : '자동화 전에 조치할 항목이 있어요.'}
      </div>
      {(check.checks || []).slice(0, 6).map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm">
          <div className="flex items-center gap-2 font-black text-zinc-200">
            {item.status === 'ok' ? <CheckCircle2 size={16} className="text-zinc-200" /> : <AlertTriangle size={16} className="text-zinc-400" />}
            {item.title}
          </div>
          {item.message && <div className="mt-1 text-xs leading-relaxed text-zinc-500">{item.message}</div>}
        </div>
      ))}
    </div>
  );
}

function QueueSection({ title, rows, posts, expandedId, detail, loadingDetailId, dismissingId, onToggle, onDismiss }) {
  if (rows.length === 0) return null;
  return (
    <PanelCard title={title}>
      <div className="grid gap-2">
        {rows.map((row) => {
          const post = posts.find((item) => item.id === row.post_id);
          const expanded = expandedId === row.id;
          const rowDetail = detail[row.id];
          return (
            <div key={row.id} className="overflow-hidden rounded-2xl bg-black/25">
              <button type="button" onClick={() => onToggle(row.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`h-2 w-2 shrink-0 rounded-full ${row.status === 'posted' ? 'bg-white' : row.status === 'scheduled' ? 'bg-zinc-400' : 'bg-zinc-700'}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-zinc-200">{statusLabel(row.status)}</div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">{dateTime(row.posted_at || row.scheduled_at || row.created_at)} {post?.body ? `· ${post.body.slice(0, 36)}` : ''}</div>
                </div>
                <span className="text-xs text-zinc-600">{expanded ? '접기' : '보기'}</span>
              </button>
              {expanded && (
                <div className="grid gap-3 border-t border-white/5 px-4 py-3">
                  {loadingDetailId === row.id ? (
                    <div className="text-xs text-zinc-500">불러오는 중...</div>
                  ) : (
                    <>
                      {(rowDetail?.post?.body || post?.body) && <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-300">{rowDetail?.post?.body || post?.body}</pre>}
                      {(row.friendly_message || row.error_message) && <Notice tone="error">{row.friendly_message || row.error_message}</Notice>}
                      {row.post_url && <a href={row.post_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-zinc-100 hover:text-white">게시글 보기</a>}
                      {onDismiss && (
                        <DarkButton variant="ghost" size="sm" onClick={() => onDismiss(row.id)} disabled={dismissingId === row.id}>
                          {dismissingId === row.id ? '정리 중...' : '확인 완료'}
                        </DarkButton>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}

function PipelineResultCard({ pipelineResult }) {
  const queuedCount = pipelineResult?.queuedCount ?? pipelineResult?.steps?.queued ?? 0;
  const ok = (pipelineResult?.ok === true || pipelineResult?.status === 'ok') && queuedCount > 0;
  return (
    <Notice tone={ok ? 'success' : 'error'}>
      {ok ? `예약 ${queuedCount}개 생성 완료` : pipelineResult?.message || pipelineResult?.error || '최근 자동화 결과를 확인해 주세요.'}
    </Notice>
  );
}

function SimpleQueueRows({ rows, emptyText }) {
  if (rows.length === 0) return <div className="rounded-2xl bg-black/25 px-4 py-5 text-center text-sm font-bold text-zinc-600">{emptyText}</div>;
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3 text-sm">
          <span className="font-black text-zinc-200">{statusLabel(row.status)}</span>
          <span className="text-xs text-zinc-500">{dateTime(row.posted_at || row.scheduled_at || row.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

function downloadTextFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function SimpleInfoList({ items }) {
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item} className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">{item}</div>
      ))}
    </div>
  );
}

function MetricGrid({ summary, loading }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        ['예약', summary.scheduled],
        ['완료', summary.posted],
        ['확인', summary.needsReview],
        ['클릭', summary.clicks]
      ].map(([label, value]) => (
        <div key={label} className="rounded-2xl bg-black/25 px-3 py-4 text-center">
          <div className="text-xs font-bold text-zinc-500">{label}</div>
          <div className="mt-2 text-xl font-black text-zinc-100">{loading ? '-' : value}</div>
        </div>
      ))}
    </div>
  );
}

function PanelCard({ title, children, className = '' }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>
      {title && <div className="mb-4 text-sm font-black text-zinc-100">{title}</div>}
      {children}
    </section>
  );
}

function CollapsiblePanel({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="text-sm font-black text-zinc-100">{title}</span>
        <span className="text-lg font-black leading-none text-zinc-500">{open ? '-' : '+'}</span>
      </button>
      {open && <div className="grid gap-4 border-t border-white/5 px-5 pb-5 pt-4">{children}</div>}
    </section>
  );
}

function PrivacyModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm">
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#191919] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="text-lg font-black text-zinc-100">개인정보처리방침</div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-5 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-zinc-400">
          <p>이상한 회사는 JASAIN 서비스 제공과 계정 보호를 위해 필요한 범위에서 개인정보를 처리해요. 서비스 이용을 계속하면 아래 처리 기준에 동의한 것으로 봐요.</p>
          <PolicySection title="수집 항목">이메일, 이름 또는 사용자명, 연락처, 결제 및 입금 확인 정보, 보유 솔루션, 서비스 이용 기록, 오류 기록, 상담 기록, Threads/Coupang 연결 상태와 자동화 운영에 필요한 설정값을 수집할 수 있어요.</PolicySection>
          <PolicySection title="이용 목적">회원 식별, 무료체험 및 결제 권한 관리, 자동화 서비스 제공, 장애 대응, 부정 이용 방지, 고객 안내, 서비스 개선, 분쟁 대응과 법적 의무 이행을 위해 사용해요.</PolicySection>
          <PolicySection title="보유 기간">회원 탈퇴 또는 계약 종료 후에도 정산, 분쟁 대응, 부정 이용 방지, 법령상 보존 의무를 위해 필요한 기간 동안 보관할 수 있어요. 결제·거래 기록은 관련 법령에 따라 보관해요.</PolicySection>
          <PolicySection title="제3자 제공 및 처리 위탁">법령상 요구, 결제 처리, 인프라 운영, 고객 응대처럼 서비스 제공에 필요한 경우에 한해 외부 사업자에게 제공하거나 처리를 맡길 수 있어요. 그 외에는 이용자 동의 없이 임의로 판매하지 않아요.</PolicySection>
          <PolicySection title="환불 기준">디지털 자동화 서비스 특성상 무료체험, 크레딧, 이용권, 세팅 지원, API 연결, 자동화 실행이 시작된 뒤에는 단순 변심 환불이 제한돼요. 결제 오류나 중복 결제처럼 회사 귀책이 명확한 경우에만 확인 후 환불을 검토해요.</PolicySection>
          <PolicySection title="이용자 책임">Threads, Coupang, 카드사, 은행 등 외부 서비스 정책 변경이나 이용자 계정 상태로 생기는 연결 오류는 회사가 임의로 복구할 수 없어요. 필요한 경우 재연결 또는 재설정 안내를 제공해요.</PolicySection>
          <div className="rounded-2xl bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
            책임자 이상빈 · 이메일 dypapa0309@gmail.com · 사업자등록번호 876-28-01550 · 주소 상동로 87 가나베스트타운 803-102
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessInfoModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191919] p-6 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between">
          <div className="text-lg font-black text-zinc-100">사업자정보</div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 text-sm text-zinc-400">
          <AccountInfoRow label="사업자명" value="이상한 회사" />
          <AccountInfoRow label="대표" value="이상빈" />
          <AccountInfoRow label="사업자등록번호" value="876-28-01550" />
          <AccountInfoRow label="이메일" value="dypapa0309@gmail.com" />
          <AccountInfoRow label="개인정보처리책임자" value="이상빈" />
        </div>
      </div>
    </div>
  );
}

function SupportInfoModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191919] p-6 shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between">
          <div className="text-lg font-black text-zinc-100">고객센터</div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 text-sm text-zinc-400">
          <p className="leading-relaxed text-zinc-500">워크스페이스 안에서 해결되지 않는 내용은 문자나 카카오톡으로 남겨주세요.</p>
          <a href="sms:01040941666?body=%5BJASAIN%20%EC%83%81%EB%8B%B4%5D%20" className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-zinc-950">
            문자상담 010-4094-1666
          </a>
          <a href="https://open.kakao.com/o/sOtaVlsi" target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-200 hover:bg-white/10">
            카카오톡 오픈채팅
          </a>
        </div>
      </div>
    </div>
  );
}

function PolicySection({ title, children }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-zinc-100">{title}</h3>
      <p>{children}</p>
    </section>
  );
}

function DarkSelect({ label, value, onChange, options }) {
  return (
    <label className={labelClass}>
      {label}
      <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ProductUsageStrip({ usage }) {
  if (!usage) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <div>
        <div className="text-xs font-black text-zinc-500">남은 무료 사용</div>
        <div className="mt-0.5 text-sm font-bold text-zinc-300">{usage.used} / {usage.limit}회 사용</div>
      </div>
      <div className="text-2xl font-black text-zinc-100">{usage.remaining}</div>
    </div>
  );
}

function DarkConfirmModal({ title, description, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/60">
        <div className="text-lg font-black text-zinc-100">{title}</div>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">{description}</p>
        <div className="mt-5 grid gap-2">
          <DarkButton onClick={onPrimary}>{primaryLabel}</DarkButton>
          <DarkButton variant="ghost" onClick={onSecondary}>{secondaryLabel}</DarkButton>
        </div>
      </div>
    </div>
  );
}

function DarkButton({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  const variantClass = variant === 'ghost'
    ? 'border border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/10'
    : 'bg-zinc-100 text-zinc-950 hover:bg-white';
  const sizeClass = size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm';
  return (
    <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-2xl font-black disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${sizeClass} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Notice({ children, tone = 'info' }) {
  const className = tone === 'error'
    ? 'border-white/15 bg-black/25 text-zinc-200'
    : tone === 'success'
      ? 'border-white/20 bg-white/10 text-zinc-100'
      : 'border-white/10 bg-white/[0.03] text-zinc-400';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${className}`}>
      {children}
    </div>
  );
}
