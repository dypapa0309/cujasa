import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, BarChart3, Bot, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, ClipboardCheck, CreditCard, DatabaseZap, Download, ExternalLink, FileText, Landmark, Link2, LogOut, PauseCircle, PlayCircle, Plus, RefreshCw, RotateCw, Search, Settings, ShieldCheck, Sparkles, Upload, Users, UserCircle, Wand2, X } from 'lucide-react';
import { api, postEvent } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';
import { PRODUCTS, CURRENT_PRODUCT, productById, productIdFromPath } from '../../config/products.js';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import BillingAgreementModal, { BILLING_AGREEMENT_VERSION } from '../../components/BillingAgreementModal.jsx';
import {
  commentStyleOptions,
  contentIntensityOptions,
  contentModeOptions,
  emojiLevelOptions,
  productMentionOptions
} from '../../config/contentStrategy.js';

const MAX_DAILY_POSTS = 5;
const HIRA_CERT_URL = 'https://ptl.hira.or.kr/mainCert.do?pageType=certByJ&domain=https://www.hira.or.kr&uri=JTJGcmIlMkZjbW1uJTJGcmJDZXJ0UmV0dXJuLmRvJTNGc3RyUGFnZVR5cGUlM0RESUFH';
const infludexMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_INFLUDEX_BETA !== 'true';

function calculateAgeFromBirthdate(birthdate) {
  if (!birthdate) return '';
  const birth = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return String(age);
}

function normalizeBirthdateInput(value, { allowSixDigit = true } = {}) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  if (allowSixDigit && digits.length === 6) {
    const yearPrefix = Number(digits.slice(0, 2)) <= new Date().getFullYear() % 100 ? '20' : '19';
    return `${yearPrefix}${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
  }
  return raw;
}

function birthdatePasswordCandidates(birthdate = '') {
  const digits = String(birthdate || '').replace(/[^0-9]/g, '');
  return [...new Set([
    digits.length === 8 ? digits.slice(2) : '',
    digits
  ].filter(Boolean))];
}

const cujasaActions = [
  { key: 'run', label: '자동화 실행', icon: PlayCircle, hint: '오늘 예약을 만들고 실행 상태를 확인해요.' },
  { key: 'settings', label: '설정 확인', icon: Settings, hint: 'Threads, 쿠팡 API, 콘텐츠 기준을 점검해요.' },
  { key: 'trend-references', label: '인기글 학습', icon: Plus, hint: '반응 좋았던 글에서 말투와 패턴을 배워 다음 콘텐츠에 반영해요.' },
  { key: 'posts', label: '포스팅 현황', icon: FileText, hint: '예약, 완료, 확인 필요 글을 봐요.' },
  { key: 'home', label: '성과 보기', icon: BarChart3, hint: '예약 수와 클릭 성과를 요약해요.' }
];

const productPreviewActions = [
  { key: 'dexor', label: 'DEXOR', icon: Search, hint: '캠페인에 맞는 블로그 후보를 고르는 솔루션이에요.' },
  { key: 'spread', label: 'SPREAD', icon: Sparkles, hint: '캠페인 운영과 제출물 확인을 줄이는 솔루션이에요.' },
  { key: 'polibot', label: 'POLIBOT', icon: ShieldCheck, hint: '보험 보장분석과 상품 추천을 정리하는 솔루션이에요.' },
  { key: 'infludex', label: 'INFLUDEX', icon: BarChart3, hint: '인스타그램 인플루언서를 카테고리와 등급으로 분석해요.' },
  { key: 'sublog', label: 'SUBLOG', icon: CreditCard, hint: '매달 결제되는 구독 비용을 한눈에 정리해요.' },
  { key: 'auvibot', label: 'AUVIBOT', icon: Clapperboard, hint: '상품 영상 소싱부터 쇼츠 편집안까지 준비해요.' }
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
  { key: 'polibot-upload', productId: 'polibot', label: '자료 상태', icon: DatabaseZap, hint: '월별 상품 자료와 추천 준비 상태를 확인해요.' },
  { key: 'polibot-recommend', productId: 'polibot', label: '상품 추천', icon: Plus, hint: '고객 조건과 보장 니즈로 추천 초안을 만들어요.' },
  { key: 'polibot-customers', productId: 'polibot', label: '고객 관리', icon: Users, hint: '고객 조건과 추천 기록을 정리해요.' },
  { key: 'polibot-download', productId: 'polibot', label: '결과 다운로드', icon: Download, hint: '추천 결과를 CSV로 내려받아요.' }
];

const infludexActions = [
  { key: 'infludex-upload', productId: 'infludex', label: '후보 업로드', icon: Upload, hint: '인스타그램 계정 URL, 카테고리, 반응 지표를 넣어요.' },
  { key: 'infludex-grade', productId: 'infludex', label: '후보 분석', icon: Search, hint: 'S/A/B/C/D 등급과 캠페인 선정 기준을 확인해요.' },
  { key: 'infludex-download', productId: 'infludex', label: '결과 다운로드', icon: Download, hint: '분석 결과를 CSV로 내려받아요.' }
];

const sublogActions = [
  { key: 'sublog-dashboard', productId: 'sublog', label: '구독 대시보드', icon: CreditCard, hint: '매달 결제되는 구독 비용을 직접 등록하고 한눈에 봐요.' }
];

const auvibotActions = [
  { key: 'auvibot-run', productId: 'auvibot', label: '자동화 실행', icon: PlayCircle, hint: '영상 소싱, 상품 매칭, 렌더 작업을 시작해요.' },
  { key: 'auvibot-settings', productId: 'auvibot', label: '설정 확인', icon: Settings, hint: 'Threads 연결, 게시 기준, 영상 스타일을 정해요.' },
  { key: 'auvibot-video-learning', productId: 'auvibot', label: '인기영상 학습', icon: Plus, hint: '잘 되는 영상의 훅, 컷 템포, 자막 패턴을 학습해요.' },
  { key: 'auvibot-posts', productId: 'auvibot', label: '포스팅 현황', icon: FileText, hint: '생성된 쇼츠, 렌더 대기, 업로드 큐 상태를 확인해요.' },
  { key: 'auvibot-analytics', productId: 'auvibot', label: '성과 보기', icon: BarChart3, hint: '생성 수, 렌더 성공률, 조회/클릭 성과를 요약해요.' }
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
  infludex: infludexActions,
  sublog: sublogActions,
  auvibot: auvibotActions
};

const actions = [...cujasaActions, ...workspaceActions, ...productPreviewActions, ...dexorActions, ...spreadActions, ...polibotActions, ...infludexActions, ...sublogActions, ...auvibotActions];
const pendingSubscriptionKey = 'cujasa_pending_subscription';

function isTrustedThreadsPostUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) return false;
  if (/\/mock\/threads\/[^/?#]+/i.test(value)) return true;
  if (!/https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^/]+\/post\/[^/?#]+/i.test(value)) return false;
  return !/\/post\/\d+(?:[/?#].*)?$/i.test(value);
}

function isProductInMaintenance(product = {}) {
  if (!product) return false;
  if (product?.id === 'infludex') return infludexMaintenanceEnabled;
  return false;
}

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/25';
const invalidFieldClass = 'ring-1 ring-red-400/45 bg-red-950/10';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';
const dexorCategoryOptions = ['자동', '맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const dexorScoreRows = [
  ['S', '90점 이상', '우선 추천'],
  ['A', '70-89점', '추천'],
  ['B', '60-69점', '검토'],
  ['C', '40-59점', '추가 확인'],
  ['D', '40점 미만', '비추천']
];
const polibotNeedOptions = ['암', '뇌', '심장', '수술', '입원', '실손', '생활비', '운전자'];
const polibotCoverageFields = [
  { key: 'cancer', label: '암 진단비', placeholder: '예: 5,000' },
  { key: 'similarCancer', label: '유사암', placeholder: '예: 1,000' },
  { key: 'brain', label: '뇌혈관/뇌졸중', placeholder: '예: 2,000' },
  { key: 'heart', label: '허혈성/심근경색', placeholder: '예: 2,000' },
  { key: 'surgery', label: '수술비', placeholder: '예: 300' },
  { key: 'hospital', label: '입원일당', placeholder: '예: 5' },
  { key: 'medical', label: '실손/실비', placeholder: '있음/없음' },
  { key: 'care', label: '간병/치매', placeholder: '예: 1,000' },
  { key: 'death', label: '사망/후유장해', placeholder: '예: 3,000' },
  { key: 'driver', label: '운전자', placeholder: '있음/없음' }
];
const polibotDisclosureFields = [
  { key: 'recent3Months', label: '최근 3개월', placeholder: '진찰/검사/추가검사 소견' },
  { key: 'recent1Year', label: '최근 1년', placeholder: '추가검사/재검사 여부' },
  { key: 'recent5Years', label: '최근 5년', placeholder: '입원/수술/7일 치료/30일 투약' },
  { key: 'recentExam', label: '최근 검사', placeholder: '검사명/소견/재검 여부' },
  { key: 'admissionSurgery', label: '입원/수술', placeholder: '병명/시기/치료 결과' },
  { key: 'longTreatment', label: '7일 이상 치료', placeholder: '치료명/기간/완료 여부' },
  { key: 'longMedication', label: '30일 이상 투약', placeholder: '약명/질환/복용기간' },
  { key: 'currentMedication', label: '현재 투약', placeholder: '약명/질환/복용기간' },
  { key: 'majorDisease', label: '주요 병력', placeholder: '암/뇌/심장/당뇨/고혈압 등' },
  { key: 'completeCure', label: '완치 여부', placeholder: '완치/치료중/추적관찰' },
  { key: 'followUp', label: '추적관찰', placeholder: '정기검사/경과관찰 여부' }
];
const polibotRecent3MonthFields = [
  { key: 'diagnosis', label: '진단' },
  { key: 'suspicion', label: '의심소견' },
  { key: 'treatment', label: '치료' },
  { key: 'admission', label: '입원' },
  { key: 'surgery', label: '수술' },
  { key: 'medication', label: '투약' },
  { key: 'extraExam', label: '추가검사' }
];
const polibotDisclosureDecisionOptions = [
  { value: '', label: '미확인' },
  { value: '없음', label: '없음' },
  { value: '있음', label: '있음' },
  { value: '확인 필요', label: '확인 필요' }
];
const polibotDiseaseEventOptions = [
  { value: '', label: '전체' },
  { value: '통원', label: '통원' },
  { value: '입원', label: '입원' },
  { value: '수술', label: '수술' },
  { value: '투약', label: '투약' }
];
const polibotCarrierTypeOptions = [
  { value: '', label: '손보+생보' },
  { value: 'nonlife', label: '손보' },
  { value: 'life', label: '생보' }
];
const polibotDiseaseStatusOptions = [
  { value: '', label: '상태 미확인' },
  { value: '완치', label: '완치' },
  { value: '치료중', label: '치료중' },
  { value: '추적관찰', label: '추적관찰' },
  { value: '투약중', label: '투약중' }
];
const createPolibotRecent3MonthState = () => Object.fromEntries(polibotRecent3MonthFields.map((field) => [field.key, '']));
const polibotPolicyTemplate = {
  company: '',
  productName: '',
  startDate: '',
  renewalType: '',
  premium: '',
  paymentPeriod: '',
  maturity: '',
  status: ''
};
const polibotUnderwritingTemplate = {
  route: '',
  standardPossible: '',
  burden: '',
  surcharge: '',
  simpleReview: '',
  note: ''
};
const polibotAnalysisResultTemplate = {
  gaps: '',
  duplicates: '',
  premiumIssue: '',
  keepList: '',
  remodelList: '',
  caution: ''
};
const createPolibotCoverageState = () => Object.fromEntries(polibotCoverageFields.map((field) => [
  field.key,
  { amount: '', renewalType: '', maturity: '', note: '' }
]));
const createPolibotPolicyRows = () => [{ ...polibotPolicyTemplate }];
const createPolibotDisclosureState = () => ({
  ...Object.fromEntries(polibotDisclosureFields.map((field) => [field.key, ''])),
  recent3Months: createPolibotRecent3MonthState(),
  diseaseEvents: []
});
const mergePolibotTextLines = (...values) => [...new Set(values.flatMap((value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)))].join('\n');
const polibotPolicyKey = (policy = {}) => [
  policy.company,
  policy.productName,
  policy.startDate,
  policy.premium,
  policy.paymentPeriod,
  policy.maturity
].map((value) => displayValue(value).replace(/\s+/g, '')).join('|').replace(/^\|+$/, '');
const mergePolibotPolicyDetails = (...lists) => {
  const rows = [];
  const seen = new Set();
  lists.flat().filter(Boolean).forEach((policy) => {
    const key = polibotPolicyKey(policy);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(policy);
  });
  return rows.length ? rows : createPolibotPolicyRows();
};
const mergePolibotCoverageValues = (current = {}, next = {}) => {
  const merged = { ...(current || {}) };
  Object.entries(next || {}).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const prev = merged[key] && typeof merged[key] === 'object' ? merged[key] : {};
    merged[key] = {
      ...prev,
      ...Object.fromEntries(Object.entries(value).filter(([, itemValue]) => displayValue(itemValue)))
    };
  });
  return merged;
};
const sumPolibotPremiumValues = (...values) => {
  const total = values.flatMap((value) => String(value || '').split(/\s*[,\n/]\s*/))
    .map((value) => Number(String(value || '').replace(/[^\d.]/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);
  return total ? String(Math.round(total * 10) / 10) : '';
};
const hasPolibotRecent3MonthAnswers = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
  && polibotRecent3MonthFields.some((field) => displayValue(value[field.key]))
);
const mergePolibotDisclosureDetails = (current = {}, next = {}) => {
  if (!next || typeof next !== 'object') return current || {};
  const merged = { ...(current || {}), ...next };
  if (Array.isArray(current?.diseaseEvents) || Array.isArray(next?.diseaseEvents)) {
    const rows = [...(Array.isArray(current?.diseaseEvents) ? current.diseaseEvents : []), ...(Array.isArray(next?.diseaseEvents) ? next.diseaseEvents : [])]
      .filter((item) => item && typeof item === 'object');
    const seen = new Set();
    merged.diseaseEvents = rows.filter((item) => {
      const key = [item.occurredAt, item.eventType, item.kcdCode || item.code, item.diseaseName || item.name, item.company].map(displayValue).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(-20);
  }
  if (current?.recent3Months && next?.recent3Months) {
    if (hasPolibotRecent3MonthAnswers(current.recent3Months) && typeof next.recent3Months === 'string') {
      merged.recent3Months = current.recent3Months;
    } else if (hasPolibotRecent3MonthAnswers(current.recent3Months) && next.recent3Months && typeof next.recent3Months === 'object') {
      merged.recent3Months = { ...current.recent3Months, ...next.recent3Months };
    }
  }
  return merged;
};
const coverageAmountValue = (value) => (value && typeof value === 'object' ? value.amount || '' : value || '');
const polibotTargetPremiumQuickOptions = ['10', '20', '30', '40', '50'];
const polibotGenderOptions = [
  { value: '', label: '미확인' },
  { value: '남성', label: '남성' },
  { value: '여성', label: '여성' }
];
const polibotPurposeOptions = [
  { value: '', label: '고객 목적 선택' },
  { value: '보장 강화', label: '보장 강화' },
  { value: '보험료 감액', label: '보험료 감액' },
  { value: '리모델링', label: '기존보험 리모델링' },
  { value: '신규 가입', label: '신규 가입' },
  { value: '노후/간병 준비', label: '노후/간병 준비' },
  { value: '자녀/가족 보장', label: '자녀/가족 보장' }
];
const polibotFamilyHistoryOptions = [
  { value: '', label: '미확인' },
  { value: '없음', label: '없음' },
  { value: '암 가족력', label: '암' },
  { value: '뇌혈관 가족력', label: '뇌' },
  { value: '심장 가족력', label: '심장' },
  { value: '치매/간병 가족력', label: '치매/간병' },
  { value: '상담 확인', label: '상담 확인' }
];
const polibotAgeQuickOptions = ['30', '35', '40', '45', '50', '55', '60'];

function parsePolibotPremiumValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const range = text.match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[2]);
  const number = text.match(/\d+(?:\.\d+)?/);
  if (!number) return null;
  const amount = Number(number[0]);
  if (!Number.isFinite(amount)) return null;
  return /원/.test(text) && !/만원/.test(text) ? amount / 10000 : amount;
}

function formatPolibotPremiumValue(value) {
  if (!Number.isFinite(Number(value))) return '';
  return `${Number(value).toLocaleString('ko-KR')}만원`;
}

function normalizePolibotPremiumInput(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d+(?:\.\d+)?$/.test(text.replace(/,/g, ''))) {
    return `${Number(text.replace(/,/g, '')).toLocaleString('ko-KR')}만원`;
  }
  return text;
}

function polibotBudgetHint({ budget = '', existingPremium = '', purpose = '' } = {}) {
  const target = parsePolibotPremiumValue(budget);
  const current = parsePolibotPremiumValue(existingPremium);
  const remodel = /리모델링|보험료\s*(절감|감액)/.test(purpose);
  if (!Number.isFinite(target) || !Number.isFinite(current)) {
    return remodel
      ? '기존 보험 조정까지 포함해 목표 보험료 안에서 다시 봅니다.'
      : '목표와 현재 납입 보험료를 입력하면 추가 가능 예산을 계산해요.';
  }
  const diff = Math.round((target - current) * 10) / 10;
  if (remodel) {
    return `기존 보험 조정 포함 · 목표 ${formatPolibotPremiumValue(target)} / 현재 ${formatPolibotPremiumValue(current)}`;
  }
  if (diff > 0) return `추가 가능 예산 약 ${formatPolibotPremiumValue(diff)}`;
  if (diff === 0) return '추가 여력 없음 · 기존 보험 조정 또는 보장 재배치 중심으로 봅니다.';
  return `목표가 현재보다 약 ${formatPolibotPremiumValue(Math.abs(diff))} 낮아요 · 절감/리모델링 관점으로 확인이 필요해요.`;
}

function clampDailyPostCount(value, fallback = 1) {
  const number = Number(value);
  return Math.min(MAX_DAILY_POSTS, Math.max(0, Number.isFinite(number) ? number : fallback));
}

const DEFAULT_CUJASA_ACTIVE_TIME_WINDOWS = [{ start: '09:00', end: '23:00' }];

function normalizeScheduleTime(value, fallback = '09:00') {
  return /^\d{2}:\d{2}$/.test(String(value || '')) ? String(value) : fallback;
}

function scheduleTimeToMinutes(value) {
  const [hours, minutes] = normalizeScheduleTime(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function cujasaScheduleWindowsFromAccount(account) {
  const windows = Array.isArray(account?.active_time_windows)
    ? account.active_time_windows
      .filter((window) => window?.start && window?.end)
      .map((window) => ({
        start: normalizeScheduleTime(window.start),
        end: normalizeScheduleTime(window.end, normalizeScheduleTime(window.start))
      }))
    : [];
  return windows.length ? windows : DEFAULT_CUJASA_ACTIVE_TIME_WINDOWS;
}

function buildCujasaScheduleWindows(existingWindows, firstUploadTime) {
  const windows = Array.isArray(existingWindows) && existingWindows.length ? existingWindows : DEFAULT_CUJASA_ACTIVE_TIME_WINDOWS;
  const start = normalizeScheduleTime(firstUploadTime);
  return windows.map((window, index) => {
    if (index > 0) return window;
    const end = normalizeScheduleTime(window.end, start);
    return {
      start,
      end: scheduleTimeToMinutes(end) >= scheduleTimeToMinutes(start) ? end : start
    };
  });
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

function isPostedLinkIssue(row = {}) {
  return row.status === 'posted' && ['reply_warning', 'reply_repair_blocked', 'reply_permission_required'].includes(row.error_category);
}

function queueAttentionLabel(row = {}) {
  if (row.error_category === 'reply_permission_required') return '댓글 권한 재연결';
  if (row.error_category === 'reply_repair_blocked') return '링크 수동확인';
  if (row.error_category === 'reply_warning') return '댓글 링크 확인';
  return null;
}

function queueDisplayTitle(row = {}) {
  return queueAttentionLabel(row) || statusLabel(row.status);
}

function queueDotClass(row = {}) {
  if (isPostedLinkIssue(row)) return 'bg-amber-400';
  if (row.status === 'posted') return 'bg-white';
  if (row.status === 'scheduled') return 'bg-zinc-400';
  if (row.status === 'failed' || row.status === 'manual_required') return 'bg-rose-500';
  return 'bg-zinc-700';
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

function getGrantUsage(grant, productId) {
  const settings = grant?.settingsSummary || grant?.settings || {};
  const usageRoot = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const usage = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(usage.limit)) ? Math.max(0, Number(usage.limit)) : 5;
  const used = Number.isFinite(Number(usage.used)) ? Math.max(0, Number(usage.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, Number.isFinite(Number(usage.remaining)) ? Number(usage.remaining) : limit - used),
    unlimited: usage.unlimited === true
  };
}

function workspaceUsage(workspace) {
  const usage = workspace?.usage && typeof workspace.usage === 'object' ? workspace.usage : {};
  const limit = Number.isFinite(Number(usage.limit)) ? Math.max(0, Number(usage.limit)) : 5;
  const used = Number.isFinite(Number(usage.used)) ? Math.max(0, Number(usage.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, Number.isFinite(Number(usage.remaining)) ? Number(usage.remaining) : limit - used),
    unlimited: usage.unlimited === true
  };
}

function usageRemainingLabel(usage) {
  return usage?.unlimited ? '무제한' : `${usage?.remaining ?? 0}`;
}

function usageSummaryLabel(usage) {
  return usage?.unlimited ? '무제한 사용 가능' : `${usage?.used ?? 0} / ${usage?.limit ?? 5}회 사용`;
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
  if (value >= 90) return '우선 추천';
  if (value >= 80) return '추천';
  if (value >= 70) return '검토';
  if (value >= 60) return '추가 확인';
  return '비추천';
}

function sortInfludexResults(results = []) {
  const order = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  return [...results].sort((a, b) => {
    const aMissing = a.analysisStatus === 'data_missing' || !a.grade;
    const bMissing = b.analysisStatus === 'data_missing' || !b.grade;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    const gradeDelta = (order[a.grade] ?? 99) - (order[b.grade] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.handle || a.url || '').localeCompare(String(b.handle || b.url || ''));
  });
}

function infludexRiskLabel(flag = '') {
  const labels = {
    category_missing: '카테고리 필요',
    category_mismatch: '카테고리 확인 필요',
    followers_missing: '팔로워 수 필요',
    engagement_missing: '좋아요/댓글 평균 필요',
    recent_post_missing: '최근 게시일 필요',
    inactive_over_60d: '최근 활동 확인 필요',
    inactive_over_90d: '활동성 낮음',
    ad_memo_present: '광고/협찬 메모 있음',
    heavy_ad_risk: '광고성 높음',
    follower_reaction_mismatch: '반응 확인 필요',
    low_engagement_for_size: '반응 확인 필요',
    suspicious_high_engagement: '반응 확인 필요',
    high_engagement_review: '반응 확인 필요',
    comments_missing_for_likes: '댓글 확인 필요',
    low_comment_depth: '댓글 확인 필요',
    reels_views_missing: '릴스 평균 조회수 필요',
    invalid_reels_views: '릴스 조회수 확인 필요',
    low_reels_views_for_size: '릴스 조회수 낮음',
    weak_reels_view_rate: '릴스 조회수 확인 필요'
  };
  return labels[flag] || flag;
}

function infludexCandidateLabel(item = {}) {
  return item.handle ? `@${item.handle}` : item.url || item.displayName || '미입력 후보';
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
  oauthReturn,
  accountCreation,
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
  const initialUrlProductId = productById(new URLSearchParams(window.location.search).get('product'))?.id || productIdFromPath(window.location.pathname) || CURRENT_PRODUCT.id;
  const initialUrlProductHandledRef = useRef(false);
  const [selectedProductId, setSelectedProductId] = useState(initialUrlProductId);
  const [showOtherProducts, setShowOtherProducts] = useState(false);
  const [messages, setMessages] = useState([]);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [assistantDraft, setAssistantDraft] = useState(null);
  const [assistantWorkflow, setAssistantWorkflow] = useState(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [businessInfoOpen, setBusinessInfoOpen] = useState(false);
  const [supportInfoOpen, setSupportInfoOpen] = useState(false);
  const [startingProductId, setStartingProductId] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [agreementIntent, setAgreementIntent] = useState(null);
  const chatEndRef = useRef(null);
  const accountMenuRef = useRef(null);
  const lastPromptRef = useRef({ value: '', at: 0 });
  const urlActionHandledRef = useRef('');
  const isTestAssistantUser = String(currentUser?.email || '').trim().toLowerCase() === 'test1@test.com';

  const loadWorkspaceData = useCallback(async () => {
    if (selectedProductId !== CURRENT_PRODUCT.id) {
      setQueue([]);
      setPosts([]);
      setAnalytics(null);
      setLoadError('');
      setLoading(false);
      return;
    }
    if (!account?.id) {
      setQueue([]);
      setPosts([]);
      setAnalytics(null);
      setLoadError('');
      setLoading(false);
      return;
    }
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
  }, [account?.id, selectedProductId]);

  useEffect(() => {
    loadWorkspaceData();
  }, [loadWorkspaceData, pipelineResult]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [activeActionKey, selectedProductId]);

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

  const userProducts = Array.isArray(currentUser?.products) ? currentUser.products : [];
  const activeProducts = useMemo(() => {
    const products = userProducts
      .filter((grant) => grant?.status !== 'suspended')
      .map((grant) => productById(grant?.productId) || {
        id: grant?.productId,
        name: grant?.name || grant?.productId,
        description: grant?.description || ''
      })
      .filter((product) => product?.id);
    const sublog = productById('sublog');
    if (isTestAssistantUser && sublog && !products.some((product) => product.id === 'sublog')) {
      products.push(sublog);
    }
    return products;
  }, [isTestAssistantUser, userProducts]);
  const grantedProductIds = new Set(activeProducts.map((product) => product.id));
  const fallbackProduct = CURRENT_PRODUCT || PRODUCTS.find(Boolean) || { id: 'cujasa', name: 'CUJASA', description: '쿠팡 파트너스 자동화 콘솔' };
  const visibleProducts = activeProducts.length ? activeProducts : [fallbackProduct];
  const otherProducts = PRODUCTS.filter((product) => product?.id && !grantedProductIds.has(product.id));
  const selectedProduct = visibleProducts.find((product) => product?.id === selectedProductId)
    || (activeActionKey === selectedProductId ? otherProducts.find((product) => product?.id === selectedProductId) : null)
    || visibleProducts[0]
    || productById(selectedProductId)
    || fallbackProduct;
  const productGrantById = useMemo(() => Object.fromEntries(userProducts.filter(Boolean).map((grant) => [grant.productId, grant])), [userProducts]);
  const selectedProductGrant = productGrantById[selectedProduct.id];
  const selectedProductGranted = grantedProductIds.has(selectedProduct.id);
  const selectedProductUsage = getGrantUsage(selectedProductGrant, selectedProduct.id);
  const selectedProductPreparing = selectedProduct.status === 'preparing' || isProductInMaintenance(selectedProduct);
  const productActions = selectedProductGranted && !selectedProductPreparing ? (productTaskActions[selectedProduct.id] || []) : [];
  const activeAction = actions.find((action) => action.key === activeActionKey) || null;
  const needsThreadsReconnect = selectedProduct.id === CURRENT_PRODUCT.id
    && account?.id
    && (!account.has_threads_access_token || (account.threads_token_status && account.threads_token_status !== 'connected'));

  useEffect(() => {
    if (initialUrlProductHandledRef.current) return;
    const urlProductId = productById(new URLSearchParams(window.location.search).get('product'))?.id || productIdFromPath(window.location.pathname);
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

    const previewProductIds = ['dexor', 'spread', 'polibot', 'infludex', 'sublog', 'auvibot'];
    const productId = action.productId || (previewProductIds.includes(action.key) ? action.key : '');
    const actionProduct = productById(productId);
    if (isProductInMaintenance(actionProduct)) {
      setSelectedProductId(productId);
      setActiveActionKey('');
      setShowOtherProducts(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const actionKey = params.get('action');
    if (!actionKey) return;
    const marker = `${account?.id || 'no-account'}:${actionKey}`;
    if (urlActionHandledRef.current === marker) return;
    if (!actions.some((item) => item.key === actionKey)) return;
    urlActionHandledRef.current = marker;
    openWorkspaceAction(actionKey);
  }, [account?.id, grantedProductIds, selectedProductId, oauthReturn?.at]);

  const applyAssistantResult = (result, fallbackValue = '') => {
    if (!result) return false;
    const actionKey = result.action || result.recommendedAction || '';
    if (isTestAssistantUser && result.workflow?.key) {
      setAssistantWorkflow({
        enabled: true,
        key: result.workflow.key,
        state: {
          productId: result.workflow.productId || result.productId || '',
          action: result.workflow.action || actionKey || '',
          draft: result.workflow.draft || result.draft || {},
          missingFields: result.workflow.missingFields || result.missingFields || [],
          nextQuestions: result.workflow.nextQuestions || result.nextQuestions || [],
          nextField: result.workflow.nextField || '',
          readyToSubmit: Boolean(result.workflow.readyToSubmit || result.readyToSubmit),
          stateSummary: result.workflow.stateSummary || ''
        },
        updatedAt: Date.now()
      });
    }
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
    setActiveActionKey(isProductInMaintenance(product) ? '' : product.id);
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

    const logAssistantEvent = (eventName, payload = {}) => {
      postEvent('/api/workspace-assistant/event', {
        event: eventName,
        message: value,
        durationMs: Date.now() - now,
        payload: {
          currentProduct: selectedProduct.id,
          currentAction: activeActionKey,
          ...payload
        }
      });
    };

    setAssistantLoading(true);
    try {
      const assistantStartedAt = Date.now();
      const assistant = await api.post('/api/workspace-assistant/message', {
        message: value,
        currentProduct: selectedProduct.id,
        currentAction: activeActionKey,
        availableProducts: activeProducts.map((product) => product.id),
        currentTasks: productActions.map((item) => ({ key: item.key, label: item.label })),
        assistantWorkflow: isTestAssistantUser
          ? {
            enabled: true,
            key: assistantWorkflow?.key || (selectedProduct.id === 'polibot' || activeActionKey === 'polibot-recommend' ? 'polibot_recommendation' : ''),
            state: assistantWorkflow?.state || null
          }
          : null
      });
      if (Date.now() - assistantStartedAt > 3000) {
        logAssistantEvent('workspace_assistant_slow_ai', { durationMs: Date.now() - assistantStartedAt });
      }
      if (applyAssistantResult(assistant, value)) return;
    } catch (err) {
      console.warn('[workspace-assistant-fallback]', err.message);
      logAssistantEvent('workspace_assistant_fallback', { reason: err.message || 'client_ai_error' });
    } finally {
      setAssistantLoading(false);
    }
    const examples = selectedProduct.id === 'polibot'
      ? '“37세 남성 암보험 추천”, “폴리봇 자료 뭐 있어?”, “추천 왜 안 돼?”처럼 입력해보세요.'
      : selectedProduct.id === 'dexor'
        ? '“맛집 블로그 후보 분석해줘”, “등급 분석 열어줘”, “결과 다운로드”처럼 입력해보세요.'
        : selectedProduct.id === 'spread'
          ? '“인스타 캠페인 추천해줘”, “참여자 선정 열어줘”, “제출물 검수”처럼 입력해보세요.'
          : selectedProduct.id === 'auvibot'
            ? '“오늘 차량/데스크 쪽으로만 돌려줘”, “뷰티 제외”, “밝은 영상 위주로”, “성과 좋은 훅으로 다시 만들어줘”처럼 입력해보세요.'
            : '“쿠팡 API 어디에 넣어?”, “무료체험 몇 번?”, “Threads 연결 안돼”, “3040 여성 반말로 주방용품 포스팅”처럼 입력해보세요.';
    setMessages((prev) => [
      ...prev,
      {
        id: `assistant-${Date.now() + 1}`,
        role: 'assistant',
        content: `아직 정확히 맞는 답변을 찾지 못했어요. ${examples}`,
        actions: [
          { label: selectedProduct.id === 'polibot' ? '상품 추천' : '설정 열기', actionKey: selectedProduct.id === 'polibot' ? 'polibot-recommend' : 'settings' },
          { label: selectedProduct.id === 'polibot' ? '자료 확인' : '자동화 실행', actionKey: selectedProduct.id === 'polibot' ? 'polibot-upload' : 'run' }
        ]
      }
    ].slice(-6));
    logAssistantEvent('workspace_assistant_fallback', { intent: 'local_examples' });
  };

  return (
    <div className="h-screen overflow-hidden bg-[#111111] text-zinc-100 supports-[height:100dvh]:h-dvh">
      <div className="grid h-screen min-w-0 supports-[height:100dvh]:h-dvh lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-hidden border-r border-white/10 bg-[#191919] px-4 py-5 lg:block">
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
                    {selectedProduct.name}는 서비스 점검 중이에요. 목록에는 표시하지만 배포 환경 기능은 안정화 후 다시 열어둘게요.
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
                  <button
                    type="button"
                    onClick={accountCreation?.open}
                    disabled={!accountCreation?.canAdd || accountCreation?.adding}
                    className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs font-black text-zinc-400 hover:border-white/25 hover:bg-white/5 hover:text-zinc-100 disabled:cursor-not-allowed disabled:border-white/5 disabled:text-zinc-700"
                  >
                    <Plus size={14} />
                    계정 추가
                  </button>
                  {!accountCreation?.canAdd && (
                    <div className="px-3 text-[11px] font-bold text-zinc-700">
                      계정 {accountCreation?.count ?? accounts.length}/{accountCreation?.maxAccounts ?? currentUser?.maxAccounts ?? 2} 한도
                    </div>
                  )}
                  {accountCreation?.show && <BetaAccountAddForm accountCreation={accountCreation} />}
                  {accounts.length === 0 && (
                    <div className="rounded-xl px-3 py-2 text-xs leading-relaxed text-zinc-600">
                      연결된 CUJASA 계정이 없어요. 새 계정을 추가한 뒤 Threads를 연결해 주세요.
                    </div>
                  )}
                </SidebarGroup>
              ) : (
                <SidebarGroup label={`${selectedProduct.name} 상태`}>
                  {selectedProduct.id === 'auvibot' ? (
                    <div className="rounded-xl bg-black/20 px-3 py-3">
                      <div className="text-xs font-bold text-zinc-500">작업 상태</div>
                      <div className="mt-1 text-sm font-black text-zinc-100">자동화 준비</div>
                      <div className="mt-1 text-[11px] text-zinc-600">설정 확인 후 실행할 수 있어요.</div>
                    </div>
                  ) : (
                    <div className="rounded-xl bg-black/20 px-3 py-3">
                      <div className="text-xs font-bold text-zinc-500">남은 사용</div>
                      <div className="mt-1 text-2xl font-black text-zinc-100">{usageRemainingLabel(selectedProductUsage)}</div>
                      <div className="mt-1 text-[11px] text-zinc-600">{usageSummaryLabel(selectedProductUsage)}</div>
                    </div>
                  )}
                </SidebarGroup>
              )}
            </div>

            <div ref={accountMenuRef} className="relative border-t border-white/10 pt-3">
              <AccountSummaryMenu
                currentUser={currentUser}
                product={selectedProduct}
                account={account}
                open={accountMenuOpen}
                active={activeActionKey === 'account-settings'}
                onOpenAccount={() => {
                  setAccountMenuOpen(false);
                  openWorkspaceAction('account-settings');
                }}
                onToggleMenu={() => setAccountMenuOpen((prev) => !prev)}
                onOpenBilling={() => {
                  setAccountMenuOpen(false);
                  openWorkspaceAction('billing');
                }}
                onOpenSupport={() => {
                  setAccountMenuOpen(false);
                  setSupportInfoOpen(true);
                }}
                onOpenPrivacy={() => {
                  setAccountMenuOpen(false);
                  setPrivacyOpen(true);
                }}
                onOpenBusiness={() => {
                  setAccountMenuOpen(false);
                  setBusinessInfoOpen(true);
                }}
                onLogout={() => {
                  setAccountMenuOpen(false);
                  onLogout?.();
                }}
              />
              <div className="px-2 pt-3 text-[11px] font-bold leading-none text-zinc-700">© 2026 JASAIN</div>
            </div>
          </div>
        </aside>

        <main className="relative flex h-screen min-h-0 min-w-0 flex-col overflow-hidden supports-[height:100dvh]:h-dvh">
          <header className="shrink-0 border-b border-white/10 px-4 py-2.5 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white">
                  <img src="/jasain_logo.png" alt="JASAIN" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black">{selectedProduct.name}</div>
                  <div className="truncate text-xs text-zinc-500">{account?.name || 'JASAIN 워크스페이스'}</div>
                </div>
              </div>
              <button type="button" onClick={() => openWorkspaceAction('account-settings')} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-400">
                계정
              </button>
            </div>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
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
            {selectedProduct.id === CURRENT_PRODUCT.id && accounts.length > 0 && messages.length === 0 && (
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

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3 pb-3 lg:px-10 lg:py-4">
            <div className={`mx-auto min-h-0 w-full max-w-5xl flex-1 overflow-hidden ${messages.length > 0 ? 'grid grid-rows-[minmax(0,1fr)_auto]' : 'flex flex-col justify-start pt-[13vh] sm:pt-[16vh] lg:pt-[18vh]'}`}>
              {messages.length === 0 && (
              <div className="text-center">
                <div className="mx-auto mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-400 lg:mb-5">
                  <Bot size={14} />
                  {selectedProduct.name}
                </div>
                <h1 className="text-[28px] font-semibold leading-tight tracking-normal text-zinc-100 sm:text-5xl">무엇을 자동화할까요?</h1>
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
                {selectedProductPreparing && (
                  <div className="mx-auto mt-5 max-w-xl rounded-3xl border border-amber-300/20 bg-amber-400/10 px-5 py-4 text-left">
                    <div className="text-sm font-black text-amber-100">{selectedProduct.name} 서비스 점검 중</div>
                    <p className="mt-2 text-xs leading-relaxed text-amber-100/70">
                      테스트 환경에서는 계속 확인할 수 있고, 배포 환경에서는 안정화가 끝날 때까지 잠시 닫아둘게요.
                    </p>
                  </div>
                )}
              </div>
              )}

              {messages.length > 0 && (
                <section className="min-h-0 overflow-y-auto px-1 py-3 text-left lg:py-5">
                  <div className="mx-auto flex w-full max-w-2xl flex-col gap-3.5 lg:gap-4">
                    {(() => {
                      let previousAssistantContent = '';
                      return messages.map((message) => {
                        const repeatedAssistant = message.role === 'assistant' && message.content === previousAssistantContent;
                        if (message.role === 'assistant') previousAssistantContent = message.content;
                        return (
                          <BetaChatMessage
                            key={message.id}
                            message={message}
                            repeatedAssistant={repeatedAssistant}
                            onOpenAction={openWorkspaceAction}
                          />
                        );
                      });
                    })()}
                    {isTestAssistantUser && assistantWorkflow?.state && (
                      <TestAssistantWorkflowStatus workflow={assistantWorkflow.state} onOpenAction={openWorkspaceAction} />
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </section>
              )}

              <form onSubmit={submitPrompt} className={`mx-auto w-full max-w-2xl min-w-0 ${messages.length > 0 ? 'pt-2 lg:pb-1' : 'mt-5 lg:mt-5'}`}>
                <div className="rounded-[22px] border border-white/10 bg-[#202020] px-3 py-2 shadow-xl shadow-black/25 transition focus-within:border-white/20">
                  <div className="flex items-end gap-2">
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
                      rows={1}
                      placeholder="작업을 입력해 주세요"
                      className="max-h-28 min-h-[38px] flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:cursor-wait disabled:opacity-60 sm:text-[15px]"
                    />
                    <button type="submit" disabled={assistantLoading} className="mb-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-950 hover:bg-white disabled:cursor-wait disabled:opacity-60">
                      <ChevronRight size={19} />
                    </button>
                  </div>
                  {assistantLoading && (
                    <div className="px-1 pb-0.5 pt-1 text-[11px] font-bold text-zinc-600">JASAIN Assistant가 확인 중이에요...</div>
                  )}
                </div>
              </form>

              <div className={`mx-auto mt-3 flex w-full max-w-4xl gap-2 overflow-x-auto pb-2 lg:hidden ${messages.length > 0 ? 'hidden' : ''}`}>
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
              onOpenPrivacy={() => setPrivacyOpen((prev) => !prev)}
              onStartProduct={startProduct}
              onOpenAction={openWorkspaceAction}
              onRequestBillingAgreement={setAgreementIntent}
              startingProductId={startingProductId}
              accountCreation={accountCreation}
              closing={drawerClosing}
              onClose={closeDrawer}
            />
          )}
          {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
          {businessInfoOpen && <BusinessInfoModal onClose={() => setBusinessInfoOpen(false)} />}
          {supportInfoOpen && <SupportInfoModal onClose={() => setSupportInfoOpen(false)} />}
          {agreementIntent && (
            <BillingAgreementModal
              product={agreementIntent.product}
              flow={agreementIntent.flow}
              busy={agreementIntent.busy}
              onCancel={() => setAgreementIntent(null)}
              onConfirm={agreementIntent.onConfirm}
            />
          )}
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

function accountInitials(currentUser = {}) {
  const label = String(currentUser?.username || currentUser?.email || 'JASAIN').trim();
  const parts = label.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : label.slice(0, 2)).toUpperCase();
}

function accountPlanLabel(currentUser = {}, product = {}) {
  const products = Array.isArray(currentUser?.products) ? currentUser.products : [];
  const currentGrant = products.find((grant) => grant.productId === product?.id && grant.status !== 'suspended');
  if (currentGrant?.status === 'trial') return 'Trial';
  if (currentGrant?.status === 'active') return 'Active';
  if (currentGrant?.status) return currentGrant.status;
  if (products.some((grant) => grant.status !== 'suspended')) return 'Active';
  return product?.name || 'JASAIN';
}

function AccountSummaryMenu({
  currentUser,
  product,
  account,
  open,
  active = false,
  onOpenAccount,
  onToggleMenu,
  onOpenBilling,
  onOpenSupport,
  onOpenPrivacy,
  onOpenBusiness,
  onLogout
}) {
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState(null);
  const [submenuPosition, setSubmenuPosition] = useState(null);
  const cardRef = useRef(null);
  const menuRef = useRef(null);
  const submenuRef = useRef(null);
  const rowRefs = useRef({});
  const displayName = currentUser?.username || currentUser?.email || 'JASAIN 계정';
  const plan = accountPlanLabel(currentUser, product);
  const menuItems = useMemo(() => [
    { key: 'account', icon: UserCircle, label: '계정 정보', sub: account?.name || currentUser?.email || '', actions: [{ label: '계정 정보 열기', onClick: onOpenAccount }] },
    { key: 'billing', icon: CreditCard, label: '결제', sub: plan, actions: [{ label: '결제 관리 열기', onClick: onOpenBilling }] },
    { key: 'support', icon: Bot, label: '고객센터', sub: '문의와 도움말', actions: [{ label: '고객센터 열기', onClick: onOpenSupport }] },
    { key: 'privacy', icon: ShieldCheck, label: '개인정보처리방침', sub: '처리 기준', onClick: onOpenPrivacy },
    { key: 'business', icon: Landmark, label: '사업자정보', sub: '회사 정보', actions: [{ label: '사업자정보 열기', onClick: onOpenBusiness }] },
    { key: 'logout', icon: LogOut, label: '로그아웃', sub: '현재 세션 종료', onClick: onLogout }
  ], [account?.name, currentUser?.email, onOpenAccount, onOpenBilling, onOpenBusiness, onOpenPrivacy, onOpenSupport, onLogout, plan]);
  const activeItem = menuItems.find((item) => item.key === activeSubmenu && item.actions?.length);
  const setRowRef = (key) => (node) => {
    if (node) rowRefs.current[key] = node;
    else delete rowRefs.current[key];
  };
  const closeMenuAction = (handler) => {
    handler?.();
    setActiveSubmenu(null);
    if (open) onToggleMenu?.();
  };

  useEffect(() => {
    if (!open) setActiveSubmenu(null);
  }, [open]);

  const updateMenuPosition = useCallback(() => {
    if (!open || !cardRef.current || typeof window === 'undefined') return;
    const margin = 12;
    const cardRect = cardRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(cardRect.width, 260), viewportWidth - (margin * 2));
    const left = Math.min(Math.max(cardRect.left, margin), viewportWidth - width - margin);
    const measuredHeight = menuRef.current?.offsetHeight || 432;
    const availableAbove = Math.max(120, cardRect.top - (margin * 2));
    const maxHeight = Math.min(measuredHeight, availableAbove, viewportHeight - (margin * 2));
    const top = Math.max(margin, cardRect.top - maxHeight - 12);
    setMenuPosition((current) => {
      const next = { left, top, width, maxHeight };
      return current
        && Math.abs(current.left - next.left) < 1
        && Math.abs(current.top - next.top) < 1
        && Math.abs(current.width - next.width) < 1
        && Math.abs(current.maxHeight - next.maxHeight) < 1
        ? current
        : next;
    });
  }, [open]);

  const updateSubmenuPosition = useCallback(() => {
    if (!open || !activeItem || !menuPosition || typeof window === 'undefined') {
      setSubmenuPosition(null);
      return;
    }
    const row = rowRefs.current[activeItem.key];
    const menu = menuRef.current;
    if (!row || !menu) return;
    const margin = 12;
    const rowRect = row.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const submenuWidth = 212;
    const measuredHeight = submenuRef.current?.offsetHeight || 104;
    const canOpenRight = menuRect.right + margin + submenuWidth <= viewportWidth - margin;
    const canOpenLeft = menuRect.left - margin - submenuWidth >= margin;

    if (!canOpenRight && !canOpenLeft) {
      setSubmenuPosition((current) => current?.mode === 'inline' ? current : { mode: 'inline' });
      return;
    }

    const left = canOpenRight
      ? menuRect.right + margin
      : menuRect.left - margin - submenuWidth;
    const top = Math.min(
      Math.max(rowRect.top, margin),
      viewportHeight - measuredHeight - margin
    );
    setSubmenuPosition((current) => {
      const next = { mode: 'floating', left, top, width: submenuWidth };
      return current?.mode === next.mode
        && Math.abs(current.left - next.left) < 1
        && Math.abs(current.top - next.top) < 1
        && Math.abs(current.width - next.width) < 1
        ? current
        : next;
    });
  }, [activeItem, menuPosition, open]);

  useLayoutEffect(() => {
    updateMenuPosition();
  }, [updateMenuPosition]);

  useLayoutEffect(() => {
    updateSubmenuPosition();
  }, [updateSubmenuPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleViewportChange = () => {
      updateMenuPosition();
      updateSubmenuPosition();
    };
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateMenuPosition, updateSubmenuPosition]);

  const menuPortal = open && menuPosition && typeof document !== 'undefined'
    ? createPortal(
      <>
        <div
          ref={menuRef}
          onMouseDown={(event) => event.stopPropagation()}
          className="fixed z-[35] overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl shadow-black/50 backdrop-blur"
          style={{
            left: `${menuPosition.left}px`,
            top: `${menuPosition.top}px`,
            width: `${menuPosition.width}px`,
            maxHeight: `${menuPosition.maxHeight}px`
          }}
        >
          <div className="grid gap-1">
            {menuItems.map((item) => (
              <div key={item.key}>
                <SidebarFooterButton
                  itemRef={setRowRef(item.key)}
                  icon={item.icon}
                  label={item.label}
                  sub={item.sub}
                  onClick={item.actions?.length ? () => setActiveSubmenu((current) => current === item.key ? null : item.key) : () => closeMenuAction(item.onClick)}
                  onChevronClick={item.actions?.length ? () => setActiveSubmenu((current) => current === item.key ? null : item.key) : null}
                  active={activeSubmenu === item.key}
                  chevron={Boolean(item.actions?.length)}
                />
                {activeSubmenu === item.key && activeItem && submenuPosition?.mode === 'inline' && (
                  <div className="mx-2 mb-1 mt-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
                    {activeItem.actions.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        onClick={() => closeMenuAction(action.onClick)}
                        className="w-full rounded-xl px-3 py-2 text-left text-sm font-black text-zinc-300 transition hover:bg-white/10 hover:text-white"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {activeItem && submenuPosition?.mode === 'floating' && (
          <div
            ref={submenuRef}
            onMouseDown={(event) => event.stopPropagation()}
            className="fixed z-[36] rounded-3xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl shadow-black/50 backdrop-blur"
            style={{
              left: `${submenuPosition.left}px`,
              top: `${submenuPosition.top}px`,
              width: `${submenuPosition.width}px`
            }}
          >
            <div className="mb-1 px-3 py-2 text-xs font-black text-zinc-500">{activeItem.label}</div>
            <div className="grid gap-1">
              {activeItem.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => closeMenuAction(action.onClick)}
                  className="rounded-2xl px-3 py-2 text-left text-sm font-black text-zinc-300 transition hover:bg-white/10 hover:text-white"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </>,
      document.body
    )
    : null;

  return (
    <div ref={cardRef} className="relative">
      {menuPortal}
      <div>
        <button
          type="button"
          onClick={onToggleMenu}
          className={`grid w-full grid-cols-[42px_minmax(0,1fr)_42px] items-center gap-3 rounded-3xl px-3 py-3 text-left transition hover:bg-white/10 ${active ? 'bg-white/15 ring-1 ring-white/15' : 'bg-white/5'}`}
          aria-label="계정 메뉴 열기"
          aria-expanded={open}
        >
          <span className={`grid h-10 w-10 place-items-center rounded-full text-sm font-black ${active ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-700 text-zinc-100'}`}>
            {accountInitials(currentUser)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black text-zinc-100">{displayName}</span>
            <span className="mt-0.5 block truncate text-xs font-bold text-zinc-500">{plan}</span>
          </span>
          <span aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleMenu?.();
          }}
          className={`absolute right-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full transition hover:bg-white/10 hover:text-zinc-100 ${open ? 'bg-white/10 text-zinc-100' : 'bg-white/5 text-zinc-400'}`}
          aria-label="계정 메뉴 열기"
          aria-expanded={open}
        >
          <ChevronRight size={17} className={`transition ${open ? '-rotate-90 text-zinc-200' : ''}`} />
        </button>
      </div>
    </div>
  );
}

function SidebarFooterButton({ itemRef, icon: Icon, label, sub = '', onClick, onChevronClick, chevron = false, active = false }) {
  return (
    <div
      ref={itemRef}
      className={`grid min-h-11 w-full grid-cols-[28px_minmax(0,1fr)_28px] items-center rounded-2xl px-3 py-2 text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100 ${active ? 'bg-white/10 text-zinc-100' : ''}`}
    >
      <span className="grid h-7 w-7 place-items-center">
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <button type="button" onClick={onClick} className="min-w-0 text-left">
        <span className="block truncate text-sm font-bold">{label}</span>
        {sub && <span className="mt-0.5 block truncate text-[11px] font-bold text-zinc-600">{sub}</span>}
      </button>
      {chevron ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onChevronClick?.();
          }}
          className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/10"
          aria-label={`${label} 하위 메뉴 열기`}
        >
          <ChevronRight size={14} className={`transition ${active ? 'text-zinc-100' : ''}`} />
        </button>
      ) : <span aria-hidden="true" />}
    </div>
  );
}

function BetaChatMessage({ message, repeatedAssistant = false, onOpenAction }) {
  const isUser = message.role === 'user';
  const handleAction = (action) => {
    if (action.actionKey) onOpenAction(action.actionKey);
  };
  const actions = Array.isArray(message.actions)
    ? message.actions.filter((action, index, list) => (
      action?.label && list.findIndex((item) => item?.label === action.label) === index
    )).slice(0, 3)
    : [];

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(78%,520px)] rounded-[20px] border border-white/10 bg-zinc-100 px-4 py-2.5 text-sm font-bold leading-relaxed text-zinc-950 shadow-lg shadow-black/20">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <article className={`px-1 py-2 ${repeatedAssistant ? 'opacity-85' : ''}`}>
      <div className="whitespace-pre-wrap text-[15px] font-semibold leading-[1.8] text-zinc-200">
        {message.content}
      </div>
      <div className="min-w-0">
          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2.5">
              {actions.map((action) => (
                <button
                  key={`${message.id}-${action.label}`}
                  type="button"
                  onClick={() => handleAction(action)}
                  className="inline-flex h-9 items-center rounded-full border border-white/10 bg-white/[0.03] px-3.5 text-xs font-black text-zinc-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
      </div>
    </article>
  );
}

function TestAssistantWorkflowStatus({ workflow, onOpenAction }) {
  const missing = Array.isArray(workflow.missingFields) ? workflow.missingFields : [];
  const required = missing.filter((field) => field.importance === 'required');
  const confirm = missing.filter((field) => field.importance === 'confirm');
  const nextQuestion = Array.isArray(workflow.nextQuestions) ? workflow.nextQuestions[0] : '';
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-black text-zinc-100">테스트 대화 상태</span>
        {workflow.readyToSubmit ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-200">초안 가능</span>
        ) : (
          <span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-black text-red-200">필수 {required.length}</span>
        )}
        {confirm.length > 0 && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-200">확인 {confirm.length}</span>}
      </div>
      {workflow.stateSummary && <div className="mt-2 text-xs leading-relaxed text-zinc-500">{workflow.stateSummary}</div>}
      {nextQuestion && <div className="mt-2 rounded-2xl bg-black/25 px-3 py-2 text-xs font-bold leading-relaxed text-zinc-300">{nextQuestion}</div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onOpenAction('polibot-recommend')}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-300 hover:bg-white/10 hover:text-white"
        >
          상품 추천 열기
        </button>
      </div>
    </div>
  );
}

function TaskDrawer(props) {
  const { action, loadError, closing, onClose } = props;
  const Icon = action.icon;
  const compactPreview = ['dexor', 'spread', 'polibot', 'infludex', 'sublog'].includes(action.key);
  const wideBilling = action.key === 'billing';
  const wideWorkspace = action.key === 'polibot-recommend';
  const desktopWidthClass = wideBilling
      ? 'lg:w-[min(1180px,calc(100vw-340px))]'
      : wideWorkspace
      ? 'lg:w-[min(1280px,calc(100vw-324px))] xl:w-[min(1380px,calc(100vw-332px))]'
      : 'lg:w-[min(640px,calc(100vw-340px))]';
  const mobileWidthClass = wideBilling || wideWorkspace ? 'w-[min(1120px,96vw)]' : 'w-[min(420px,92vw)]';

  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-300 lg:pointer-events-none ${closing ? 'bg-black/0 opacity-0 lg:bg-transparent' : 'bg-black/45 opacity-100 lg:bg-transparent'}`}>
      <button type="button" aria-label="닫기" className="absolute inset-0 lg:hidden" onClick={onClose} />
      <aside className={`pointer-events-auto absolute inset-y-0 right-0 ${mobileWidthClass} overflow-y-auto rounded-l-[28px] border-l border-white/10 bg-[#191919] p-4 shadow-2xl shadow-black/50 transition-all duration-300 ease-out lg:left-auto lg:right-4 ${desktopWidthClass} lg:rounded-[28px] lg:border lg:p-5 ${compactPreview ? 'lg:top-16 lg:bottom-auto lg:max-h-[calc(100vh-8rem)]' : 'lg:inset-y-4 lg:max-h-none'} ${closing ? 'translate-x-full opacity-0 lg:translate-x-8 lg:translate-y-0' : 'translate-x-0 opacity-100'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/10 text-zinc-100">
              <Icon size={19} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-lg font-black text-zinc-100">
                {action.label}
                {action.key === 'trend-references' && (
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-100">
                    beta
                  </span>
                )}
              </div>
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
          {action.key === 'trend-references' && <TrendReferencesPanel {...props} />}
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
          {action.key === 'polibot-upload' && <PolibotUploadPanel currentUser={props.currentUser} onOpenAction={props.onOpenAction} />}
          {action.key === 'polibot-recommend' && <PolibotRecommendPanel assistantDraft={props.assistantDraft} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} currentUser={props.currentUser} />}
          {action.key === 'polibot-customers' && <PolibotCustomersPanel />}
          {action.key === 'polibot-download' && <PolibotDownloadPanel />}
          {action.key === 'infludex-upload' && <InfludexUploadPanel onOpenGrade={() => props.onOpenAction?.('infludex-grade')} />}
          {action.key === 'infludex-grade' && <InfludexGradePanel reloadCurrentUser={props.reloadCurrentUser} onOpenUpload={() => props.onOpenAction?.('infludex-upload')} />}
          {action.key === 'infludex-download' && <InfludexDownloadPanel onOpenUpload={() => props.onOpenAction?.('infludex-upload')} />}
          {action.key === 'sublog-dashboard' && <SublogPanel currentUser={props.currentUser} />}
          {action.key === 'auvibot-run' && <AuvibotPanel mode="run" account={props.account} reloadAccounts={props.reloadAccounts} accountCreation={props.accountCreation} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} />}
          {action.key === 'auvibot-settings' && <AuvibotPanel mode="settings" account={props.account} reloadAccounts={props.reloadAccounts} accountCreation={props.accountCreation} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} />}
          {action.key === 'auvibot-video-learning' && <AuvibotPanel mode="learning" account={props.account} reloadAccounts={props.reloadAccounts} accountCreation={props.accountCreation} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} />}
          {action.key === 'auvibot-posts' && <AuvibotPanel mode="posts" account={props.account} reloadAccounts={props.reloadAccounts} accountCreation={props.accountCreation} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} />}
          {action.key === 'auvibot-analytics' && <AuvibotPanel mode="analytics" account={props.account} reloadAccounts={props.reloadAccounts} accountCreation={props.accountCreation} reloadCurrentUser={props.reloadCurrentUser} onOpenAction={props.onOpenAction} />}
          {['dexor', 'spread', 'polibot', 'infludex', 'sublog', 'auvibot'].includes(action.key) && <ProductPreview action={action} onStartProduct={props.onStartProduct} starting={props.startingProductId === action.key} />}
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
  onPipelineRunningChange,
  onOpenAction
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
      toast('무료 사용이 종료되었어요. 결제 후 계속 이용할 수 있어요.', 'error');
      onOpenAction?.('billing');
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
          <DarkButton variant="ghost" onClick={() => runPreflight()} disabled={checking || actioning} loading={checking} loadingLabel="점검 중">
            사전 점검
          </DarkButton>
          <DarkButton onClick={() => setAutomation(automationRunning ? 'paused' : 'running')} disabled={checking || actioning} loading={actioning} loadingLabel="처리 중">
            {automationRunning
              ? <span className="inline-flex items-center justify-center gap-2"><PauseCircle size={18} /> 자동화 중지</span>
              : '자동화 시작'}
          </DarkButton>
        </div>
      </PanelCard>

      <ViralCaptureTestPanel account={account} mode="image" />
      <ViralCaptureTestPanel account={account} mode="video" />

      {runError && <Notice tone="error">{runError}</Notice>}
    </>
  );
}

function ViralCaptureTestPanel({ account, mode = 'image' }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const isVideo = mode === 'video';
  const capturedImageUrls = Array.isArray(result?.captureImageUrls)
    ? result.captureImageUrls.filter(Boolean)
    : [];
  const fallbackPreviewUrls = !capturedImageUrls.length && result?.capturePreview
    ? [result.capturePreview]
    : [];
  const previewImageUrls = capturedImageUrls.length ? capturedImageUrls : fallbackPreviewUrls;

  const normalizedUrl = url.trim();
  const canRun = Boolean(normalizedUrl && account?.id && !running);

  const runCapture = async () => {
    if (!account?.id) {
      toast('먼저 계정을 선택해주세요.', 'error');
      return;
    }
    let parsed;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      toast('인기글 URL을 정확히 입력해주세요.', 'error');
      setError('인기글 URL을 정확히 입력해주세요.');
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      toast('http 또는 https URL만 사용할 수 있어요.', 'error');
      setError('http 또는 https URL만 사용할 수 있어요.');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const payload = await api.post(isVideo
        ? '/api/product-workspace/cujasa/viral-capture-video-run'
        : '/api/product-workspace/cujasa/viral-capture-run', {
        accountId: account.id,
        url: parsed.toString()
      }, { timeoutMs: 90000 });
      setResult(payload);
      toast('포스팅을 올렸어요.', 'success');
    } catch (err) {
      const message = err.message || '실행에 실패했어요.';
      setError(message);
      toast(message, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <PanelCard
      title={(
        <span className="inline-flex items-center gap-2">
          인기글 포스팅{isVideo ? '(동영상)' : '(이미지)'}
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-200">
            beta
          </span>
        </span>
      )}
    >
      <div className="mt-4 space-y-3">
        <label className="block">
          <input
            className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-zinc-100 outline-none transition placeholder:text-zinc-700 focus:border-zinc-500"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError('');
            }}
            placeholder="https://www.threads.com/@..."
          />
        </label>

        <div className="flex gap-2">
          <DarkButton onClick={runCapture} disabled={!canRun} loading={running} loadingLabel="실행 중">
            실행하기
          </DarkButton>
        </div>
        <div className="text-xs font-bold text-zinc-600">계정당 하루 1회 사용 가능</div>

        {result?.post && (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            <div className="font-black">포스팅 완료</div>
            {result.videoUrl && (
              <video
                className="mt-3 max-h-80 w-full rounded-2xl border border-white/10 bg-black object-contain"
                src={result.videoUrl}
                controls
                playsInline
              />
            )}
            {!isVideo && previewImageUrls.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-black text-emerald-200">
                  캡처 이미지 {result.capturedImageCount || previewImageUrls.length}장
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {previewImageUrls.map((imageUrl, index) => (
                    <img
                      key={`${imageUrl}-${index}`}
                      className="aspect-square w-full rounded-2xl border border-white/10 bg-black object-contain"
                      src={imageUrl}
                      alt={`캡처된 인기글 ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 whitespace-pre-wrap leading-relaxed text-emerald-50">{result.post.body}</div>
            {result.postUrl && (
              <a className="mt-3 block break-all text-xs font-bold text-emerald-200 underline" href={result.postUrl} target="_blank" rel="noreferrer">
                {result.postUrl}
              </a>
            )}
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </PanelCard>
  );
}

function BetaSettingsPanel({ account, trialStatus, setupStatus, reloadAccounts, reloadSetupStatus, reloadWorkspaceData, settingsDraft }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [connectingThreads, setConnectingThreads] = useState(false);
  const [threadsRequests, setThreadsRequests] = useState([]);
  const [threadsRequestMemo, setThreadsRequestMemo] = useState('');
  const [requestingThreads, setRequestingThreads] = useState(false);
  const [requestingSetup, setRequestingSetup] = useState(false);
  const [confirmingThreadsApproval, setConfirmingThreadsApproval] = useState(false);
  const [appliedDraftId, setAppliedDraftId] = useState(null);
  const [contentAdvancedOpen, setContentAdvancedOpen] = useState(false);
  const [blogDetailsOpen, setBlogDetailsOpen] = useState(false);
  const [tossDetailsOpen, setTossDetailsOpen] = useState(false);
  const [threadsOAuthError, setThreadsOAuthError] = useState(null);
  const [threadsOAuthSuccess, setThreadsOAuthSuccess] = useState(null);

  useEffect(() => {
    if (!account) {
      setForm(null);
      return;
    }
    const activeTimeWindows = cujasaScheduleWindowsFromAccount(account);
    setForm({
      name: account.name || '',
      account_handle: account.account_handle || '',
      target_audience: account.target_audience || '',
      content_scope: account.content_scope || '',
      tone: account.tone || '',
      content_mode: account.content_mode || 'auto',
      content_intensity: account.content_intensity || 'normal',
      seasonality_enabled: account.seasonality_enabled !== false,
      comment_induction_style: account.comment_induction_style || 'soft_question',
      product_mention_style: account.product_mention_style || 'natural',
      emoji_level: account.emoji_level || 'low',
      safe_debate_enabled: Boolean(account.safe_debate_enabled),
      anonymous_learning_enabled: Boolean(account.anonymous_learning_enabled),
      blog_auto_publish_enabled: Boolean(account.blog_auto_publish_enabled),
      blog_publish_mode: account.blog_publish_mode || 'test_only',
      blog_base_url: account.blog_base_url || '',
      toss_share_link_enabled: Boolean(account.toss_share_link_enabled),
      toss_share_link_url: account.toss_share_link_url || '',
      toss_share_link_label: account.toss_share_link_label || '',
      toss_share_link_memo: account.toss_share_link_memo || '',
      content_style_note: account.content_style_note || '',
      forbidden_topics: Array.isArray(account.forbidden_topics) ? account.forbidden_topics.join('\n') : '',
      forbidden_words: Array.isArray(account.forbidden_words) ? account.forbidden_words.join('\n') : '',
      daily_post_max: clampDailyPostCount(account.daily_post_max, 3),
      active_time_windows: activeTimeWindows,
      first_upload_time: activeTimeWindows[0]?.start || '09:00',
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

  useEffect(() => {
    if (!account?.id || account.has_threads_access_token) {
      setThreadsRequests([]);
      return;
    }
    api.get(`/api/me/threads-connection-requests?accountId=${account.id}`)
      .then((rows) => setThreadsRequests(Array.isArray(rows) ? rows : []))
      .catch(() => setThreadsRequests([]));
  }, [account?.id, account?.has_threads_access_token]);

  useEffect(() => {
    if (!account?.id) {
      setThreadsOAuthError(null);
      setThreadsOAuthSuccess(null);
      return;
    }
    if (account.has_threads_access_token) {
      setThreadsOAuthError(null);
    }
    try {
      const rawError = sessionStorage.getItem(`cujasa:threadsOAuthError:${account.id}`);
      const rawSuccess = sessionStorage.getItem(`cujasa:threadsOAuthSuccess:${account.id}`);
      setThreadsOAuthError(account.has_threads_access_token ? null : rawError ? JSON.parse(rawError) : null);
      setThreadsOAuthSuccess(rawSuccess ? JSON.parse(rawSuccess) : null);
    } catch {
      setThreadsOAuthError(null);
      setThreadsOAuthSuccess(null);
    }
  }, [account?.id, account?.has_threads_access_token]);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const updateContentMode = (value) => setForm((prev) => ({
    ...prev,
    content_mode: value,
    safe_debate_enabled: value === 'safe_debate' ? true : prev.safe_debate_enabled
  }));

  const save = async () => {
    if (!account?.id || !form) return;
    setSaving(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, {
        ...form,
        blog_auto_publish_enabled: Boolean(account.blog_enabled && form.blog_auto_publish_enabled),
        daily_post_min: 0,
        daily_post_max: clampDailyPostCount(form.daily_post_max, 3),
        active_time_windows: buildCujasaScheduleWindows(form.active_time_windows, form.first_upload_time),
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
      const nextHandle = String(form?.account_handle || '').trim();
      if (nextHandle && nextHandle !== String(account.account_handle || '').trim()) {
        await api.patch(`/api/accounts/${account.id}`, { account_handle: nextHandle });
        await reloadAccounts?.();
      }
      const payload = await api.get(`/api/auth/threads/start?accountId=${account.id}`);
      if (payload?.url) window.location.href = payload.url;
    } catch (err) {
      setThreadsOAuthError({ message: err.message || 'Threads 연결을 시작하지 못했어요.', code: 'THREADS_OAUTH_START_FAILED', at: new Date().toISOString() });
      toast(err.message || 'Threads 연결을 시작하지 못했어요.', 'error');
      setConnectingThreads(false);
    }
  };

  const requestThreadsRegistration = async () => {
    if (!account?.id || !form?.account_handle?.trim()) {
      toast('연결할 Threads 핸들을 먼저 입력해 주세요.', 'error');
      return;
    }
    setRequestingThreads(true);
    try {
      const nextHandle = String(form.account_handle || '').trim();
      if (nextHandle !== String(account.account_handle || '').trim()) {
        await api.patch(`/api/accounts/${account.id}`, { account_handle: nextHandle });
      }
      const result = await api.post('/api/me/threads-connection-requests', {
        accountId: account.id,
        threadsHandle: nextHandle,
        requestMemo: threadsRequestMemo
      });
      setThreadsRequests((prev) => [result.request, ...prev.filter((row) => row.id !== result.request?.id)].filter(Boolean));
      await reloadAccounts?.();
      toast(result.alreadyExists ? '기존 Threads 등록 요청을 업데이트했어요.' : 'Threads 등록 요청을 보냈어요.', 'success');
    } catch (err) {
      toast(err.message || 'Threads 등록 요청을 보내지 못했어요.', 'error');
    } finally {
      setRequestingThreads(false);
    }
  };

  const copyBlogUrl = async () => {
    if (!account?.blog_public_url) return;
    try {
      await navigator.clipboard.writeText(account.blog_public_url);
      toast('블로그 주소를 복사했어요.', 'success');
    } catch {
      toast('주소를 복사하지 못했어요.', 'error');
    }
  };

  const requestSetup = async () => {
    setRequestingSetup(true);
    try {
      const missingItems = [...(setupStatus?.blocking || []), ...(setupStatus?.warnings || [])]
        .filter((entry) => !account?.id || !entry.accountId || entry.accountId === account.id)
        .map((entry) => entry.title)
        .filter(Boolean);
      const result = await api.post('/api/me/setup-request', {
        accountId: account?.id || null,
        message: missingItems.length ? `부족 항목: ${missingItems.join(', ')}` : ''
      });
      await reloadSetupStatus?.();
      toast(result.alreadyExists ? '이미 접수된 셋업 요청이 있어요. 관리자가 확인 중입니다.' : '관리자에게 셋업 요청을 보냈어요.', 'success');
    } catch (err) {
      toast(err.message || '셋업 요청을 보내지 못했어요.', 'error');
    } finally {
      setRequestingSetup(false);
    }
  };

  if (!form) return <Notice>계정 설정을 불러오는 중이에요.</Notice>;
  const activeThreadsRequest = threadsRequests
    .filter((row) => row && !['connected', 'canceled'].includes(row.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
  const threadsOAuthReady = account?.has_threads_access_token || activeThreadsRequest?.status === 'customer_action_required';
  const threadsStatusText = account?.has_threads_access_token
    ? '연결됨'
    : threadsOAuthError?.code === 'THREADS_META_PERMISSION_REQUIRED' || /댓글 권한|permission|권한/i.test(threadsOAuthError?.message || '')
      ? '댓글 권한 재연결 필요'
    : activeThreadsRequest?.status === 'customer_action_required'
      ? 'Meta 등록 완료 · 고객 승인 필요'
      : activeThreadsRequest?.status === 'requested'
        ? '관리자 등록 대기'
        : '미연결';

  return (
    <>
      {settingsDraft?.id === appliedDraftId && (
        <Notice>
          채팅에서 만든 설정 초안이에요. 타깃, 톤, 카테고리를 확인한 뒤 설정 저장을 눌러야 실제로 반영돼요.
        </Notice>
      )}
      {threadsOAuthSuccess?.message && (
        <Notice tone="success">
          {threadsOAuthSuccess.message} 연결 상태가 반영되지 않았다면 새로고침 후 다시 확인해 주세요.
        </Notice>
      )}

      <CujasaOnboardingChecklist account={account} form={form} activeThreadsRequest={activeThreadsRequest} />

      <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-black text-zinc-100">설정이 어렵다면 맡겨주세요</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
              접수되면 관리자 셋업 대기에 등록되고 담당자에게 알림이 갑니다.
            </p>
          </div>
          <DarkButton variant="ghost" size="sm" onClick={requestSetup} disabled={requestingSetup} loading={requestingSetup} loadingLabel="요청 중">
            <Settings size={15} />
            관리자에게 셋업 요청
          </DarkButton>
        </div>
      </div>

      <CollapsiblePanel title="Threads 연결">
        <div className="grid gap-3 rounded-2xl bg-black/25 px-4 py-3">
          <label className={labelClass}>
            Threads 핸들
            <input className={inputClass} value={form.account_handle} onChange={(event) => update('account_handle', event.target.value)} placeholder="@myhandle" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-black text-zinc-100">{threadsStatusText}</div>
              <div className="mt-1 text-xs text-zinc-500">{form.account_handle || account?.account_handle || 'Threads 핸들 미입력'}</div>
              {!account?.has_threads_access_token && threadsOAuthError?.message && (
                <div className="mt-2 max-w-xl rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-bold leading-relaxed text-red-100">
                  최근 연결 실패: {threadsOAuthError.message}
                  {threadsOAuthError.code ? <span className="ml-1 text-red-200/70">({threadsOAuthError.code})</span> : null}
                </div>
              )}
            </div>
            {threadsOAuthReady ? (
              <DarkButton variant="ghost" size="sm" onClick={() => setConfirmingThreadsApproval(true)} disabled={connectingThreads} loading={connectingThreads} loadingLabel="이동 중">
                <Link2 size={15} />
                {account?.has_threads_access_token ? '다시 연결' : '승인 후 연결'}
              </DarkButton>
            ) : (
              <DarkButton variant="ghost" size="sm" onClick={requestThreadsRegistration} disabled={requestingThreads} loading={requestingThreads} loadingLabel="요청 중">
                <Link2 size={15} />
                {activeThreadsRequest ? '요청 업데이트' : '등록 요청'}
              </DarkButton>
            )}
          </div>
          {!account?.has_threads_access_token && !threadsOAuthReady && (
            <div className="grid gap-2">
              <label className={labelClass}>운영자에게 보낼 메모<input className={inputClass} value={threadsRequestMemo} onChange={(event) => setThreadsRequestMemo(event.target.value)} placeholder="예: 이 계정으로 연결하고 싶어요" /></label>
              <p className="text-xs leading-relaxed text-zinc-500">
                운영자가 Meta 개발자센터에 Threads 계정을 등록한 뒤, 여기에서 승인/연결 버튼이 열립니다.
              </p>
            </div>
          )}
        </div>
        {!account?.has_threads_access_token && threadsOAuthReady && (
          <Notice>
            Meta 등록이 완료됐어요. Threads 계정의 웹 승인 화면에서 앱 접근을 승인한 뒤 연결을 마무리해 주세요.
          </Notice>
        )}
        {!account?.has_threads_access_token && threadsOAuthError?.message && (
          <Notice tone="error">
            Safari/Chrome에서 threads.net에 연결할 계정으로 로그인되어 있는지, Meta 웹 승인 초대를 수락했는지 확인한 뒤 다시 연결해 주세요.
          </Notice>
        )}
        {!account?.has_threads_access_token && !activeThreadsRequest && (
          <Notice>
            처음 연결할 때는 운영자 등록이 필요해요. 연결할 Threads 핸들을 입력한 뒤 등록 요청을 보내주세요.
          </Notice>
        )}
      </CollapsiblePanel>
      {confirmingThreadsApproval && (
        <ThreadsWebApprovalModal
          account={account}
          connecting={connectingThreads}
          onCancel={() => setConfirmingThreadsApproval(false)}
          onConfirm={() => {
            setConfirmingThreadsApproval(false);
            connectThreads();
          }}
        />
      )}

      <CollapsiblePanel title="운영 설정" defaultOpen={settingsDraft?.id === appliedDraftId}>
        <div className="grid gap-3">
          <label className={labelClass}>계정명<input className={inputClass} value={form.name} onChange={(e) => update('name', e.target.value)} /></label>
          <label className={labelClass}>Threads 핸들<input className={inputClass} value={form.account_handle} onChange={(e) => update('account_handle', e.target.value)} placeholder="@myhandle" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <DarkSelect
              label="타깃 빠른 선택"
              value=""
              onChange={(value) => value && update('target_audience', value)}
              options={[
                { value: '', label: '선택해서 채우기' },
                { value: '2030 자취생', label: '2030 자취생' },
                { value: '육아와 살림을 같이 하는 3040', label: '육아/살림 3040' },
                { value: '집 정리와 생활 효율을 좋아하는 직장인', label: '생활 효율 직장인' },
                { value: '가성비와 실사용 후기를 중시하는 소비자', label: '가성비 소비자' }
              ]}
            />
            <DarkSelect
              label="카테고리 빠른 선택"
              value=""
              onChange={(value) => value && update('content_scope', value)}
              options={[
                { value: '', label: '선택해서 채우기' },
                { value: '자취 꿀템, 원룸 수납, 청소용품', label: '자취/원룸' },
                { value: '주방용품, 살림템, 정리수납', label: '주방/살림' },
                { value: '육아용품, 생활 편의용품', label: '육아/생활' },
                { value: '가전 주변기기, 책상 정리, 생활 효율템', label: '생활 효율' }
              ]}
            />
          </div>
          <label className={labelClass}>타깃층<textarea className={inputClass} rows="2" value={form.target_audience} onChange={(e) => update('target_audience', e.target.value)} /></label>
          <label className={labelClass}>다룰 카테고리<textarea className={inputClass} rows="2" value={form.content_scope} onChange={(e) => update('content_scope', e.target.value)} /></label>
          <DarkSelect
            label="톤 빠른 선택"
            value=""
            onChange={(value) => value && update('tone', value)}
            options={[
              { value: '', label: '선택해서 채우기' },
              { value: '친근하고 자연스러운 반말 느낌', label: '친근한 반말' },
              { value: '담백한 생활 관찰형', label: '담백한 관찰형' },
              { value: '실사용 기준을 짧게 짚는 말투', label: '실사용 기준형' },
              { value: '살짝 공감하고 질문으로 마무리', label: '공감 질문형' }
            ]}
          />
          <label className={labelClass}>톤<input className={inputClass} value={form.tone} onChange={(e) => update('tone', e.target.value)} /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="쿠팡 파트너스 연결">
        <div className="grid gap-3">
          <label className={labelClass}>Access Key<input className={inputClass} value={form.coupang_access_key} onChange={(e) => update('coupang_access_key', e.target.value)} placeholder={account?.has_coupang_access_key ? '저장됨 - 변경 시에만 입력' : 'Access Key'} /></label>
          <label className={labelClass}>Secret Key<input type="password" className={inputClass} value={form.coupang_secret_key} onChange={(e) => update('coupang_secret_key', e.target.value)} placeholder={account?.has_coupang_secret_key ? '저장됨 - 변경 시에만 입력' : 'Secret Key'} /></label>
          <label className={labelClass}>Partner ID<input className={inputClass} value={form.coupang_partner_id} onChange={(e) => update('coupang_partner_id', e.target.value)} placeholder={account?.has_coupang_partner_id ? '저장됨 - 변경 시에만 입력' : 'Partner ID'} /></label>
          <label className={labelClass}>Tracking Code<input className={inputClass} value={form.coupang_tracking_code} onChange={(e) => update('coupang_tracking_code', e.target.value)} placeholder={account?.has_coupang_tracking_code ? '저장됨 - 변경 시에만 입력' : 'Tracking Code'} /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="콘텐츠 설정">
        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
            <button
              type="button"
              onClick={() => updateContentMode('auto')}
              className={`w-full rounded-2xl border px-4 py-3 text-left text-sm ${form.content_mode === 'auto' ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/5'}`}
            >
              <div className="font-black">자동 맞춤</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">계정 설정과 학습한 인기글 패턴을 보고 글 형식을 자동으로 섞어요.</div>
            </button>
            <button
              type="button"
              onClick={() => setContentAdvancedOpen((prev) => !prev)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-zinc-300 hover:bg-white/5"
            >
              <span>{contentAdvancedOpen ? '고급 설정 접기' : '고급 설정'}</span>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-200">beta</span>
            </button>
            {contentAdvancedOpen && (
              <div className="mt-3 grid gap-2">
                {contentModeOptions.filter((option) => option.value !== 'auto').map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateContentMode(option.value)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm ${form.content_mode === option.value ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 bg-black/20 text-zinc-300 hover:bg-white/5'}`}
                  >
                    <div className="font-black">{option.label}</div>
                    <div className="mt-1 text-xs text-zinc-500">{option.description}</div>
                  </button>
                ))}
              </div>
            )}
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
          <label className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">
            <span>
              <span className="block">콘텐츠 품질 향상 참여</span>
              <span className="mt-1 block text-xs font-medium leading-relaxed text-zinc-500">
                반응 좋은 글의 말투와 패턴을 참고해 콘텐츠 품질을 높여요.
              </span>
            </span>
            <input type="checkbox" checked={form.anonymous_learning_enabled} onChange={(e) => update('anonymous_learning_enabled', e.target.checked)} />
          </label>
          <label className={labelClass}>추가 요청사항<textarea className={inputClass} rows="3" value={form.content_style_note} onChange={(e) => update('content_style_note', e.target.value)} placeholder="예: 너무 광고처럼 쓰지 말기, 자취생 말투 유지" /></label>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="외부 연결">
        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-zinc-100">내 블로그</div>
                {account?.blog_enabled && account?.blog_public_url ? (
                  <p className="mt-1 truncate text-xs leading-relaxed text-zinc-500">{account.blog_public_url}</p>
                ) : (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">관리자가 블로그를 생성하면 여기에 표시됩니다.</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {account?.blog_enabled && account?.blog_public_url && (
                  <>
                    <a href={account.blog_public_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-zinc-100 hover:bg-white/10">
                      <Link2 size={15} />
                      내 블로그 열기
                    </a>
                    <button type="button" onClick={copyBlogUrl} className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-zinc-300 hover:bg-white/10">
                      주소 복사
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setBlogDetailsOpen((prev) => !prev)} className="rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-zinc-300 hover:bg-white/10">
                  {blogDetailsOpen ? '접기' : '상세 설정'}
                </button>
              </div>
            </div>
            {blogDetailsOpen && (
              <div className="mt-4 grid gap-3 border-t border-white/5 pt-4">
                <label className={`flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${account?.blog_enabled ? 'bg-black/25 text-zinc-300' : 'bg-black/10 text-zinc-600'}`}>
                  <span>
                    <span className="block">자동 발행 사용</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed text-zinc-500">
                      Threads 업로드 성공 후 블로그 글을 1회 생성해요.
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    disabled={!account?.blog_enabled}
                    checked={Boolean(account?.blog_enabled && form.blog_auto_publish_enabled)}
                    onChange={(e) => update('blog_auto_publish_enabled', e.target.checked)}
                  />
                </label>
                {!account?.blog_enabled && <Notice>자체 블로그는 관리자 생성 후 사용할 수 있어요.</Notice>}
                {account?.blog_enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DarkSelect
                      label="블로그 발행 방식"
                      value={form.blog_publish_mode}
                      onChange={(value) => update('blog_publish_mode', value)}
                      options={[
                        { value: 'test_only', label: '테스트 환경만' },
                        { value: 'manual', label: '수동 확인' },
                        { value: 'auto', label: '자동' }
                      ]}
                    />
                    <label className={labelClass}>블로그 기준 URL<input className={inputClass} value={form.blog_base_url} onChange={(e) => update('blog_base_url', e.target.value)} placeholder={account.blog_public_url || 'https://api.jasain.kr/blog'} /></label>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-zinc-100">토스 쉐어링크</div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">상담/결제 안내에 사용할 링크를 저장해둘 수 있어요.</p>
              </div>
              <label className="flex items-center gap-3 text-sm font-black text-zinc-300">
                사용하기
                <input
                  type="checkbox"
                  checked={form.toss_share_link_enabled}
                  onChange={(e) => {
                    update('toss_share_link_enabled', e.target.checked);
                    if (e.target.checked) setTossDetailsOpen(true);
                  }}
                />
              </label>
            </div>
            <button type="button" onClick={() => setTossDetailsOpen((prev) => !prev)} className="mt-3 w-full rounded-2xl border border-white/10 px-4 py-2 text-sm font-black text-zinc-300 hover:bg-white/10">
              {tossDetailsOpen ? '접기' : '상세 설정'}
            </button>
            {(form.toss_share_link_enabled || tossDetailsOpen) && (
              <div className="mt-4 grid gap-3 border-t border-white/5 pt-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={labelClass}>토스 쉐어링크 URL<input className={inputClass} value={form.toss_share_link_url} onChange={(e) => update('toss_share_link_url', e.target.value)} placeholder="https://toss.me/..." /></label>
                  <label className={labelClass}>표시 라벨<input className={inputClass} value={form.toss_share_link_label} onChange={(e) => update('toss_share_link_label', e.target.value)} placeholder="결제/상담 링크" /></label>
                </div>
                <label className={labelClass}>관리 메모<textarea className={inputClass} rows="2" value={form.toss_share_link_memo} onChange={(e) => update('toss_share_link_memo', e.target.value)} placeholder="사용처, 고객별 안내 문구 등" /></label>
              </div>
            )}
          </div>
        </div>
      </CollapsiblePanel>

      <CollapsiblePanel title="포스팅 스케줄">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>분산 기준 시각<input type="time" className={inputClass} value={form.first_upload_time} onChange={(e) => update('first_upload_time', e.target.value)} /></label>
          <label className={labelClass}>하루 최대 업로드<input type="number" min="0" max={MAX_DAILY_POSTS} className={inputClass} value={form.daily_post_max} onChange={(e) => update('daily_post_max', e.target.value)} /></label>
        </div>
        <p className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
          하루 여러 개를 예약하면 09:00-23:00 사이에 랜덤 분산되고, 포스팅 간 최소 간격을 지켜요.
        </p>
      </CollapsiblePanel>

      <CollapsiblePanel title="금지/제외 규칙">
        <div className="grid gap-3">
          <label className={labelClass}>다루지 말 것<textarea className={inputClass} rows="3" value={form.forbidden_topics} onChange={(e) => update('forbidden_topics', e.target.value)} placeholder={'의약품\n다이어트 보조제\n건강 효능 단정'} /></label>
          <label className={labelClass}>금지어<textarea className={inputClass} rows="3" value={form.forbidden_words} onChange={(e) => update('forbidden_words', e.target.value)} placeholder={'100% 효과\n치료/예방\n체중감량 보장'} /></label>
        </div>
      </CollapsiblePanel>

      <DarkButton onClick={save} disabled={saving} loading={saving} loadingLabel="저장 중">설정 저장</DarkButton>
    </>
  );
}

function CujasaOnboardingChecklist({ account, form, activeThreadsRequest }) {
  const hasAccount = Boolean(account?.id);
  const hasHandle = Boolean(String(form?.account_handle || account?.account_handle || '').trim());
  const hasThreads = Boolean(account?.has_threads_access_token);
  const hasThreadsRequest = Boolean(activeThreadsRequest && !['connected', 'canceled'].includes(activeThreadsRequest.status));
  const hasCoupang = Boolean(account?.has_coupang_access_key && account?.has_coupang_secret_key && account?.has_coupang_partner_id);
  const hasContent = Boolean(String(form?.target_audience || '').trim() && String(form?.content_scope || '').trim());
  const steps = [
    { key: 'account', label: '계정 만들기', done: hasAccount, meta: account?.name || '필요' },
    { key: 'handle', label: 'Threads 핸들', done: hasHandle, meta: form?.account_handle || account?.account_handle || '미입력' },
    { key: 'threads', label: 'Threads 연결', done: hasThreads, meta: hasThreads ? '연결됨' : hasThreadsRequest ? '요청 중' : '등록 필요' },
    { key: 'coupang', label: '쿠팡 API', done: hasCoupang, meta: hasCoupang ? '저장됨' : '입력 필요' },
    { key: 'content', label: '콘텐츠 기준', done: hasContent, meta: hasContent ? '입력됨' : '입력 필요' },
    { key: 'run', label: '자동화 시작', done: hasAccount && hasThreads && hasCoupang && hasContent, meta: hasThreads && hasCoupang && hasContent ? '가능' : '대기' }
  ];

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-100">온보딩 체크리스트</div>
          <div className="mt-1 text-xs text-zinc-500">이 순서대로 완료되면 자동화 실행을 바로 시작할 수 있어요.</div>
        </div>
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-black text-zinc-400">
          {steps.filter((step) => step.done).length}/{steps.length}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.key} className={`rounded-2xl border px-3 py-3 ${step.done ? 'border-emerald-400/15 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]'}`}>
            <div className="flex items-center gap-2">
              {step.done ? <CheckCircle2 size={15} className="text-emerald-300" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-white/[0.06] text-[10px] font-black text-zinc-400">{index + 1}</span>}
              <span className="text-xs font-black text-zinc-100">{step.label}</span>
            </div>
            <div className="mt-1 truncate text-xs text-zinc-500">{step.meta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseTrendReferenceText(text = '', category = '') {
  return String(text || '')
    .split(/\n\s*---+\s*\n|\n{2,}/)
    .map((block, index) => {
      const sourceText = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^(@|작성자|계정|url|https?:\/\/)/i.test(line))
        .join('\n')
        .trim();
      if (sourceText.length < 20) return null;
      const metricText = block.replace(/,/g, '');
      const pick = (patterns) => {
        for (const pattern of patterns) {
          const match = metricText.match(pattern);
          if (match) return Number(match[1] || 0);
        }
        return 0;
      };
      return {
        id: `paste-${Date.now()}-${index}`,
        sourceText,
        topicKeyword: category,
        likes: pick([/좋아요\s*([0-9]+)/i, /likes?\s*([0-9]+)/i]),
        replies: pick([/댓글\s*([0-9]+)/i, /답글\s*([0-9]+)/i, /comments?\s*([0-9]+)/i]),
        views: pick([/조회\s*([0-9]+)/i, /views?\s*([0-9]+)/i]),
        sourceType: 'text_paste'
      };
    })
    .filter(Boolean);
}

function fileToBase64Payload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function TrendReferencesPanel({ account, currentUser, reloadAccounts }) {
  const toast = useToast();
  const [category, setCategory] = useState(account?.content_scope || '');
  const [targetAudienceHint, setTargetAudienceHint] = useState(account?.target_audience || '');
  const [previewForm, setPreviewForm] = useState({
    contentMode: account?.content_mode || 'auto',
    contentIntensity: account?.content_intensity || 'normal',
    commentStyle: account?.comment_induction_style || 'soft_question',
    productMentionStyle: account?.product_mention_style || 'natural',
    emojiLevel: account?.emoji_level || 'low'
  });
  const [text, setText] = useState('');
  const [ocrSamples, setOcrSamples] = useState([]);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [savingLearning, setSavingLearning] = useState(false);
  const [showLearningInfo, setShowLearningInfo] = useState(false);
  const [learningEnabled, setLearningEnabled] = useState(Boolean(account?.anonymous_learning_enabled));
  const showQualityLab = String(currentUser?.email || '').trim().toLowerCase() === 'test1@test.com';

  useEffect(() => {
    setLearningEnabled(Boolean(account?.anonymous_learning_enabled));
  }, [account?.anonymous_learning_enabled]);

  const textSamples = useMemo(() => parseTrendReferenceText(text, category), [text, category]);
  const samples = useMemo(() => [...ocrSamples, ...textSamples], [ocrSamples, textSamples]);

  const updateAnonymousLearning = async (enabled) => {
    if (!account?.id) return;
    setSavingLearning(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, { anonymous_learning_enabled: enabled });
      setLearningEnabled(enabled);
      await reloadAccounts?.();
      toast(enabled ? '콘텐츠 품질 향상 참여를 켰어요.' : '콘텐츠 품질 향상 참여를 껐어요.', 'success');
    } catch (err) {
      toast(err.message || '품질 향상 설정을 저장하지 못했어요.', 'error');
    } finally {
      setSavingLearning(false);
      setShowLearningInfo(false);
    }
  };

  const handleLearningToggle = () => {
    if (savingLearning) return;
    if (learningEnabled) {
      updateAnonymousLearning(false);
      return;
    }
    setShowLearningInfo(true);
  };

  const uploadCapture = async (files) => {
    const selected = Array.from(files || []).slice(0, 5);
    if (!selected.length) return;
    setOcrLoading(true);
    try {
      const nextSamples = [];
      for (const file of selected) {
        if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) {
          toast('PNG/JPG/WEBP 캡처만 업로드할 수 있어요.', 'error');
          continue;
        }
        if (file.size > 12 * 1024 * 1024) {
          toast(`${file.name}은 12MB 이하로 올려주세요.`, 'error');
          continue;
        }
        const base64 = await fileToBase64Payload(file);
        const sample = await api.post('/api/product-workspace/cujasa/trend-reference-ocr', {
          accountId: account?.id,
          fileName: file.name,
          mimeType: file.type || 'image/png',
          base64,
          category,
          topicKeyword: category
        });
        if (sample?.sourceText) nextSamples.push(sample);
      }
      if (nextSamples.length) {
        setOcrSamples((prev) => [...prev, ...nextSamples]);
        toast(`캡처 ${nextSamples.length}개에서 텍스트를 추출했어요.`, 'success');
      }
    } catch (err) {
      toast(err.message || '캡처 OCR에 실패했어요.', 'error');
    } finally {
      setOcrLoading(false);
    }
  };

  const analyze = async () => {
    if (!account?.id) return;
    if (!samples.length) {
      toast('학습할 글을 붙여넣거나 캡처를 올려주세요.', 'error');
      return;
    }
    setLoading(true);
    try {
      const next = await api.post('/api/product-workspace/cujasa/trend-references', {
        accountId: account.id,
        samples,
        category,
        targetAudienceHint,
        sourceType: ocrSamples.length && !textSamples.length ? 'screenshot_ocr' : 'text_paste'
      });
      setResult(next);
      toast('앞으로 만들 글에 참고할 기준을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '학습할 글을 저장하지 못했어요.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const runPreview = async () => {
    if (!account?.id) return;
    setPreviewLoading(true);
    try {
      const next = await api.post('/api/product-workspace/cujasa/content-preview', {
        accountId: account.id,
        category,
        targetAudience: targetAudienceHint,
        ...previewForm
      });
      setPreview(next);
      toast('예약 없이 예시 글을 생성했어요.', 'success');
    } catch (err) {
      toast(err.message || '콘텐츠 미리보기에 실패했어요.', 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      {showQualityLab && <PanelCard title="콘텐츠 품질 Lab">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>카테고리<input className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="자취 꿀템, 살림 꿀템" /></label>
          <label className={labelClass}>타깃<input className={inputClass} value={targetAudienceHint} onChange={(event) => setTargetAudienceHint(event.target.value)} placeholder="2030 자취생" /></label>
          <DarkSelect label="콘텐츠 방식" value={previewForm.contentMode} onChange={(value) => setPreviewForm((prev) => ({ ...prev, contentMode: value }))} options={contentModeOptions} />
          <DarkSelect label="강도" value={previewForm.contentIntensity} onChange={(value) => setPreviewForm((prev) => ({ ...prev, contentIntensity: value }))} options={contentIntensityOptions} />
          <DarkSelect label="댓글 유도" value={previewForm.commentStyle} onChange={(value) => setPreviewForm((prev) => ({ ...prev, commentStyle: value }))} options={commentStyleOptions} />
          <DarkSelect label="상품 언급" value={previewForm.productMentionStyle} onChange={(value) => setPreviewForm((prev) => ({ ...prev, productMentionStyle: value }))} options={productMentionOptions} />
          <DarkSelect label="이모지" value={previewForm.emojiLevel} onChange={(value) => setPreviewForm((prev) => ({ ...prev, emojiLevel: value }))} options={emojiLevelOptions} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <DarkButton onClick={runPreview} disabled={previewLoading} loading={previewLoading} loadingLabel="생성 중">예시 글 생성</DarkButton>
          <DarkButton variant="ghost" onClick={() => setPreview(null)} disabled={previewLoading || !preview}>미리보기 초기화</DarkButton>
        </div>
        {preview && (
          <div className="mt-4 grid gap-3">
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs font-bold text-zinc-500 sm:grid-cols-3">
              <div>패턴 {preview.patterns?.length || 0}개 사용</div>
              <div>후보 {preview.candidates?.length || 0}개</div>
              <div>선택 {Number(preview.selectedIndex ?? -1) >= 0 ? `#${Number(preview.selectedIndex) + 1}` : '-'}</div>
            </div>
            {(preview.candidates || []).map((candidate, index) => (
              <div key={`${candidate.index}-${index}`} className={`rounded-3xl border px-4 py-4 ${candidate.selected ? 'border-emerald-300/30 bg-emerald-400/10' : candidate.allowed ? 'border-white/10 bg-black/20' : 'border-rose-300/20 bg-rose-400/10'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-black text-zinc-100">후보 {index + 1}</div>
                  <div className="flex flex-wrap gap-2 text-[11px] font-black">
                    {candidate.selected && <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-emerald-100">선택 후보</span>}
                    <span className="rounded-full bg-white/10 px-2 py-1 text-zinc-300">점수 {candidate.engagementScore || 0}</span>
                    <span className={`rounded-full px-2 py-1 ${candidate.allowed ? 'bg-emerald-400/10 text-emerald-100' : 'bg-rose-400/10 text-rose-100'}`}>{candidate.allowed ? '통과' : '제외'}</span>
                    <span className={`rounded-full px-2 py-1 ${candidate.queueReady ? 'bg-emerald-400/10 text-emerald-100' : 'bg-amber-400/10 text-amber-100'}`}>{candidate.queueReady ? '링크 준비' : '상품 필요'}</span>
                  </div>
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-zinc-200">{candidate.body}</div>
                <div className="mt-3 grid gap-2 text-xs text-zinc-500">
                  {(candidate.selectionReasons || []).slice(0, 3).map((reason) => <div key={reason}>선택 신호 · {reason}</div>)}
                  {(candidate.rejectionReasons || []).slice(0, 4).map((reason) => <div key={reason} className="text-rose-200/80">제외 이유 · {reason}</div>)}
                  {(candidate.productWarnings || []).slice(0, 2).map((reason) => <div key={reason} className="text-amber-100/80">상품 상태 · {reason}</div>)}
                </div>
                <div className="mt-4 grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-black text-zinc-500">
                    <span>예상 검색어</span>
                    {(candidate.productPreview?.searchKeywords || []).slice(0, 6).map((keyword) => (
                      <span key={keyword} className="rounded-full bg-white/10 px-2 py-1 text-zinc-300">{keyword}</span>
                    ))}
                  </div>
                  {(candidate.productPreview?.matches || []).length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-3">
                      {candidate.productPreview.matches.map((product) => (
                        <div key={product.id || product.productId || product.name} className={`rounded-2xl border p-3 ${product.linkable ? 'border-emerald-300/20 bg-emerald-400/10' : 'border-white/10 bg-black/25'}`}>
                          <div className="aspect-[4/3] overflow-hidden rounded-xl bg-white/5">
                            {product.image ? <img src={product.image} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px] font-black text-zinc-600">이미지 없음</div>}
                          </div>
                          <div className="mt-2 line-clamp-2 text-xs font-black text-zinc-100">{product.name || '상품명 없음'}</div>
                          <div className="mt-1 text-[11px] font-bold text-zinc-500">{product.price ? `${Number(product.price).toLocaleString()}원` : '가격 없음'} · 매칭 {product.score || 0}</div>
                          <div className="mt-2 grid gap-1 text-[11px] text-zinc-500">
                            {(product.matchReasons || []).slice(0, 2).map((reason) => <div key={reason}>이유 · {reason}</div>)}
                            {(product.riskReasons || []).slice(0, 2).map((reason) => <div key={reason} className="text-rose-200/80">위험 · {reason}</div>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-black/25 px-3 py-2 text-xs font-bold text-rose-200/80">매칭 가능한 실상품이 없어서 실제 링크 큐에는 넣지 않습니다.</div>
                  )}
                  {candidate.productPreview?.replyPreview && (
                    <div className="rounded-2xl bg-white/[0.04] px-3 py-2">
                      <div className="text-[11px] font-black uppercase tracking-wide text-zinc-600">댓글 링크 미리보기</div>
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-zinc-300">{candidate.productPreview.replyPreview}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {preview.patterns?.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-xs font-black uppercase tracking-wide text-zinc-600">사용된 학습 패턴</div>
                <div className="mt-2 grid gap-2">
                  {preview.patterns.slice(0, 5).map((pattern) => (
                    <div key={pattern.sourceId} className="rounded-2xl bg-black/25 px-3 py-2 text-xs text-zinc-400">
                      <span className="font-black text-zinc-200">{pattern.hookPattern || pattern.sourceId}</span>
                      <span className="ml-2 text-zinc-600">품질 {pattern.qualityScore || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PanelCard>}

      <PanelCard>
        <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-black text-emerald-100">
                <Plus size={17} /> 반응 좋은 글의 말투와 패턴을 학습해요
              </div>
              <p className="mt-1 text-xs leading-relaxed text-emerald-100/65">
                반응이 좋았던 글을 붙여넣거나 캡처로 올려주세요.<br />
                다음 글을 만들 때 말투와 패턴만 참고합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLearningToggle}
              disabled={savingLearning}
              className={`relative h-8 w-14 rounded-full border transition ${learningEnabled ? 'border-emerald-300 bg-emerald-400' : 'border-white/15 bg-black/40'} disabled:opacity-60`}
              aria-pressed={learningEnabled}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${learningEnabled ? 'left-7' : 'left-1'}`} />
            </button>
          </div>
          <button type="button" onClick={() => setShowLearningInfo(true)} className="mt-3 text-xs font-black text-emerald-100/80 underline-offset-4 hover:text-emerald-50 hover:underline">
            자세히 보기
          </button>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>어떤 주제에 참고할까요?<input className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="자취 꿀템, 살림 꿀템" /></label>
          <label className={labelClass}>누구에게 보여줄 글인가요?<input className={inputClass} value={targetAudienceHint} onChange={(event) => setTargetAudienceHint(event.target.value)} placeholder="2030 자취생" /></label>
        </div>
        <label className={`${labelClass} mt-3`}>
          학습할 글 붙여넣기
          <textarea
            className={inputClass}
            rows="8"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={'반응이 좋았던 글 본문을 붙여넣어 주세요.\n\n여러 개는 빈 줄이나 --- 로 구분하면 됩니다.\n좋아요 1200 / 댓글 80 같은 반응 수치가 있으면 함께 넣어도 좋아요.'}
          />
        </label>
        <div className="mt-3 grid gap-2">
          <div className="text-sm font-black text-zinc-300">캡처로 올리기</div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/25 px-4 py-5 text-sm font-bold text-zinc-300 hover:bg-white/5">
            <span className="inline-flex items-center gap-2"><Upload size={17} /> 화면 캡처 올리기 PNG/JPG/WEBP</span>
            <input type="file" accept=".png,.jpg,.jpeg,.webp" multiple className="hidden" onChange={(event) => uploadCapture(event.target.files)} />
          </label>
          {ocrLoading && <Notice>캡처에서 글 내용과 반응 수치를 읽고 있어요.</Notice>}
        </div>
        <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-500">
          학습할 글 {samples.length}개 · 품질 향상 참여 {learningEnabled ? '켜짐' : '꺼짐'}
        </div>
        <div className="mt-3 flex gap-2">
          <DarkButton onClick={analyze} disabled={loading || ocrLoading || samples.length === 0} loading={loading} loadingLabel="저장 중">이 글 학습하기</DarkButton>
          <DarkButton variant="ghost" onClick={() => { setText(''); setOcrSamples([]); setResult(null); }} disabled={loading || ocrLoading}>초기화</DarkButton>
        </div>
      </PanelCard>

      {result && (
        <PanelCard title="저장 완료">
          <div className="grid gap-2 text-sm font-bold text-zinc-300">
            <div className="rounded-2xl bg-black/25 px-4 py-3">인기글 {result.personalPatterns?.length || result.personalPatternCount || 0}개를 학습했어요.</div>
            <div className="rounded-2xl bg-black/25 px-4 py-3">품질 향상 참여 {result.anonymousLearningEnabled ? '켜짐' : '꺼짐'}</div>
            <div className="rounded-2xl bg-black/25 px-4 py-3">다음 콘텐츠부터 이 계정의 말투와 패턴에 참고됩니다.</div>
          </div>
        </PanelCard>
      )}

      {showLearningInfo && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#1f1f1f] p-5 shadow-2xl shadow-black/60">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-black text-zinc-100">콘텐츠 품질 향상 참여</div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  허용하면 올려주신 인기글의 말투와 패턴을 참고해 다음 콘텐츠를 더 자연스럽게 만듭니다.
                </p>
              </div>
              <button type="button" onClick={() => setShowLearningInfo(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <p className="mt-4 rounded-2xl bg-black/25 px-4 py-3 text-sm leading-relaxed text-zinc-400">
              내 계정의 글 품질을 높이기 위한 베타 기능이에요. 언제든 다시 끄고 켤 수 있습니다.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {!learningEnabled && (
                <DarkButton onClick={() => updateAnonymousLearning(true)} disabled={savingLearning} loading={savingLearning} loadingLabel="저장 중">
                  참여하고 글 품질 높이기
                </DarkButton>
              )}
              <DarkButton variant="ghost" onClick={() => setShowLearningInfo(false)} disabled={savingLearning}>
                {learningEnabled ? '확인' : '나중에'}
              </DarkButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BetaAccountSettingsPanel({ currentUser, account, accounts, onLogout, onOpenPrivacy, accountCreation }) {
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
          <AccountInfoRow label="등록 계정 수" value={`${accountCreation?.count ?? accounts?.length ?? 0}/${accountCreation?.maxAccounts ?? currentUser?.maxAccounts ?? 2}개`} />
        </div>
      </PanelCard>

      <PanelCard title="CUJASA 계정 추가">
        <div className="grid gap-3">
          {accountCreation?.canAdd ? (
            <>
              <p className="text-sm leading-relaxed text-zinc-500">
                새 Threads 계정을 먼저 등록한 뒤 설정 확인에서 Threads 연결과 게시 조건을 점검합니다.
              </p>
              {accountCreation.show ? (
                <BetaAccountAddForm accountCreation={accountCreation} />
              ) : (
                <DarkButton variant="ghost" onClick={accountCreation.open}>
                  <Plus size={16} />
                  계정 추가
                </DarkButton>
              )}
            </>
          ) : (
            <Notice>
              현재 이용권의 계정 한도에 도달했습니다. 추가 계정이 필요하면 결제 메뉴에서 이용권을 확인해 주세요.
            </Notice>
          )}
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

function BetaAccountAddForm({ accountCreation }) {
  const draft = accountCreation?.draft || { name: '', account_handle: '' };
  const updateDraft = (patch) => {
    accountCreation?.setDraft?.((prev) => ({ ...(prev || {}), ...patch }));
  };

  if (!accountCreation?.canAdd) {
    return (
      <Notice>
        계정 {accountCreation?.count ?? 0}/{accountCreation?.maxAccounts ?? 2} 한도에 도달했습니다.
      </Notice>
    );
  }

  return (
    <form onSubmit={accountCreation.submit} className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-black text-zinc-300">새 Threads 계정</div>
        <button type="button" onClick={accountCreation.close} className="grid h-7 w-7 place-items-center rounded-full text-zinc-600 hover:bg-white/10 hover:text-zinc-200">
          <X size={14} />
        </button>
      </div>
      <input
        type="text"
        value={draft.name || ''}
        onChange={(event) => updateDraft({ name: event.target.value })}
        placeholder="계정 이름 (예: 자취 꿀템)"
        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-zinc-100 placeholder:text-zinc-700 focus:border-white/25 focus:outline-none"
        required
      />
      <input
        type="text"
        value={draft.account_handle || ''}
        onChange={(event) => updateDraft({ account_handle: event.target.value })}
        placeholder="Threads 핸들 (예: @myhandle)"
        className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-bold text-zinc-100 placeholder:text-zinc-700 focus:border-white/25 focus:outline-none"
      />
      <button
        type="submit"
        disabled={accountCreation.adding || !String(draft.name || '').trim()}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {accountCreation.adding && <RefreshCw size={15} className="shrink-0 animate-spin" />}
        {accountCreation.adding ? '추가 중' : '추가하기'}
      </button>
      <p className="text-[11px] leading-relaxed text-zinc-700">
        생성 후 자동화는 바로 시작하지 않습니다. 먼저 Threads 연결과 게시 조건을 확인합니다.
      </p>
    </form>
  );
}

function BetaBillingPanel({ currentUser, reloadCurrentUser, onRequestBillingAgreement }) {
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
            productId: pending.productId || 'monthly_59000',
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

  const startOnetime = async (productId, agreementSnapshot) => {
    setBusy(productId);
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', {
        productId,
        agreementAccepted: true,
        agreementVersion: BILLING_AGREEMENT_VERSION,
        agreementSnapshot
      });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '결제를 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startMonthly = async (productId, agreementSnapshot) => {
    setBusy(productId);
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', {
        productId,
        agreementAccepted: true,
        agreementVersion: BILLING_AGREEMENT_VERSION,
        agreementSnapshot
      });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '월정액 가상계좌 결제를 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startDexorCredit = async (productId, agreementSnapshot) => {
    setBusy(productId);
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', {
        productId,
        agreementAccepted: true,
        agreementVersion: BILLING_AGREEMENT_VERSION,
        agreementSnapshot
      });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '크레딧 충전을 시작하지 못했어요.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startFreeProduct = async (productId) => {
    setBusy(productId);
    try {
      await api.post(`/api/auth/products/${encodeURIComponent(productId)}/start`);
      await reloadCurrentUser?.();
      await load().catch(() => {});
      toast('제품 사용을 시작했어요.', 'success');
    } catch (err) {
      toast(err.message || '제품 사용 시작에 실패했어요.', 'error');
    } finally {
      setBusy('');
    }
  };

  const requestAgreement = (flow, product, run) => {
    onRequestBillingAgreement?.({
      flow,
      product,
      busy: Boolean(busy),
      onConfirm: async (snapshot) => {
        onRequestBillingAgreement?.(null);
        await run(snapshot);
      }
    });
  };
  const cujasaPlans = [
    {
      id: 'monthly_59000',
      product: productsById.monthly_59000 ? { ...productsById.monthly_59000, amount: 129000 } : null,
      title: billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액',
      priceText: '129,000원 / 월',
      caption: activeSubscription ? `활성 · 다음 결제 ${formatBillingDate(activeSubscription.nextBillingAt)}` : '광고 없이 안정적으로 운영',
      badge: '추천',
      buttonLabel: billing?.status === 'past_due' ? '연장하기' : '월정액 시작',
      icon: CreditCard,
      featured: true,
      features: ['Threads 계정 2개 운영', '광고 없는 콘텐츠/추천 흐름', '가상계좌 기반 월 단위 이용', '운영 셋업과 재연결 지원']
    },
    {
      id: 'onetime_590000',
      product: productsById.onetime_590000 ? { ...productsById.onetime_590000, max_accounts: 4 } : null,
      title: '프로 영구구매',
      priceText: '590,000원',
      originalPriceText: '990,000원',
      caption: '장기 운영용 일시불',
      badge: '평생 이용',
      buttonLabel: '영구구매 신청',
      icon: Landmark,
      features: ['Threads 계정 4개 운영', '광고 없는 콘텐츠/추천 흐름', '가상계좌 일시불 결제', '장기 운영용 셋업 지원']
    }
  ];

  return (
    <TestBillingPricingPage
      currentUser={currentUser}
      billing={billing}
      productsById={productsById}
      latestWaiting={latestWaiting}
      activeSubscription={activeSubscription}
      cujasaPlans={cujasaPlans}
      busy={busy}
      load={load}
      requestAgreement={requestAgreement}
      startOnetime={startOnetime}
      startMonthly={startMonthly}
      startFreeProduct={startFreeProduct}
    />
  );

  return (
    <>
      <PanelCard>
        <div className="flex flex-wrap items-start justify-between gap-3">
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
        <LegacyBetaPlanCard
          icon={Landmark}
          title="프로 영구구매"
          priceText="590,000원"
          originalPriceText="990,000원"
          caption="가상계좌 결제"
          product={productsById.onetime_590000 ? { ...productsById.onetime_590000, max_accounts: 4 } : null}
          busy={busy === 'onetime_590000'}
          onClick={() => requestAgreement('onetime', productsById.onetime_590000, (snapshot) => startOnetime('onetime_590000', snapshot))}
        />
        <LegacyBetaPlanCard
          icon={CreditCard}
          title={billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액'}
          priceText="129,000원 / 월"
          caption={activeSubscription ? `활성 · 다음 결제 ${formatBillingDate(activeSubscription.nextBillingAt)}` : '가상계좌 결제'}
          product={productsById.monthly_59000 ? { ...productsById.monthly_59000, amount: 129000 } : null}
          busy={busy === 'monthly_59000'}
          onClick={() => requestAgreement('monthly', productsById.monthly_59000 ? { ...productsById.monthly_59000, amount: 129000 } : null, (snapshot) => startMonthly('monthly_59000', snapshot))}
        />
      </div>

      <PanelCard title="DEXOR 크레딧 충전">
        <ProductUsageStrip usage={dexorUsage} />
        <div className="grid gap-2">
          {dexorProducts.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => requestAgreement('dexor_credit', product, (snapshot) => startDexorCredit(product.id, snapshot))}
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

    </>
  );
}

function catalogProduct(productsById, id, fallback) {
  const product = productsById[id];
  return product || { id, ...fallback };
}

function pricingPlan(productsById, id, fallback, details = {}) {
  const product = catalogProduct(productsById, id, fallback);
  return {
    id,
    product,
    priceText: price(fallback.amount) + (fallback.billing_cycle === 'monthly' ? ' / 월' : ''),
    testOnly: !productsById[id],
    ...details
  };
}

function buildWorkspacePricingCatalog({ productsById, cujasaPlans, currentUser }) {
  const grants = currentUser?.products || [];
  const usageFor = (productId) => getGrantUsage(grants.find((grant) => grant.productId === productId), productId);
  return [
    {
      id: 'cujasa',
      label: 'CUJASA',
      title: '쿠팡 파트너스 자동화',
      modeLabel: '운영형 2단계 요금제',
      description: 'Threads 포스팅, 쿠팡 실상품 검색, 댓글 링크 운영까지 이어지는 자동화 상품입니다.',
      plans: cujasaPlans,
      comparisonRows: [
        { label: 'Threads 계정', values: ['2개', '4개'] },
        { label: '스폰서/광고 라벨', values: ['없음', '없음'] },
        { label: '콘텐츠 생성', values: [true, true] },
        { label: '쿠팡 실상품 검색', values: [true, true] },
        { label: '예약 업로드', values: [true, true] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌'] }
      ]
    },
    {
      id: 'dexor',
      label: 'DEXOR',
      title: '블로그 분석 크레딧',
      modeLabel: '충전형 크레딧',
      description: '블로그 등급/선정 분석을 필요한 만큼 충전해서 쓰는 사용량 기반 상품입니다.',
      usage: usageFor('dexor'),
      plans: [
        pricingPlan(productsById, 'dexor_credit_5000', { name: 'DEXOR 크레딧 10회 충전', app_product_id: 'dexor', amount: 5000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '라이트 충전',
          caption: '작게 테스트하는 분석권',
          buttonLabel: '10회 충전',
          features: ['블로그 분석 10회', '무료 사용량 이후 즉시 추가', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'dexor_credit_10000', { name: 'DEXOR 크레딧 25회 충전', app_product_id: 'dexor', amount: 10000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '베이직 충전',
          caption: '반복 분석용 기본 충전',
          badge: '추천',
          buttonLabel: '25회 충전',
          features: ['블로그 분석 25회', '라이트 대비 낮은 회당 비용', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'dexor_credit_50000', { name: 'DEXOR 크레딧 150회 충전', app_product_id: 'dexor', amount: 50000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '프로 충전',
          caption: '대량 후보 선별용',
          buttonLabel: '150회 충전',
          features: ['블로그 분석 150회', '캠페인 후보 대량 검토', '가상계좌 입금 확인 후 반영']
        })
      ],
      extraTitle: '대량 충전',
      extraPlans: [
        pricingPlan(productsById, 'dexor_credit_100000', { name: 'DEXOR 크레딧 350회 충전', app_product_id: 'dexor', amount: 100000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '350회 대량 충전',
          caption: '운영팀 단위 후보 검토용',
          buttonLabel: '350회 충전'
        })
      ],
      comparisonRows: [
        { label: '분석 횟수', values: ['10회', '25회', '150회'] },
        { label: '과금 방식', values: ['충전형', '충전형', '충전형'] },
        { label: '추천 용도', values: ['테스트', '반복 분석', '대량 선별'] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌', '가상계좌'] }
      ]
    },
    {
      id: 'spread',
      label: 'SPREAD',
      title: '추천 캠페인 운영 자동화',
      modeLabel: '무료 오픈',
      description: '캠페인 생성, 신청자 정리, 제출물 검수를 지금은 무료로 시작할 수 있습니다.',
      plans: [
        pricingPlan(productsById, 'spread_starter_monthly_49000', { name: 'SPREAD 스타터 월정액', app_product_id: 'spread', amount: 49000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '무료 운영',
          priceText: '무료',
          freeStart: true,
          caption: '작은 캠페인 운영 시작',
          buttonLabel: '무료로 시작',
          features: ['캠페인 초안 생성', '신청자/제출물 기본 정리', '워크스페이스 제공']
        }),
        pricingPlan(productsById, 'spread_basic_monthly_149000', { name: 'SPREAD 베이직 월정액', app_product_id: 'spread', amount: 149000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '운영 확장',
          priceText: '무료',
          freeStart: true,
          caption: '추천/선정 자동화 포함',
          badge: '추천',
          buttonLabel: '무료로 시작',
          features: ['월 캠페인 10개', '신청자 추천/선정 자동화', '운영 현황 확인']
        }),
        pricingPlan(productsById, 'spread_pro_monthly_390000', { name: 'SPREAD 프로 월정액', app_product_id: 'spread', amount: 390000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '팀 운영',
          priceText: '무료',
          freeStart: true,
          caption: '운영팀 캠페인 관리용',
          buttonLabel: '무료로 시작',
          features: ['월 캠페인 30개', '제출물/운영 리포트', '우선 지원']
        })
      ],
      comparisonRows: [
        { label: '캠페인 한도', values: ['3개 / 월', '10개 / 월', '30개 / 월'] },
        { label: '신청자 정리', values: [true, true, true] },
        { label: '추천/선정 자동화', values: ['기본', '포함', '고급'] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌', '가상계좌'] }
      ]
    },
    {
      id: 'polibot',
      label: 'POLIBOT',
      title: '보험 상담/추천 자동화',
      modeLabel: '운영형 3단계 요금제',
      description: '고객 상담 맥락, 보장분석 자료, 상품 추천 근거를 정리하는 상담 운영 상품입니다.',
      plans: [
        pricingPlan(productsById, 'polibot_starter_monthly_39000', { name: 'POLIBOT 스타터 월정액', app_product_id: 'polibot', amount: 29000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '스타터',
          caption: '가볍게 상담 추천 시작',
          buttonLabel: '스타터 시작',
          features: ['상담/추천 100회', '지식 업로드 기본', '가상계좌 월 단위 이용']
        }),
        pricingPlan(productsById, 'polibot_basic_monthly_99000', { name: 'POLIBOT 베이직 월정액', app_product_id: 'polibot', amount: 79000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '베이직',
          caption: '고객별 추천 히스토리',
          badge: '추천',
          buttonLabel: '베이직 시작',
          features: ['상담/추천 500회', '고객별 추천 히스토리', '상품 추천 근거 정리']
        }),
        pricingPlan(productsById, 'polibot_lifetime_590000', { name: 'POLIBOT 프로 영구구매', app_product_id: 'polibot', amount: 590000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '프로 영구구매',
          caption: '팀 단위 상담 운영',
          buttonLabel: '영구구매 신청',
          features: ['상담/추천 장기 이용', '팀 단위 운영', '우선 지원']
        })
      ],
      comparisonRows: [
        { label: '상담/추천 한도', values: ['100회 / 월', '500회 / 월', '장기 이용'] },
        { label: '지식 업로드', values: ['기본', '확장', '팀 운영'] },
        { label: '추천 히스토리', values: ['기본', '포함', '고급'] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌', '가상계좌'] }
      ]
    },
    {
      id: 'infludex',
      label: 'INFLUDEX',
      title: '인플루언서 후보 분석 크레딧',
      modeLabel: '충전형 크레딧',
      description: '인스타그램 후보 1명 단위로 등급, 적합도, 리스크를 분석하는 사용량 기반 상품입니다.',
      usage: usageFor('infludex'),
      plans: [
        pricingPlan(productsById, 'infludex_credit_5000', { name: 'INFLUDEX 라이트 분석 30회', app_product_id: 'infludex', amount: 5000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '라이트 분석',
          caption: '작은 후보군 검토',
          buttonLabel: '30회 충전',
          features: ['후보 분석 30회', '등급/리스크 확인', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'infludex_credit_10000', { name: 'INFLUDEX 베이직 분석 100회', app_product_id: 'infludex', amount: 10000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '베이직 분석',
          caption: '캠페인 후보 선별용',
          badge: '추천',
          buttonLabel: '100회 충전',
          features: ['후보 분석 100회', '캠페인 후보 비교', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'infludex_credit_50000', { name: 'INFLUDEX 프로 분석 250회', app_product_id: 'infludex', amount: 50000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '프로 분석',
          caption: '대량 후보 검토',
          buttonLabel: '250회 충전',
          features: ['후보 분석 250회', '대량 후보 등급 분석', '가상계좌 입금 확인 후 반영']
        })
      ],
      comparisonRows: [
        { label: '분석 횟수', values: ['30회', '100회', '250회'] },
        { label: '분석 대상', values: ['후보 1명 단위', '후보 1명 단위', '후보 1명 단위'] },
        { label: '추천 용도', values: ['소규모', '캠페인 선별', '대량 검토'] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌', '가상계좌'] }
      ]
    }
  ];
}

function TestBillingPricingPage({
  currentUser,
  billing,
  productsById,
  latestWaiting,
  activeSubscription,
  cujasaPlans,
  busy,
  load,
  requestAgreement,
  startOnetime,
  startMonthly,
  startFreeProduct
}) {
  const [activeProductId, setActiveProductId] = useState('cujasa');
  const productPricing = useMemo(() => buildWorkspacePricingCatalog({ productsById, cujasaPlans, currentUser }), [productsById, cujasaPlans, currentUser]);
  const activePricing = productPricing.find((item) => item.id === activeProductId) || productPricing[0];
  const openPlan = (plan) => {
    if (plan.testOnly) return;
    if (plan.freeStart) {
      startFreeProduct?.(activePricing.id);
      return;
    }
    const flow = plan.product?.billing_cycle === 'once' ? 'onetime' : 'monthly';
    const runner = flow === 'onetime'
      ? (snapshot) => startOnetime(plan.id, snapshot)
      : (snapshot) => startMonthly(plan.id, snapshot);
    requestAgreement(flow, plan.product, runner);
  };

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#171717] text-zinc-100 shadow-2xl shadow-black/30">
        <div className="grid gap-5 bg-[#202020] px-5 pb-7 pt-5 lg:grid-cols-[1.1fr_1fr_auto] lg:items-center lg:px-7 lg:pb-8">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-zinc-500">JASAIN 결제 관리</div>
            <h2 className="mt-3 text-2xl font-black tracking-normal text-zinc-50">제품별 이용 방식에 맞는 요금제를 선택하세요</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {currentUser?.email || currentUser?.username || 'JASAIN 계정'} · 현재 {billingTitle(billing)}
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="text-xs font-black text-zinc-500">현재 이용 한도</div>
            <div className="mt-1 text-xl font-black text-zinc-50">Threads 계정 {billing?.maxAccounts ?? currentUser?.maxAccounts ?? 2}개</div>
            <div className="mt-1 text-xs font-bold text-zinc-500">
              {billing?.paidUntil && billing?.status !== 'past_due' ? `${formatBillingDate(billing.paidUntil)}까지 이용 가능` : '결제 상태를 기준으로 자동화 권한이 정해집니다.'}
            </div>
          </div>
          <button type="button" onClick={() => load().catch(() => {})} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-zinc-100 hover:bg-white/10">
            <RefreshCw size={16} />
            새로고침
          </button>
        </div>

        <div className="border-t border-white/10 bg-black/20 px-4 py-4 lg:px-7">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {productPricing.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => setActiveProductId(product.id)}
                className={`shrink-0 rounded-2xl border px-4 py-2 text-sm font-black transition ${activePricing.id === product.id ? 'border-white/30 bg-zinc-100 text-zinc-950' : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/10 hover:text-zinc-100'}`}
              >
                {product.label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.08em] text-zinc-500">{activePricing.modeLabel}</div>
              <h3 className="mt-2 text-xl font-black text-zinc-50">{activePricing.title}</h3>
              <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-zinc-400">{activePricing.description}</p>
            </div>
            {activePricing.usage && (
              <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-right">
                <div className="text-xs font-black text-zinc-500">현재 사용량</div>
                <div className="mt-1 text-xl font-black text-zinc-50">{usageRemainingLabel(activePricing.usage)}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{usageSummaryLabel(activePricing.usage)}</div>
              </div>
            )}
          </div>
        </div>

        {billing?.status === 'past_due' && (
          <div className="border-b border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm font-black text-rose-200 lg:px-7">
            자동화 실행이 잠시 중지됐어요. 월결제를 연장하거나 영구구매로 전환해 주세요.
          </div>
        )}
        {latestWaiting && (
          <div className="border-b border-amber-400/20 bg-amber-400/10 px-5 py-3 text-sm font-bold text-amber-200 lg:px-7">
            입금 대기 중 · {productsById[latestWaiting.productId]?.name || 'CUJASA 베이직'} · {price(latestWaiting.amount)}
          </div>
        )}

        <div className={`grid gap-0 border-t border-white/10 ${activePricing.plans.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
          {activePricing.plans.map((plan, index) => (
            <TestPricingColumn
              key={plan.id}
              plan={plan}
              index={index}
              activeSubscription={activeSubscription}
              busy={busy === plan.id}
              onClick={() => openPlan(plan)}
            />
          ))}
        </div>

        {activePricing.extraPlans?.length > 0 && (
          <div className="border-t border-white/10 bg-black/20 px-5 py-4 lg:px-7">
            <div className="mb-3 text-xs font-black uppercase tracking-[0.08em] text-zinc-500">{activePricing.extraTitle || '추가 상품'}</div>
            <div className="grid gap-2 lg:grid-cols-2">
              {activePricing.extraPlans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => openPlan(plan)}
                  disabled={busy === plan.id || !plan.product || plan.testOnly}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-black text-zinc-100">{plan.title}</span>
                    <span className="mt-1 block text-xs font-bold text-zinc-500">{plan.caption}</span>
                  </span>
                  <span className="shrink-0 text-sm font-black text-zinc-100">{plan.priceText}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-x-auto border-t border-white/10">
          <table className="w-full min-w-[820px] border-collapse text-sm">
            <tbody>
              {activePricing.comparisonRows.map((row) => (
                <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                  <th className="w-[28%] bg-black/25 px-5 py-4 text-left font-black text-zinc-300 lg:px-7">{row.label}</th>
                  {row.values.map((value, index) => (
                    <td key={`${row.label}-${index}`} className={`w-[24%] border-l border-white/10 px-5 py-4 text-center font-bold ${index === 1 ? 'bg-white/[0.06] text-zinc-50' : 'bg-[#191919] text-zinc-300'}`}>
                      {value === true ? <CheckCircle2 className="mx-auto text-zinc-100" size={18} /> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function TestPricingColumn({ plan, index, busy, onClick }) {
  const featured = Boolean(plan.featured);
  return (
    <article className={`flex min-h-[390px] flex-col border-b border-white/10 px-6 py-7 lg:border-b-0 lg:border-l lg:px-7 lg:py-8 lg:first:border-l-0 ${featured ? 'bg-white/[0.07]' : 'bg-[#171717]'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.08em] text-zinc-500">{plan.product?.billing_cycle === 'once' ? 'Lifetime' : 'Growth'}</div>
          <h3 className={`mt-4 text-2xl font-black leading-snug tracking-normal ${plan.testOnly ? 'text-zinc-500' : 'text-zinc-50'}`}>{plan.title}</h3>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">{plan.caption}</p>
        </div>
        {plan.badge && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${featured ? 'bg-zinc-100 text-zinc-950' : 'bg-white/10 text-zinc-300'}`}>
            {plan.badge}
          </span>
        )}
      </div>
      <PriceDisplay originalPriceText={plan.originalPriceText} priceText={plan.priceText} className="mt-9" />
      <ul className="mt-8 grid gap-5 text-sm font-bold leading-7 text-zinc-300">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-3">
            <CheckCircle2 size={17} className="mt-1 shrink-0 text-zinc-100" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !plan.product || plan.testOnly}
        className={`mt-10 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${featured ? 'bg-zinc-100 text-zinc-950 hover:bg-white' : 'bg-white/10 text-zinc-50 hover:bg-white/15'}`}
      >
        {busy && <RefreshCw size={16} className="shrink-0 animate-spin" />}
        {busy ? '진행 중' : plan.testOnly ? '상품 등록 후 활성화' : plan.buttonLabel}
      </button>
      {plan.testOnly && <div className="mt-3 text-center text-xs font-bold text-amber-600">테스트 표시 · 결제 미연동</div>}
    </article>
  );
}

function AccountInfoRow({ label, value }) {
  return (
    <div className="grid gap-1 rounded-2xl bg-black/25 px-4 py-3">
      <div className="text-[11px] font-black uppercase tracking-wide text-zinc-600">{label}</div>
      <div className="break-words text-sm font-bold text-zinc-200">{displayValue(value)}</div>
    </div>
  );
}

function LegacyBetaPlanCard({ icon: Icon, title, priceText, originalPriceText, caption, product, busy, onClick }) {
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
          <PriceDisplay originalPriceText={originalPriceText} priceText={priceText} className="mt-1" size="compact" />
          <div className="mt-1 text-sm text-zinc-500">{caption}</div>
        </div>
      </div>
      <DarkButton onClick={onClick} disabled={busy || !product} loading={busy} loadingLabel="진행 중" className="mt-4 w-full">
        결제하기
      </DarkButton>
    </PanelCard>
  );
}

function PriceDisplay({ originalPriceText, priceText, className = '', size = 'default', featured = false }) {
  const priceClass = size === 'compact' ? 'text-2xl' : 'text-3xl';
  const originalClass = featured ? 'text-zinc-500' : 'text-zinc-500';
  const currentClass = featured ? 'text-zinc-950' : 'text-zinc-50';
  return (
    <div className={`grid gap-1 leading-tight tracking-normal ${className}`}>
      {originalPriceText && <span className={`text-sm font-black line-through ${originalClass}`}>{originalPriceText}</span>}
      <span className={`${priceClass} font-black ${currentClass}`}>{priceText}</span>
    </div>
  );
}

function BetaPlanCard({ icon: Icon, title, priceText, originalPriceText, caption, badge, features = [], featured = false, testOnly = false, buttonLabel = '결제하기', product, busy, onClick }) {
  return (
    <div className={`flex min-h-[360px] flex-col rounded-3xl border p-4 ${featured ? 'border-white/30 bg-zinc-100 text-zinc-950' : 'border-white/10 bg-black/25 text-zinc-100'}`}>
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-2xl ${featured ? 'bg-zinc-950 text-white' : 'bg-white/10 text-zinc-100'}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={`font-black ${featured ? 'text-zinc-950' : 'text-zinc-100'}`}>{title}</h3>
            {badge && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${featured ? 'bg-zinc-950 text-white' : 'bg-white/10 text-zinc-300'}`}>
                {badge}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${featured ? 'border-zinc-300 text-zinc-600' : 'border-white/10 text-zinc-500'}`}>
              <ShieldCheck size={12} />
              계정 {product?.max_accounts ?? 2}개
            </span>
            {testOnly && (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-black text-amber-300">
                테스트 표시
              </span>
            )}
          </div>
        </div>
      </div>
      <PriceDisplay originalPriceText={originalPriceText} priceText={priceText} className="mt-5" size="compact" featured={featured} />
      <div className={`mt-2 min-h-10 text-sm leading-relaxed ${featured ? 'text-zinc-600' : 'text-zinc-500'}`}>{caption}</div>
      <ul className={`mt-5 grid gap-2 text-xs font-bold leading-relaxed ${featured ? 'text-zinc-700' : 'text-zinc-300'}`}>
        {features.map((item) => (
          <li key={item} className="flex gap-2">
            <CheckCircle2 size={14} className={`mt-0.5 shrink-0 ${featured ? 'text-coupang' : 'text-zinc-500'}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !product || testOnly}
        className={`mt-auto inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${featured ? 'bg-zinc-950 text-white hover:bg-black' : 'bg-white text-zinc-950 hover:bg-zinc-200'}`}
      >
        {busy && <RefreshCw size={16} className="shrink-0 animate-spin" />}
        {busy ? '진행 중' : testOnly ? '상품 등록 후 활성화' : buttonLabel}
      </button>
    </div>
  );
}

function BetaPostsPanel({ account, currentUser, queue, posts, loading, reloadWorkspaceData, pipelineResult }) {
  const [expandedId, setExpandedId] = useState(null);
  const [detail, setDetail] = useState({});
  const [loadingDetailId, setLoadingDetailId] = useState('');
  const [dismissingId, setDismissingId] = useState('');
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);

  const scheduled = queue.filter((row) => row.status === 'scheduled').sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const posted = queue.filter((row) => row.status === 'posted').sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
  const needsAttention = queue.filter((row) => ['failed', 'retry', 'manual_required'].includes(row.status) || isPostedLinkIssue(row)).sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

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

  const loadDiagnostics = async () => {
    if (!account?.id) return;
    setDiagnosticsLoading(true);
    try {
      const payload = await api.get(`/api/product-workspace/cujasa/queue-diagnostics/${account.id}?limit=30`);
      setDiagnostics(payload);
    } catch (err) {
      console.error(err);
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  if (loading) return <Notice>포스팅 현황을 불러오는 중이에요.</Notice>;

  return (
    <>
      {pipelineResult && <PipelineResultCard pipelineResult={pipelineResult} account={account} currentUser={currentUser} />}
      <PanelCard title="계정별 E2E 진단">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-bold leading-relaxed text-zinc-400">글 품질, 상품 매칭, 큐 모드, 본문 업로드, 댓글 링크 실패 원인을 한 줄로 확인해요.</div>
          <DarkButton variant="ghost" onClick={loadDiagnostics} disabled={diagnosticsLoading} loading={diagnosticsLoading} loadingLabel="진단 중">진단 새로고침</DarkButton>
        </div>
        {diagnostics && (
          <div className="mt-4 grid gap-3">
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs font-black text-zinc-500 sm:grid-cols-5">
              <div>전체 {diagnostics.summary?.total || 0}</div>
              <div>링크 글 {diagnostics.summary?.linkRows || 0}</div>
              <div>상품 매칭 {diagnostics.summary?.productMatched || 0}</div>
              <div>권한 필요 {diagnostics.summary?.replyPermissionRequired || 0}</div>
              <div>링크 확인 {diagnostics.summary?.untrustedPostUrls || 0}</div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10">
              <table className="min-w-[960px] w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-[11px] font-black uppercase tracking-wide text-zinc-600">
                  <tr>
                    <th className="px-3 py-3">글/상태</th>
                    <th className="px-3 py-3">품질</th>
                    <th className="px-3 py-3">상품</th>
                    <th className="px-3 py-3">큐</th>
                    <th className="px-3 py-3">완료 URL</th>
                    <th className="px-3 py-3">댓글</th>
                    <th className="px-3 py-3">다음 조치</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {(diagnostics.rows || []).slice(0, 12).map((row) => (
                    <tr key={row.id} className="align-top text-zinc-300">
                      <td className="px-3 py-3">
                        <div className="font-black text-zinc-100">{row.topicTitle || row.postId || '제목 없음'}</div>
                        <div className="mt-1 text-zinc-600">{row.statusLabel}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-2 py-1 font-black ${row.quality?.ok ? 'bg-emerald-400/10 text-emerald-100' : 'bg-rose-400/10 text-rose-100'}`}>{row.quality?.ok ? '통과' : '확인'}</span>
                      </td>
                      <td className="px-3 py-3">
                        <div className={row.productMatching?.ok ? 'text-emerald-100' : 'text-rose-100'}>{row.productMatching?.ok ? `실상품 ${row.productMatching.realCount}개` : '상품 없음/불량'}</div>
                        <div className="mt-1 line-clamp-2 text-zinc-600">{row.productMatching?.products?.[0]?.name || ''}</div>
                      </td>
                      <td className="px-3 py-3 font-black text-zinc-200">{row.postMode}</td>
                      <td className="px-3 py-3">
                        <div className={row.upload?.urlStatus?.trusted ? 'text-emerald-100' : 'font-black text-amber-200'}>{row.upload?.urlStatus?.label || '확인 필요'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className={row.reply?.classification?.severity === 'error' ? 'font-black text-rose-100' : 'text-zinc-300'}>{row.reply?.status}</div>
                        {row.failure && <div className="mt-1 text-zinc-600">{row.failure.title}</div>}
                      </td>
                      <td className="px-3 py-3 font-bold text-zinc-400">{row.nextAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PanelCard>
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
  const [targetCategory, setTargetCategory] = useState('자동');
  const [saving, setSaving] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const urlCount = urls.split(/\s+/).map((item) => item.trim()).filter(Boolean).length;
  const workspaceLoading = !workspaceLoaded;
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
      .catch((err) => toast(err.message || 'DEXOR 후보를 불러오지 못했어요.', 'error'))
      .finally(() => setWorkspaceLoaded(true));
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
      setTargetCategory('자동');
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
        <label className={labelClass}>
          분석 기준
          <select
            className={inputClass}
            value={dexorCategoryOptions.includes(targetCategory) ? targetCategory : '자동'}
            onChange={(event) => setTargetCategory(event.target.value)}
          >
            {dexorCategoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
        </label>
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
          현재 입력 후보 {urlCount}개 · {targetCategory === '자동' ? '파일/후보 정보 우선' : targetCategory} 기준으로 S/A/B/C/D 랭크를 분석해요.
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <DarkButton onClick={save} disabled={saving || (urlCount === 0 && !fileName)} loading={saving} loadingLabel="저장 중">
          후보 저장
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

function extractDexorBlogId(url = '') {
  const match = String(url || '').match(/blog\.naver\.com\/([a-zA-Z0-9._-]+)/i);
  return match?.[1]?.toLowerCase() || '';
}

function parseDexorKeywords(input = '') {
  return String(input || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseDexorSearchRows(input = '', keywords = []) {
  const rows = [];
  let currentKeyword = keywords[0] || '미지정 키워드';
  const rankByKeyword = {};
  String(input || '').split(/\n|\r/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^#/.test(line)) {
      currentKeyword = line.replace(/^#+/, '').trim() || currentKeyword;
      return;
    }
    const cells = line.split(/[,\t]/).map((cell) => cell.trim()).filter(Boolean);
    const urlCell = cells.find((cell) => /blog\.naver\.com\//i.test(cell));
    if (!urlCell) {
      currentKeyword = line;
      return;
    }
    const keywordCell = cells.find((cell) => cell !== urlCell && !/^https?:\/\//i.test(cell));
    const keyword = keywordCell || currentKeyword || keywords[0] || '미지정 키워드';
    rankByKeyword[keyword] = (rankByKeyword[keyword] || 0) + 1;
    rows.push({
      keyword,
      url: urlCell,
      blogId: extractDexorBlogId(urlCell),
      rank: rankByKeyword[keyword]
    });
  });
  return rows.filter((row) => row.blogId);
}

function dexorRankScore(rank) {
  if (!rank) return 0;
  if (rank <= 3) return 100;
  if (rank <= 5) return 88;
  if (rank <= 10) return 72;
  if (rank <= 20) return 48;
  if (rank <= 30) return 30;
  return 12;
}

function dexorRecencyScore(item = {}) {
  if (!item.recentPostAt) return 45;
  const time = new Date(String(item.recentPostAt).replace(/[./]/g, '-')).getTime();
  if (!Number.isFinite(time)) return 45;
  const days = Math.max(0, Math.floor((Date.now() - time) / (24 * 60 * 60 * 1000)));
  if (days <= 30) return 100;
  if (days <= 90) return 70;
  if (days <= 180) return 42;
  return 18;
}

function dexorFinalGrade(item = {}, validation = {}) {
  const baseGrade = item.strengthenedGrade || item.scoreLabel || item.grade || 'D';
  const score = Number(validation.validationScore || 0);
  const hasExposure = validation.matches?.length > 0;
  if (['S', 'A'].includes(baseGrade) && score >= 80) return 'S';
  if (['S', 'A'].includes(baseGrade) && score >= 60) return 'A';
  if (['S', 'A', 'B'].includes(baseGrade) && hasExposure) return 'B';
  if (baseGrade === 'A') return 'B';
  return baseGrade;
}

function buildDexorValidationRows(results = [], keywordInput = '', searchInput = '') {
  const keywords = parseDexorKeywords(keywordInput);
  const searchRows = parseDexorSearchRows(searchInput, keywords);
  return results.map((item) => {
    const blogId = extractDexorBlogId(item.url);
    const matches = searchRows.filter((row) => row.blogId === blogId);
    const bestRank = matches.reduce((min, row) => Math.min(min, row.rank), Infinity);
    const matchedKeywords = [...new Set(matches.map((row) => row.keyword))];
    const rankScore = Number.isFinite(bestRank) ? dexorRankScore(bestRank) : 0;
    const recencyScore = dexorRecencyScore(item);
    const diversityScore = Math.min(100, Math.round((matchedKeywords.length / Math.max(1, Math.min(3, keywords.length || 3))) * 100));
    const categoryScore = item.targetCategory === '기타' || !item.candidateCategory || item.candidateCategory === '미입력' || item.candidateCategory === item.targetCategory ? 100 : 35;
    const validationScore = Math.round(rankScore * 0.5 + recencyScore * 0.25 + diversityScore * 0.15 + categoryScore * 0.1);
    const validation = {
      matches,
      matchedKeywords,
      bestRank: Number.isFinite(bestRank) ? bestRank : null,
      validationScore,
      status: matches.length ? '노출 확인' : '미노출',
      label: matches.length ? `${matchedKeywords.length}개 키워드 · 최고 ${bestRank}위` : '검색 결과 내 미노출'
    };
    return {
      ...item,
      exposureValidation: validation,
      finalGrade: dexorFinalGrade(item, validation),
      finalScore: Math.round(((item.strengthenedScore || item.score || 0) * 0.65) + validationScore * 0.35)
    };
  });
}

function DexorGradePanel({ reloadCurrentUser, onOpenUpload, onOpenBilling }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [analyzing, setAnalyzing] = useState(false);
  const results = sortDexorResults(Array.isArray(workspace.analysisResults) ? workspace.analysisResults : []);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const usage = workspaceUsage(workspace);
  const gradeRows = dexorScoreRows.map(([grade, range, description]) => [
    grade,
    results.filter((item) => (item.strengthenedGrade || item.scoreLabel || item.grade) === grade).length,
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
      <PanelCard title="등급 요약">
        <ProductUsageStrip usage={usage} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {gradeRows.map(([grade, count]) => (
            <div key={grade} className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-base font-black text-zinc-100">{grade}</div>
              <div className="mt-2 text-lg font-black text-zinc-300">{count}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={analyze} disabled={analyzing || candidates.length === 0 || usage.remaining <= 0} loading={analyzing} loadingLabel="분석 중">
            {usage.remaining <= 0 ? '남은 횟수 없음' : `후보 ${candidates.length}개 분석`}
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
            const strengthenedRank = item.strengthenedGrade || displayRank;
            const adjusted = strengthenedRank !== displayRank;
            return (
              <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-zinc-200">{item.blogName || item.url}</div>
                    <div className="mt-0.5 truncate text-xs text-zinc-600">{item.url}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-black text-zinc-100">
                      {adjusted ? `${displayRank} → ${strengthenedRank}` : strengthenedRank}
                    </div>
                    <div className="mt-1 text-xs font-black text-zinc-500">{item.strengthenedScore || item.score}점</div>
                  </div>
                </div>
                <div className="mt-2 text-xs font-bold text-zinc-300">{item.strengthenedDecision || item.scoreComment || dexorScoreComment(item.score)}</div>
                <div className="mt-2 text-xs font-bold text-zinc-600">{item.candidateCategory || item.targetCategory || '카테고리 미입력'}</div>
              </div>
            );
          })}
          </div>
        )}
      </PanelCard>
    </>
  );
}

function DexorSignal({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[11px] font-black text-zinc-600">{label}</div>
      <div className="mt-1 truncate text-xs font-black text-zinc-200">{value}</div>
      <div className="mt-0.5 truncate text-[11px] font-bold text-zinc-600">{sub}</div>
    </div>
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
    const header = ['url', 'blogName', 'targetCategory', 'candidateCategory', 'rank', 'score', 'finalRank', 'finalScore', 'materialStatus', 'searchStatus', 'comment', 'summary'];
    const rows = results.map((item) => [
      item.url || '미입력',
      item.blogName || '미입력',
      item.targetCategory || workspace.targetCategory || '미입력',
      item.candidateCategory || '미입력',
      item.scoreLabel || item.grade || '미입력',
      item.score ?? '미입력',
      item.strengthenedGrade || item.scoreLabel || item.grade || '미입력',
      item.strengthenedScore ?? item.score ?? '미입력',
      item.dataConfidence?.level || '미입력',
      item.searchValidation?.label || '확인 전',
      item.strengthenedDecision || item.scoreComment || dexorScoreComment(item.score),
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

function normalizeSpreadCampaigns(workspace = {}) {
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
  if (campaigns.length > 0) return campaigns;
  if (!workspace.campaignDraft) return [];
  return [{
    id: workspace.campaignDraft.id || 'legacy-spread-campaign',
    title: workspace.campaignDraft.title || workspace.campaignDraft.headline || `${workspace.campaignDraft.product || '제품'} 체험단`,
    status: workspace.campaignDraft.status || 'draft',
    applicants: Array.isArray(workspace.applicants) ? workspace.applicants : [],
    submissionReview: workspace.submissionReview || null,
    ...workspace.campaignDraft
  }];
}

function spreadStatusLabel(status = 'draft') {
  const labels = {
    draft: '초안',
    recruiting: '모집 중',
    selecting: '선정 중',
    reviewing: '검수 중',
    completed: '완료'
  };
  return labels[status] || status;
}

function SpreadCampaignOperationsCard({ campaign, workspace, setWorkspace, reloadCurrentUser, toast, usage }) {
  const [applicantForm, setApplicantForm] = useState({
    applicants: (campaign.applicants || []).map((item) => item.name).join('\n'),
    criteria: (campaign.applicantCriteria || workspace.applicantCriteria || []).join('\n')
  });
  const [reviewForm, setReviewForm] = useState({
    url: campaign.submissionReview?.url || '',
    required: (campaign.submissionReview?.required || []).join('\n'),
    forbidden: (campaign.submissionReview?.forbidden || []).join('\n')
  });
  const [savingApplicants, setSavingApplicants] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  useEffect(() => {
    setApplicantForm({
      applicants: (campaign.applicants || []).map((item) => item.name).join('\n'),
      criteria: (campaign.applicantCriteria || workspace.applicantCriteria || []).join('\n')
    });
    setReviewForm({
      url: campaign.submissionReview?.url || '',
      required: (campaign.submissionReview?.required || []).join('\n'),
      forbidden: (campaign.submissionReview?.forbidden || []).join('\n')
    });
  }, [campaign, workspace.applicantCriteria]);

  const saveApplicants = async () => {
    setSavingApplicants(true);
    try {
      const next = await api.post('/api/product-workspace/spread/applicants', { ...applicantForm, campaignId: campaign.id });
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('참여자 선정 초안을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '참여자 선정에 실패했어요.', 'error');
    } finally {
      setSavingApplicants(false);
    }
  };

  const saveReview = async () => {
    setSavingReview(true);
    try {
      const next = await api.post('/api/product-workspace/spread/review', { ...reviewForm, campaignId: campaign.id });
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('제출물 검수 초안을 만들었어요.', 'success');
    } catch (err) {
      toast(err.message || '제출물 검수에 실패했어요.', 'error');
    } finally {
      setSavingReview(false);
    }
  };

  const updateStatus = async (status) => {
    setSavingStatus(true);
    try {
      const next = await api.post('/api/product-workspace/spread/campaign/status', { campaignId: campaign.id, status });
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('캠페인 상태를 변경했어요.', 'success');
    } catch (err) {
      toast(err.message || '캠페인 상태 변경에 실패했어요.', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <PanelCard title="캠페인 운영 카드">
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <div className="rounded-3xl bg-black/25 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-black text-zinc-100">{campaign.title || campaign.headline}</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500">{campaign.mission}</p>
            </div>
            <label className="shrink-0 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600">
              상태
              <select
                className="mt-1 block rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-black text-zinc-200 outline-none"
                value={campaign.status || 'draft'}
                onChange={(event) => updateStatus(event.target.value)}
                disabled={savingStatus}
              >
                <option value="draft">초안</option>
                <option value="recruiting">모집 중</option>
                <option value="selecting">선정 중</option>
                <option value="reviewing">검수 중</option>
                <option value="completed">완료</option>
              </select>
            </label>
          </div>
          <div className="mt-4 grid gap-2">
            {(campaign.checklist || []).map((item) => (
              <div key={item} className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">{item}</div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-black text-zinc-200">신청자 선정</div>
            <div className="mt-3 grid gap-3">
              <label className={labelClass}>신청자 목록<textarea className={inputClass} rows="4" value={applicantForm.applicants} onChange={(event) => setApplicantForm((prev) => ({ ...prev, applicants: event.target.value }))} placeholder={'신청자 A\n신청자 B\n신청자 C'} /></label>
              <label className={labelClass}>선정 기준<textarea className={inputClass} rows="3" value={applicantForm.criteria} onChange={(event) => setApplicantForm((prev) => ({ ...prev, criteria: event.target.value }))} placeholder={'최근 활동성\n카테고리 적합도\n제출 가능 일정'} /></label>
              <DarkButton onClick={saveApplicants} disabled={savingApplicants || usage.remaining <= 0} loading={savingApplicants} loadingLabel="정리 중">참여자 선정 정리</DarkButton>
            </div>
            {(campaign.applicants || []).length > 0 && (
              <div className="mt-3 grid gap-2">
                {campaign.applicants.map((row) => (
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
                    <div>
                      <div className="text-sm font-black text-zinc-200">{row.name}</div>
                      <div className="mt-0.5 text-xs text-zinc-600">{row.reason}</div>
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-500">{row.status} · {row.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-black text-zinc-200">제출물 검수</div>
            <div className="mt-3 grid gap-3">
              <label className={labelClass}>제출 URL<input className={inputClass} value={reviewForm.url} onChange={(event) => setReviewForm((prev) => ({ ...prev, url: event.target.value }))} placeholder="https://..." /></label>
              <label className={labelClass}>필수 키워드<textarea className={inputClass} rows="3" value={reviewForm.required} onChange={(event) => setReviewForm((prev) => ({ ...prev, required: event.target.value }))} placeholder={'브랜드명\n제품명\n필수 해시태그'} /></label>
              <label className={labelClass}>금지 표현<textarea className={inputClass} rows="3" value={reviewForm.forbidden} onChange={(event) => setReviewForm((prev) => ({ ...prev, forbidden: event.target.value }))} placeholder={'100% 보장\n치료\n과장 표현'} /></label>
              <DarkButton onClick={saveReview} disabled={savingReview || usage.remaining <= 0} loading={savingReview} loadingLabel="검수 중">제출물 검수</DarkButton>
            </div>
            {campaign.submissionReview?.checks?.length > 0 && (
              <div className="mt-3 grid gap-2">
                {campaign.submissionReview.checks.map((check) => (
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
          </div>
        </div>
      </div>
    </PanelCard>
  );
}

function SpreadCampaignPanel({ assistantDraft, reloadCurrentUser }) {
  const toast = useToast();
  const [draft, setDraft] = useState({ goal: '', channel: '', product: '' });
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [selectedCampaignId, setSelectedCampaignId] = useState('');
  const usage = workspaceUsage(workspace);
  const campaigns = normalizeSpreadCampaigns(workspace);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId) || campaigns[0] || null;
  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => {
        setWorkspace(data || {});
        const nextCampaigns = normalizeSpreadCampaigns(data || {});
        setSelectedCampaignId((current) => current || data?.selectedCampaignId || nextCampaigns[0]?.id || '');
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
      const nextCampaigns = normalizeSpreadCampaigns(next || {});
      setSelectedCampaignId(next.selectedCampaignId || nextCampaigns[0]?.id || '');
      setOpenForm(false);
      await reloadCurrentUser?.();
      toast('체험단/캠페인을 등록했어요.', 'success');
    } catch (err) {
      toast(err.message || '캠페인 등록에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PanelCard title="등록된 체험단/캠페인">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-2">
          {campaigns.length === 0 && <Notice>등록된 체험단/캠페인이 없어요. 아래에서 새 캠페인을 먼저 등록해 주세요.</Notice>}
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => setSelectedCampaignId(campaign.id)}
              className={`rounded-3xl border px-4 py-4 text-left transition ${selectedCampaign?.id === campaign.id ? 'border-white/20 bg-white/10' : 'border-white/10 bg-black/25 hover:bg-white/5'}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-base font-black text-zinc-100">{campaign.title || campaign.headline}</div>
                  <div className="mt-1 truncate text-xs font-bold text-zinc-500">{[campaign.product, campaign.channel, campaign.goal].filter(Boolean).join(' · ') || campaign.mission}</div>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-300">{spreadStatusLabel(campaign.status)}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-zinc-500">
                <span>신청자 {(campaign.applicants || []).length}명</span>
                <span>{campaign.submissionReview ? '검수 기록 있음' : '검수 전'}</span>
              </div>
            </button>
          ))}
          <DarkButton variant="ghost" onClick={() => setOpenForm((prev) => !prev)}>
            {openForm ? '등록 폼 닫기' : '새 체험단/캠페인 등록'}
          </DarkButton>
        </div>
      </PanelCard>
      {openForm && (
        <PanelCard title="체험단/캠페인 등록">
          <div className="grid gap-3">
            <label className={labelClass}>목표<input className={inputClass} value={draft.goal} onChange={(event) => update('goal', event.target.value)} placeholder="예: 신제품 체험단 모집" /></label>
            <label className={labelClass}>채널<input className={inputClass} value={draft.channel} onChange={(event) => update('channel', event.target.value)} placeholder="예: 블로그, Threads, 인스타그램" /></label>
            <label className={labelClass}>상품 유형<input className={inputClass} value={draft.product} onChange={(event) => update('product', event.target.value)} placeholder="예: 주방용품, 뷰티, 생활가전" /></label>
            <DarkButton onClick={save} disabled={saving || usage.remaining <= 0} loading={saving} loadingLabel="등록 중">{usage.remaining <= 0 ? '남은 횟수 없음' : '캠페인 등록'}</DarkButton>
            {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
          </div>
        </PanelCard>
      )}
      {selectedCampaign && (
        <SpreadCampaignOperationsCard
          campaign={selectedCampaign}
          workspace={workspace}
          setWorkspace={setWorkspace}
          reloadCurrentUser={reloadCurrentUser}
          toast={toast}
          usage={usage}
        />
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
  const campaigns = normalizeSpreadCampaigns(workspace);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === workspace.selectedCampaignId) || campaigns[0] || null;

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '참여자 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/spread/applicants', { ...form, campaignId: selectedCampaign?.id || '' });
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('참여자 선정 초안을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '참여자 선정에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const rows = Array.isArray(selectedCampaign?.applicants) ? selectedCampaign.applicants : Array.isArray(workspace.applicants) ? workspace.applicants : [];

  return (
    <>
      {selectedCampaign ? <Notice>현재 캠페인: {selectedCampaign.title || selectedCampaign.headline}</Notice> : <Notice>먼저 캠페인을 등록해 주세요.</Notice>}
      <PanelCard title="참여자 입력">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>신청자 목록<textarea className={inputClass} rows="4" value={form.applicants} onChange={(event) => setForm((prev) => ({ ...prev, applicants: event.target.value }))} placeholder={'신청자 A\n신청자 B\n신청자 C'} /></label>
          <label className={labelClass}>선정 기준<textarea className={inputClass} rows="3" value={form.criteria} onChange={(event) => setForm((prev) => ({ ...prev, criteria: event.target.value }))} placeholder={'최근 활동성\n카테고리 적합도\n제출 가능 일정'} /></label>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0 || !selectedCampaign} loading={saving} loadingLabel="정리 중">{usage.remaining <= 0 ? '남은 횟수 없음' : '참여자 선정 정리'}</DarkButton>
          {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
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
  const campaigns = normalizeSpreadCampaigns(workspace);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === workspace.selectedCampaignId) || campaigns[0] || null;

  useEffect(() => {
    api.get('/api/product-workspace/spread')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '검수 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/spread/review', { ...form, campaignId: selectedCampaign?.id || '' });
      setWorkspace(next);
      await reloadCurrentUser?.();
      toast('제출물 검수 초안을 만들었어요.', 'success');
    } catch (err) {
      toast(err.message || '제출물 검수에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const review = selectedCampaign?.submissionReview || workspace.submissionReview;

  return (
    <>
      {selectedCampaign ? <Notice>현재 캠페인: {selectedCampaign.title || selectedCampaign.headline}</Notice> : <Notice>먼저 캠페인을 등록해 주세요.</Notice>}
      <PanelCard title="제출물 입력">
        <ProductUsageStrip usage={usage} />
        <div className="grid gap-3">
          <label className={labelClass}>제출 URL<input className={inputClass} value={form.url} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} placeholder="https://..." /></label>
          <label className={labelClass}>필수 키워드<textarea className={inputClass} rows="3" value={form.required} onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.value }))} placeholder={'브랜드명\n제품명\n필수 해시태그'} /></label>
          <label className={labelClass}>금지 표현<textarea className={inputClass} rows="3" value={form.forbidden} onChange={(event) => setForm((prev) => ({ ...prev, forbidden: event.target.value }))} placeholder={'100% 보장\n치료\n과장 표현'} /></label>
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0 || !selectedCampaign} loading={saving} loadingLabel="검수 중">{usage.remaining <= 0 ? '남은 횟수 없음' : '제출물 검수'}</DarkButton>
          {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
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

function polibotMonthlyChangeItems(report = {}) {
  const items = [
    ...((report.changed || []).slice(0, 5).map((item) => `${item.company} ${item.productName} · 변경: ${(item.changedFields || []).join(', ')}${(item.changeDetails || []).length ? ` · ${(item.changeDetails || []).slice(0, 2).join(' / ')}` : ''}`)),
    ...((report.added || []).slice(0, 3).map((item) => `신규: ${item.company} ${item.productName}`)),
    ...((report.removed || []).slice(0, 3).map((item) => `전월만 존재: ${item.company} ${item.productName}`))
  ].filter(Boolean);
  return items.length ? items : ['전월 비교 대상이 아직 부족합니다.'];
}

function buildLocalPolibotStatus(currentUser = {}) {
  const grant = (currentUser?.products || []).find((item) => item?.productId === 'polibot' && item.status !== 'suspended');
  if (!grant) {
    return {
      productId: 'polibot',
      granted: false,
      health: 'needs_setup',
      summary: 'POLIBOT 사용 권한이 필요합니다.',
      nextAction: '결제',
      actionKey: 'billing',
      usage: workspaceUsage({})
    };
  }
  const summary = grant.settingsSummary?.workspaceSummary || grant.settings?.workspaceSummary || {};
  const usage = getGrantUsage(grant, 'polibot');
  if (summary.hasPolibotRecommendations) {
    return {
      productId: 'polibot',
      granted: true,
      status: grant.status || 'active',
      health: 'ready',
      summary: '저장된 추천 초안이 있습니다.',
      nextAction: '결과 다운로드',
      actionKey: 'polibot-download',
      usage
    };
  }
  return {
    productId: 'polibot',
    granted: true,
    status: grant.status || 'active',
    health: 'empty',
    summary: summary.hasPolibotUpload
      ? '업로드된 자료가 있습니다. 고객 조건을 넣어 추천을 만들 수 있습니다.'
      : '공통 상품 자료 기준으로 고객 조건 입력과 추천 초안을 시작할 수 있습니다.',
    nextAction: '상품 추천',
    actionKey: 'polibot-recommend',
    usage
  };
}

function PolibotUploadPanel({ currentUser, onOpenAction }) {
  const toast = useToast();
  const localStatus = useMemo(() => buildLocalPolibotStatus(currentUser), [currentUser]);
  const [status, setStatus] = useState(localStatus);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const usage = status?.usage || workspaceUsage({});
  const isReady = ['ready', 'empty'].includes(status?.health);
  const readinessLabel = !status?.granted ? '권한 필요' : isReady ? '가능' : status?.health === 'needs_setup' ? '확인 중' : '-';

  const loadWorkspace = useCallback(({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    api.get('/api/product-workspace/polibot/status', { timeoutMs: 5000 })
      .then((data) => setStatus(data || null))
      .catch((err) => {
        setLoadError('최신 상태 확인이 지연되고 있습니다. 현재 화면의 기본 상태로 계속 진행할 수 있습니다.');
        if (!silent) toast(err.message || '자료 준비 상태를 불러오지 못했어요.', 'error');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [toast]);

  useEffect(() => {
    setStatus((prev) => prev || localStatus);
  }, [localStatus]);

  useEffect(() => {
    loadWorkspace({ silent: Boolean(localStatus) });
  }, [loadWorkspace, localStatus]);

  return (
    <>
      <PanelCard title="자료 상태">
        <ProductUsageStrip usage={usage} />
        {loading && !status && <Notice>추천 준비 상태를 확인하고 있어요.</Notice>}
        {loadError && <Notice tone="error">{loadError}</Notice>}
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="text-[11px] font-bold text-zinc-600">사용 상태</div>
            <div className="mt-1 text-lg font-black text-zinc-100">{loading ? '확인 중' : status?.granted ? '사용 가능' : '권한 필요'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="text-[11px] font-bold text-zinc-600">추천 준비</div>
            <div className="mt-1 text-lg font-black text-zinc-100">{readinessLabel}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
            <div className="text-[11px] font-bold text-zinc-600">남은 추천</div>
            <div className="mt-1 text-lg font-black text-zinc-100">{usageRemainingLabel(usage)}</div>
          </div>
        </div>
        {status?.summary && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm font-bold leading-relaxed text-zinc-300">
            {status.summary}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DarkButton onClick={() => loadWorkspace()} disabled={loading || refreshing} loading={loading || refreshing} loadingLabel="확인 중" className="w-auto">
            <RefreshCw size={15} /> 상태 새로고침
          </DarkButton>
          {status?.actionKey && status.actionKey !== 'polibot-upload' && (
            <DarkButton variant="ghost" onClick={() => onOpenAction?.(status.actionKey)} className="w-auto">
              {status.nextAction || '다음 단계'}
            </DarkButton>
          )}
        </div>
      </PanelCard>
    </>
  );
}

function PolibotKnowledgeSummary({ report }) {
  if (!report) return null;
  return (
    <div className="rounded-2xl bg-black/25 px-4 py-3 text-sm leading-relaxed text-zinc-400">
      추천 가능 <span className="font-black text-zinc-100">{report.recommendableProducts || 0}개</span>
      <span className="text-zinc-600"> · </span>
      보험사 <span className="font-black text-zinc-100">{report.companies?.length || 0}개</span>
      <span className="text-zinc-600"> · </span>
      상품군 <span className="font-black text-zinc-100">{report.productGroups?.length || 0}개</span>
    </div>
  );
}

function PolibotLoadingBanner({ label = '처리 중' }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-black text-zinc-200">
      <RefreshCw size={16} className="shrink-0 animate-spin text-zinc-400" />
      <span className="truncate">{label}</span>
    </div>
  );
}

function PolibotLoadingState({ title = '처리 중', description = '잠시만 기다려 주세요.' }) {
  return (
    <div className="grid min-h-[180px] place-items-center rounded-2xl border border-white/10 bg-black/25 px-5 py-8 text-center">
      <div>
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.06]">
          <RefreshCw size={20} className="animate-spin text-zinc-200" />
        </div>
        <div className="mt-3 text-sm font-black text-zinc-100">{title}</div>
        <p className="mt-1 max-w-sm text-xs font-bold leading-relaxed text-zinc-500">{description}</p>
      </div>
    </div>
  );
}

function PolibotRecommendPanel({ assistantDraft, reloadCurrentUser, onOpenAction, currentUser }) {
  const toast = useToast();
  const useStepperRecommendationFlow = true;
  const localStatus = useMemo(() => buildLocalPolibotStatus(currentUser), [currentUser]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    birthdate: '',
    age: '',
    gender: '',
    needs: '',
    budget: '',
    company: '전체 보험사',
    existingPolicies: '',
    existingPolicyDetails: createPolibotPolicyRows(),
    currentCoverage: createPolibotCoverageState(),
    existingMedicalPlan: '',
    existingPremium: '',
    medicalHistory: '',
    disclosureDetails: createPolibotDisclosureState(),
    underwritingAssessment: { ...polibotUnderwritingTemplate },
    analysisResult: { ...polibotAnalysisResultTemplate },
    familyHistory: '',
    driving: '',
    renewalPreference: '',
    purpose: ''
  });
  const [workspace, setWorkspace] = useState(() => ({
    usage: localStatus?.usage || null,
    status: localStatus?.health || '',
    summary: localStatus?.summary || ''
  }));
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  const [saveMemo, setSaveMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [testStep, setTestStep] = useState(1);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(Boolean(localStatus));
  const [coverageDocumentParsing, setCoverageDocumentParsing] = useState(false);
  const [coverageDocumentFileName, setCoverageDocumentFileName] = useState('');
  const [coverageDocumentFiles, setCoverageDocumentFiles] = useState([]);
  const [hiraFileName, setHiraFileName] = useState('');
  const [hiraFiles, setHiraFiles] = useState([]);
  const [hiraPassword, setHiraPassword] = useState('');
  const [hiraParsing, setHiraParsing] = useState(false);
  const workspaceLoading = !workspaceLoaded;
  const usage = workspaceUsage(workspace);
  const summaryCompanies = Array.isArray(workspace.knowledgeDbSummary?.companies)
    ? workspace.knowledgeDbSummary.companies.map((item) => item?.name).filter(Boolean)
    : [];
  const rawCatalogCompanies = Array.isArray(workspace.catalog?.companies) && workspace.catalog.companies.length
    ? workspace.catalog.companies
    : Array.isArray(workspace.qualityReport?.companies) && workspace.qualityReport.companies.length
      ? workspace.qualityReport.companies
      : summaryCompanies;
  const catalogCompanies = rawCatalogCompanies.map(displayValue).filter(Boolean);
  const companies = ['전체 보험사', ...catalogCompanies];
  const recommendations = Array.isArray(workspace.recommendations) ? workspace.recommendations : [];
  const hasAnalysis = Boolean(workspace.consultationDraft);
  const hasRecommendations = recommendations.length > 0;
  const legacyProgressStep = hasRecommendations ? 3 : hasAnalysis ? 2 : 1;
  const selectedNeeds = useMemo(() => normalizeLines(form.needs), [form.needs]);
  const setNeeds = (needs) => setForm((prev) => ({ ...prev, needs: needs.join(', ') }));
  const toggleNeed = (need) => {
    const next = selectedNeeds.includes(need)
      ? selectedNeeds.filter((item) => item !== need)
      : [...selectedNeeds, need];
    setNeeds(next);
  };

  useEffect(() => {
    if (!localStatus) return;
    setWorkspace((prev) => ({
      ...prev,
      usage: prev.usage || localStatus.usage,
      status: prev.status || localStatus.health,
      summary: prev.summary || localStatus.summary
    }));
    setWorkspaceLoaded(true);
  }, [localStatus]);

  useEffect(() => {
    let cancelled = false;
    api.get('/api/product-workspace/polibot/status', { timeoutMs: 5000 })
      .then((data) => {
        if (cancelled) return;
        setWorkspace((prev) => ({
          ...prev,
          usage: data?.usage || prev.usage,
          status: data?.health || prev.status,
          summary: data?.summary || prev.summary,
          catalog: data?.catalog || prev.catalog,
          qualityReport: data?.qualityReport || prev.qualityReport,
          knowledgeDbSummary: data?.knowledgeDbSummary || prev.knowledgeDbSummary
        }));
      })
      .catch((err) => {
        if (!cancelled) toast(err.message || '추천 데이터 일부를 불러오지 못했어요.', 'error');
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    if (assistantDraft?.actionKey !== 'polibot-recommend' || !assistantDraft.values) return;
    const values = assistantDraft.values;
    const eventLines = Array.isArray(values.disclosureDetails?.diseaseEvents)
      ? values.disclosureDetails.diseaseEvents.map((item) => [
        item.occurredAt && `발생일: ${item.occurredAt}`,
        item.eventType && `구분: ${item.eventType}`,
        (item.kcdCode || item.code) && `질병코드: ${item.kcdCode || item.code}`,
        (item.diseaseName || item.name) && `병명: ${item.diseaseName || item.name}`,
        item.status && `상태: ${item.status}`,
        item.memo
      ].filter(Boolean).join(' · ')).filter(Boolean)
      : [];
    setForm((prev) => ({
      ...prev,
      name: values.name ?? prev.name,
      phone: values.phone ?? prev.phone,
      birthdate: values.birthdate ?? prev.birthdate,
      age: values.age ?? prev.age,
      gender: values.gender ?? prev.gender,
      needs: Array.isArray(values.needs) ? values.needs.join(', ') : values.needs ?? prev.needs,
      budget: values.budget ? normalizePolibotPremiumInput(values.budget) : prev.budget,
      company: values.company || prev.company || '전체 보험사',
      existingPolicies: values.existingPolicies ?? prev.existingPolicies,
      existingPolicyDetails: Array.isArray(values.existingPolicyDetails) ? values.existingPolicyDetails : prev.existingPolicyDetails,
      currentCoverage: values.currentCoverage && typeof values.currentCoverage === 'object' ? { ...prev.currentCoverage, ...values.currentCoverage } : prev.currentCoverage,
      existingMedicalPlan: values.existingMedicalPlan ?? prev.existingMedicalPlan,
      existingPremium: values.existingPremium ?? prev.existingPremium,
      medicalHistory: mergePolibotTextLines(prev.medicalHistory, values.medicalHistory, ...eventLines),
      disclosureDetails: values.disclosureDetails && typeof values.disclosureDetails === 'object'
        ? mergePolibotDisclosureDetails(prev.disclosureDetails, values.disclosureDetails)
        : prev.disclosureDetails,
      underwritingAssessment: values.underwritingAssessment && typeof values.underwritingAssessment === 'object' ? { ...prev.underwritingAssessment, ...values.underwritingAssessment } : prev.underwritingAssessment,
      analysisResult: values.analysisResult && typeof values.analysisResult === 'object' ? { ...prev.analysisResult, ...values.analysisResult } : prev.analysisResult,
      familyHistory: values.familyHistory ?? prev.familyHistory,
      driving: values.driving ?? prev.driving,
      renewalPreference: values.renewalPreference ?? prev.renewalPreference,
      purpose: values.purpose ?? prev.purpose
    }));
    if (values.disclosureDetails?.diseaseEvents?.length || values.disclosureDetails?.recent1Year || values.disclosureDetails?.recent5Years) {
      setTestStep(2);
    } else if (values.purpose || values.budget || values.needs) {
      setTestStep(3);
    }
  }, [assistantDraft]);

  const save = async () => {
    setSubmitAttempted(true);
    const effectiveAge = form.age || calculateAgeFromBirthdate(form.birthdate);
    const missingRequired = [
      !effectiveAge && '나이',
      selectedNeeds.length === 0 && '필요 보장',
      !normalizePolibotPremiumInput(form.budget) && '예산'
    ].filter(Boolean);
    if (missingRequired.length > 0) {
      if (useStepperRecommendationFlow) setTestStep(3);
      toast(`추천 전에 ${missingRequired.join(', ')} 정보를 먼저 입력해 주세요.`, 'error');
      return;
    }
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/polibot/recommend', {
        ...form,
        age: effectiveAge,
        needs: selectedNeeds.join(', '),
        budget: normalizePolibotPremiumInput(form.budget),
        medicalHistory: [
          form.medicalHistory,
          form.phone ? `전화번호: ${form.phone}` : '',
          form.birthdate ? `생년월일: ${form.birthdate}` : '',
          hiraFiles.length ? `심평원 파일: ${hiraFiles.map((item) => item.name).join(', ')}` : hiraFileName ? `심평원 파일: ${hiraFileName}` : ''
        ].filter(Boolean).join('\n')
      }, { timeoutMs: 120000 });
      setWorkspace(next);
      setSelectedRecommendation(null);
      const hasNextRecommendations = Array.isArray(next?.recommendations) && next.recommendations.length > 0;
      if (useStepperRecommendationFlow && (hasNextRecommendations || next?.recommendationNotice)) setTestStep(4);
      toast(
        hasNextRecommendations ? '추천 초안을 만들었어요.' : '추천 보류 조건을 확인해 주세요.',
        hasNextRecommendations ? 'success' : 'info'
      );
      Promise.resolve(reloadCurrentUser?.()).catch(() => {});
    } catch (err) {
      toast(err.message || '추천 생성에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const loadHiraMedicalFile = async (file, passwordOverride = '', options = {}) => {
    if (!file) return;
    const fileKey = options.fileKey || `${file.name}-${file.size || 0}-${file.lastModified || 0}`;
    setHiraFileName(file.name);
    const appendHiraFile = (meta = {}) => {
      setHiraFiles((prev) => [
        ...prev.filter((item) => item.id !== fileKey),
        { id: fileKey, name: file.name, type: meta.type || '심평원 자료' }
      ]);
    };
    if (/\.pdf$/i.test(file.name)) {
      if (options.manageParsing !== false) setHiraParsing(true);
      try {
        const base64 = await fileToBase64Payload(file);
        const passwordCandidates = [
          passwordOverride || hiraPassword,
          ...birthdatePasswordCandidates(form.birthdate)
        ];
        const result = await api.post('/api/product-workspace/polibot/coverage-document/analyze', {
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          base64,
          password: passwordOverride || hiraPassword,
          passwordCandidates
        }, { timeoutMs: 30000 });
        const values = result?.values || {};
        const documentTypes = Array.isArray(values.disclosureDetails?.hiraDocumentTypes) ? values.disclosureDetails.hiraDocumentTypes : [];
        const disclosureText = values.disclosureDetails && typeof values.disclosureDetails === 'object'
          ? Object.values(values.disclosureDetails).filter(Boolean).join('\n')
          : '';
        const text = values.medicalHistory || disclosureText || result?.previewText || '';
        setForm((prev) => ({
          ...prev,
          medicalHistory: [prev.medicalHistory, text.slice(0, 12000)].filter(Boolean).join('\n'),
          disclosureDetails: values.disclosureDetails && typeof values.disclosureDetails === 'object'
            ? mergePolibotDisclosureDetails(prev.disclosureDetails, values.disclosureDetails)
            : prev.disclosureDetails,
          underwritingAssessment: values.underwritingAssessment && typeof values.underwritingAssessment === 'object'
            ? { ...prev.underwritingAssessment, ...values.underwritingAssessment }
            : prev.underwritingAssessment,
          analysisResult: values.analysisResult && typeof values.analysisResult === 'object'
            ? { ...prev.analysisResult, ...values.analysisResult }
            : prev.analysisResult
        }));
        appendHiraFile({ type: documentTypes.length ? documentTypes.join(', ') : result?.document?.label });
        toast('심평원 PDF 내용을 병력/고지 항목에 넣었어요.', 'success');
      } catch (err) {
        toast(err.message || '심평원 PDF를 읽지 못했어요. 비밀번호를 확인해주세요.', 'error');
      } finally {
        if (options.manageParsing !== false) setHiraParsing(false);
      }
      return;
    }
    if (!/\.(txt|csv)$/i.test(file.name)) {
      toast('TXT/CSV/PDF 병력자료만 업로드할 수 있어요.', 'info');
      return;
    }
    try {
      const text = await file.text();
      setForm((prev) => ({
        ...prev,
        medicalHistory: [prev.medicalHistory, text.slice(0, 12000)].filter(Boolean).join('\n')
      }));
      appendHiraFile({ type: /\.csv$/i.test(file.name) ? 'CSV 자료' : '텍스트 자료' });
      toast('심평원 자료 내용을 병력/고지 메모에 넣었어요.', 'success');
    } catch (err) {
      toast(err.message || '파일을 읽지 못했어요.', 'error');
    }
  };

  const loadHiraMedicalFiles = async (files = [], passwordOverride = '') => {
    const selectedFiles = Array.from(files || []).filter(Boolean);
    if (selectedFiles.length === 0) return;
    setHiraParsing(true);
    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        await loadHiraMedicalFile(file, passwordOverride, {
          manageParsing: false,
          fileKey: `${file.name}-${file.size || 0}-${file.lastModified || 0}-${index}`
        });
      }
    } finally {
      setHiraParsing(false);
    }
  };

  const analyzeCoverageDocument = async (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) {
      toast('보장분석 PDF 파일만 업로드할 수 있어요.', 'error');
      return;
    }
    setCoverageDocumentParsing(true);
    try {
      const base64 = await fileToBase64Payload(file);
      const result = await api.post('/api/product-workspace/polibot/coverage-document/analyze', {
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        base64
      }, { timeoutMs: 30000 });
      if (result?.document && result.document.customerCoverage === false) {
        const reason = result.document.label || '문서 유형 확인 필요';
        toast(`${reason}로 보여서 고객 보장분석에 반영하지 않았어요. 고객 보장분석 PDF를 넣어주세요.`, 'error');
        return;
      }
      const nextFileName = result?.fileName || file.name;
      setCoverageDocumentFileName((prev) => mergePolibotTextLines(prev, nextFileName).split('\n').join(', '));
      setCoverageDocumentFiles((prev) => [
        ...prev.filter((item) => item.name !== nextFileName),
        { name: nextFileName, type: result?.document?.label || '고객 보장분석' }
      ]);
      const values = result?.values || {};
      setForm((prev) => ({
        ...prev,
        name: values.name || prev.name,
        age: values.age || prev.age,
        gender: values.gender || prev.gender,
        needs: mergePolibotTextLines(prev.needs, values.needs).replace(/\n/g, ', '),
        existingPolicies: mergePolibotTextLines(prev.existingPolicies, values.existingPolicies),
        existingPolicyDetails: mergePolibotPolicyDetails(prev.existingPolicyDetails, values.existingPolicyDetails),
        currentCoverage: values.currentCoverage && typeof values.currentCoverage === 'object' ? mergePolibotCoverageValues(prev.currentCoverage, values.currentCoverage) : prev.currentCoverage,
        existingMedicalPlan: values.existingMedicalPlan || prev.existingMedicalPlan,
        existingPremium: sumPolibotPremiumValues(prev.existingPremium, values.existingPremium) || values.existingPremium || prev.existingPremium,
        medicalHistory: mergePolibotTextLines(prev.medicalHistory, values.medicalHistory),
        disclosureDetails: values.disclosureDetails && typeof values.disclosureDetails === 'object' ? mergePolibotDisclosureDetails(prev.disclosureDetails, values.disclosureDetails) : prev.disclosureDetails,
        underwritingAssessment: values.underwritingAssessment && typeof values.underwritingAssessment === 'object' ? { ...prev.underwritingAssessment, ...values.underwritingAssessment } : prev.underwritingAssessment,
        analysisResult: values.analysisResult && typeof values.analysisResult === 'object' ? { ...prev.analysisResult, ...values.analysisResult } : prev.analysisResult
      }));
      setTestStep(1);
      const warningText = Array.isArray(result?.warnings) && result.warnings.length ? ` ${result.warnings.slice(0, 2).join(' ')}` : '';
      toast(`PDF에서 보장분석 값을 채웠어요.${warningText}`, result?.warnings?.length ? 'info' : 'success');
    } catch (err) {
      toast(err.message || '보장분석 PDF 분석에 실패했어요.', 'error');
    } finally {
      setCoverageDocumentParsing(false);
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

  const saveFeedback = async (recommendation, values = {}) => {
    try {
      const next = await api.post(`/api/product-workspace/polibot/recommendations/${recommendation.id}/feedback`, values);
      setWorkspace(next);
      const updated = next.recommendations?.find((item) => item.id === recommendation.id);
      setSelectedRecommendation(updated || { ...recommendation, feedback: values.feedback, feedbackReason: values.reason || values.feedbackReason || '' });
      toast(values.feedback === '좋음' ? '추천 피드백을 저장했어요.' : '피드백을 검수 큐에 남겼어요.', 'success');
    } catch (err) {
      toast(err.message || '피드백 저장에 실패했어요.', 'error');
    }
  };

  if (useStepperRecommendationFlow) {
    return (
      <div className="grid gap-4">
        {workspaceLoading && <PolibotLoadingBanner label="자료 목록은 백그라운드에서 확인 중" />}
        <PolibotRecommendStepper
          step={testStep}
          onStepChange={setTestStep}
          form={form}
          setForm={setForm}
          selectedNeeds={selectedNeeds}
          toggleNeed={toggleNeed}
          usage={usage}
          companies={companies}
          catalogCompanies={catalogCompanies}
          workspace={workspace}
          recommendations={recommendations}
          hasAnalysis={hasAnalysis}
          hasRecommendations={hasRecommendations}
          workspaceLoaded={workspaceLoaded}
          saving={saving}
          save={save}
          submitAttempted={submitAttempted}
          saveMemo={saveMemo}
          setSaveMemo={setSaveMemo}
          setSelectedRecommendation={setSelectedRecommendation}
          onOpenKnowledge={() => onOpenAction?.('polibot-upload')}
          onAnalyzeCoverageDocument={analyzeCoverageDocument}
          coverageDocumentParsing={coverageDocumentParsing}
          coverageDocumentFileName={coverageDocumentFileName}
          coverageDocumentFiles={coverageDocumentFiles}
          onLoadHiraMedicalFile={loadHiraMedicalFile}
          onLoadHiraMedicalFiles={loadHiraMedicalFiles}
          hiraFileName={hiraFileName}
          hiraFiles={hiraFiles}
          hiraPassword={hiraPassword}
          setHiraPassword={setHiraPassword}
          hiraParsing={hiraParsing}
        />
        {workspace.qualityReport && (
          <CollapsiblePanel title="자료 상태">
            <PolibotKnowledgeSummary report={workspace.qualityReport} />
          </CollapsiblePanel>
        )}
        {selectedRecommendation && (
          <PolibotRecommendationModal
            recommendation={selectedRecommendation}
            profile={workspace.customerProfile}
            testMode={useStepperRecommendationFlow}
            onClose={() => setSelectedRecommendation(null)}
            onSave={saveCustomer}
            onFeedback={saveFeedback}
          />
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {workspaceLoading && <PolibotLoadingBanner label="자료 목록은 백그라운드에서 확인 중" />}
      <PolibotProgressHeader activeStep={legacyProgressStep} usage={usage} />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] xl:items-start">
      <PanelCard title="1. 고객 조건" className="min-w-0 xl:sticky xl:top-4">
        {assistantDraft?.actionKey === 'polibot-recommend' && (
          <Notice>채팅에서 만든 초안이 들어왔어요. 핵심 조건만 확인하고 바로 추천 초안을 만들면 됩니다.</Notice>
        )}
        {saving && <PolibotLoadingBanner label="고객 조건 분석 및 확정 상품 DB 대조 중" />}
        <div className="grid gap-3">
          <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_88px_108px]">
            <label className={labelClass}>고객명<input className={inputClass} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="이효진" /></label>
            <label className={labelClass}>나이<input className={inputClass} value={form.age} onChange={(event) => setForm((prev) => ({ ...prev, age: event.target.value }))} placeholder="45" /></label>
            <label className={labelClass}>성별<input className={inputClass} value={form.gender} onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value }))} placeholder="남성" /></label>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-zinc-300">필요 보장</div>
              <div className="text-[11px] font-bold text-zinc-600">{selectedNeeds.length || 0}개 선택</div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              {polibotNeedOptions.map((need) => (
                <button
                  key={need}
                  type="button"
                  onClick={() => toggleNeed(need)}
                  className={`min-w-[78px] shrink-0 whitespace-nowrap rounded-2xl border px-3 py-2 text-center text-xs font-black leading-none transition ${selectedNeeds.includes(need) ? 'border-white bg-white text-zinc-950 shadow-sm shadow-white/10' : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200'}`}
                >
                  {need}
                </button>
              ))}
            </div>
            <textarea className={`${inputClass} min-h-[42px] text-xs text-zinc-500`} rows="1" value={form.needs} onChange={(event) => setForm((prev) => ({ ...prev, needs: event.target.value }))} placeholder="추가 보장 입력" />
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            <label className={labelClass}>월 예산<input className={inputClass} value={form.budget} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} onBlur={() => setForm((prev) => ({ ...prev, budget: normalizePolibotPremiumInput(prev.budget) }))} placeholder="30" /></label>
            <div className="grid gap-2">
              <DarkSelect
                label="보험사 범위"
                value={form.company}
                onChange={(value) => setForm((prev) => ({ ...prev, company: value }))}
                options={companies.map((company) => ({
                  value: company,
                  label: company === '전체 보험사' ? `전체 보험사 (${catalogCompanies.length}개)` : company
                }))}
                searchable
                searchPlaceholder="보험사 검색"
              />
              <PolibotCompanyHint companies={catalogCompanies} selectedCompany={form.company} loading={!workspaceLoaded} onOpenKnowledge={() => onOpenAction?.('polibot-upload')} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDetailsOpen((prev) => !prev)}
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm font-black text-zinc-300 hover:bg-white/5"
          >
            <span>
              상세 조건
              <span className="ml-2 text-xs font-bold text-zinc-600">실손, 병력, 운전 여부</span>
            </span>
            <ChevronDown size={16} className={`transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen && (
            <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <DarkSelect label="기존 실손 여부" value={form.existingMedicalPlan} onChange={(value) => setForm((prev) => ({ ...prev, existingMedicalPlan: value }))} options={[{ value: '', label: '미확인' }, { value: '있음', label: '있음' }, { value: '없음', label: '없음' }, { value: '확인 필요', label: '확인 필요' }]} />
                <label className={labelClass}>현재 보험료<input className={inputClass} value={form.existingPremium} onChange={(event) => setForm((prev) => ({ ...prev, existingPremium: event.target.value }))} placeholder="예: 18" /></label>
                <DarkSelect label="병력/고지 이슈" value={form.medicalHistory} onChange={(value) => setForm((prev) => ({ ...prev, medicalHistory: value }))} options={[{ value: '', label: '미확인' }, { value: '없음', label: '없음' }, { value: '있음', label: '있음' }, { value: '확인 필요', label: '확인 필요' }]} />
                <label className={labelClass}>가족력<input className={inputClass} value={form.familyHistory} onChange={(event) => setForm((prev) => ({ ...prev, familyHistory: event.target.value }))} placeholder="예: 암 가족력" /></label>
                <DarkSelect label="운전 여부" value={form.driving} onChange={(value) => setForm((prev) => ({ ...prev, driving: value }))} options={[{ value: '', label: '미확인' }, { value: '운전함', label: '운전함' }, { value: '운전 안함', label: '운전 안함' }]} />
                <DarkSelect label="갱신형 허용" value={form.renewalPreference} onChange={(value) => setForm((prev) => ({ ...prev, renewalPreference: value }))} options={[{ value: '', label: '미확인' }, { value: '허용', label: '허용' }, { value: '비갱신 선호', label: '비갱신 선호' }, { value: '상관 없음', label: '상관 없음' }]} />
              </div>
              <DarkSelect label="고객 목적" value={form.purpose} onChange={(value) => setForm((prev) => ({ ...prev, purpose: value }))} options={polibotPurposeOptions} />
            </div>
          )}
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0} loading={saving} loadingLabel="분석 중" className="w-full">
            {usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}
          </DarkButton>
          {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
        </div>
      </PanelCard>
      <div className="grid min-w-0 gap-4">
        <PanelCard title="2. 고객 분석" className="min-w-0">
          <PolibotConsultationDraft draft={workspace.consultationDraft} profile={workspace.customerProfile || form} saving={saving} />
          <PolibotConsultationSummaryCard summary={workspace.consultationSummary} />
          <PolibotExceptionDiseaseMatchList matches={workspace.exceptionDiseaseMatches || workspace.designManagerReview?.exceptionDiseaseMatches || []} />
        </PanelCard>
        <PanelCard title="3. 상품 추천" className="min-w-0 xl:max-h-[calc(100vh-23rem)] xl:overflow-y-auto">
          {workspaceLoading && <Notice>자료 목록은 백그라운드에서 확인 중입니다. 고객 조건 입력과 추천 실행은 바로 할 수 있어요.</Notice>}
          {saving && <PolibotLoadingState title="추천 생성 중" description="고객 조건, 보험사 범위, 확정 상품 DB를 대조하고 있어요." />}
          {!workspaceLoading && !saving && hasRecommendations ? (
            <PolibotRecommendationList
              recommendations={recommendations}
              saveMemo={saveMemo}
              onMemoChange={setSaveMemo}
              onSelect={setSelectedRecommendation}
            />
          ) : !workspaceLoading && !saving ? (
            <PolibotRecommendationEmptyState
              workspace={workspace}
              hasAnalysis={hasAnalysis}
              catalogCompanies={catalogCompanies}
              onOpenDetails={() => setDetailsOpen(true)}
              onOpenKnowledge={() => onOpenAction?.('polibot-upload')}
            />
          ) : null}
        </PanelCard>
      </div>
      </div>
      {workspace.qualityReport && (
        <CollapsiblePanel title="자료 상태">
          <PolibotKnowledgeSummary report={workspace.qualityReport} />
        </CollapsiblePanel>
      )}
      {selectedRecommendation && (
          <PolibotRecommendationModal
            recommendation={selectedRecommendation}
            profile={workspace.customerProfile}
            onClose={() => setSelectedRecommendation(null)}
            onSave={saveCustomer}
            onFeedback={saveFeedback}
          />
      )}
    </div>
  );
}

function PolibotRecommendStepper({
  step,
  onStepChange,
  form,
  setForm,
  selectedNeeds,
  toggleNeed,
  usage,
  companies,
  catalogCompanies,
  workspace,
  recommendations,
  hasAnalysis,
  hasRecommendations,
  workspaceLoaded = true,
  saving,
  save,
  submitAttempted,
  saveMemo,
  setSaveMemo,
  setSelectedRecommendation,
  onOpenKnowledge,
  onAnalyzeCoverageDocument,
  coverageDocumentParsing = false,
  coverageDocumentFileName = '',
  coverageDocumentFiles = [],
  onLoadHiraMedicalFile,
  onLoadHiraMedicalFiles,
  hiraFileName = '',
  hiraFiles = [],
  hiraPassword = '',
  setHiraPassword,
  hiraParsing = false
}) {
  const steps = [
    { id: 1, title: '자료접수', caption: '보장분석·심평원' },
    { id: 2, title: '고지정리', caption: '병력·질병코드' },
    { id: 3, title: '추천조건', caption: '목적·예산·보장' },
    { id: 4, title: '추천안', caption: '손보·생보 후보' }
  ];
  const canGenerate = workspaceLoaded && !saving && usage.remaining > 0;
  const notice = workspace.recommendationNotice || '';
  const hardMissingLabels = [
    !form.age && '나이',
    selectedNeeds.length === 0 && '필요 보장',
    !form.budget && '예산'
  ].filter(Boolean);
  const filterMissingLabels = [
    !form.medicalHistory && '심평원/병력 자료',
    !form.existingMedicalPlan && '기존 실손 여부',
    !form.renewalPreference && '갱신 선호',
    !form.purpose && '고객 목적'
  ].filter(Boolean);
  const localMissing = submitAttempted ? [...hardMissingLabels, ...filterMissingLabels] : [];
  const missingSet = new Set([...localMissing, ...hardMissingLabels.filter((label) => notice.includes(label))]);
  const isMissing = (label) => missingSet.has(label);
  const fieldClass = (label) => `${inputClass} ${isMissing(label) ? invalidFieldClass : ''}`;
  const profileReady = Boolean(form.name && (form.birthdate || form.age) && form.medicalHistory);
  const filterReady = hardMissingLabels.length === 0;
  const premiumHint = polibotBudgetHint({ budget: form.budget, existingPremium: form.existingPremium, purpose: form.purpose });
  const quickDisclosure = [
    ['recent1Year', '1년', '추가검사/재검사'],
    ['recent5Years', '5년', '입원/수술/7일치료/30일투약']
  ];
  const setDisclosurePatch = (patch) => setForm((prev) => ({
    ...prev,
    disclosureDetails: { ...(prev.disclosureDetails || {}), ...patch }
  }));
  const markDisclosureClear = (patch) => setDisclosurePatch(patch);
  const managerCodes = (workspace.managerCodes || []).length ? workspace.managerCodes : buildPolibotManagerCodeRecommendations(form);
  const actualCodes = (workspace.actualCodes || []).length ? workspace.actualCodes : buildPolibotActualCodes(form);
  const filterCodes = [...actualCodes, ...(workspace.matchedCoverageCodes || []), ...managerCodes, ...collectPolibotCodes(workspace, workspace.consultationDraft, form.disclosureDetails, form.medicalHistory)];
  const filterCodeGroups = groupPolibotCodes(filterCodes, workspace);
  const recommendationCodes = collectPolibotCodes(workspace.actualCodes, workspace.matchedCoverageCodes, workspace.managerCodes, workspace, recommendations);
  const recommendationCodeGroups = groupPolibotCodes(
    recommendationCodes.map((item) => (/^\d/.test(displayValue(item.code)) ? { ...item, tone: 'applied' } : item)),
    workspace
  );
  const stepBadge = (stepId) => {
    if (stepId === 1 && !profileReady) return '입력';
    if (stepId === 2 && filterMissingLabels.includes('심평원/병력 자료')) return '확인';
    if (stepId === 3 && hardMissingLabels.length) return `필수 ${hardMissingLabels.length}`;
    if (stepId === 4 && !hasRecommendations) return '대기';
    return '완료';
  };

  return (
    <div className="grid min-w-0 gap-3">
      {!workspaceLoaded && <PolibotLoadingBanner label="월별 상품 DB와 보험사 자료를 불러오는 중" />}
      <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5">
        <div className="grid gap-2 md:grid-cols-4">
          {steps.map((item) => {
            const active = step === item.id;
            const badge = stepBadge(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onStepChange(item.id)}
                className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-white text-zinc-950' : 'bg-white/[0.03] text-zinc-500 hover:bg-white/10 hover:text-zinc-200'}`}
              >
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${active ? 'bg-zinc-950 text-white' : 'bg-black/25 text-zinc-500'}`}>{item.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-xs font-black">{item.title}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${badge === '완료' ? 'bg-emerald-500/15 text-emerald-200' : badge === '대기' ? 'bg-white/10 text-zinc-500' : 'bg-amber-500/15 text-amber-200'}`}>{badge}</span>
                  </span>
                  <span className={`block truncate text-[11px] font-bold ${active ? 'text-zinc-600' : 'text-zinc-600'}`}>{item.caption}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-black/25 px-3 py-2">
          <div className="text-[10px] font-black text-zinc-600">남은 사용</div>
          <div className="truncate text-xs font-black text-zinc-100">{usage.unlimited ? '무제한' : `${usage.remaining}회 / ${usage.limit}`}</div>
        </div>
      </div>

      {step === 1 && (
        <PanelCard title="1. 자료 접수" className="min-w-0 p-4">
          <div className="grid gap-3">
            <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-zinc-200">보장분석 자료</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-600">여러 보장분석 PDF의 기존 계약, 담보금액, 현재 보험료를 합쳐 채웁니다.</div>
                </div>
                {coverageDocumentFileName && <span className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-zinc-400">{coverageDocumentFiles.length ? `${coverageDocumentFiles.length}개 업로드` : coverageDocumentFileName}</span>}
              </div>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">
                <Upload size={14} />
                {coverageDocumentParsing ? '보장분석 읽는 중' : '보장분석 PDF 여러 개 불러오기'}
                <input
                  type="file"
                  multiple
                  accept=".pdf,application/pdf"
                  className="hidden"
                  disabled={coverageDocumentParsing}
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.target.value = '';
                    files.forEach((file) => onAnalyzeCoverageDocument?.(file));
                  }}
                />
              </label>
              {coverageDocumentFiles.length > 0 && (
                <div className="grid gap-1">
                  {coverageDocumentFiles.map((file) => (
                    <div key={file.name} className="truncate text-xs font-black text-zinc-400">보장분석: {file.name}{file.type ? ` · ${file.type}` : ''}</div>
                  ))}
                </div>
              )}
              <div className="text-[11px] font-bold leading-5 text-zinc-600">
                보장분석 자료를 먼저 넣으면 이름, 나이, 성별, 필요 보장, 가입 계약, 현재 보험료가 자동으로 들어갑니다.
              </div>
            </div>

            <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-zinc-200">개인정보</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-600">고객 식별과 나이 계산에 필요한 최소 정보입니다.</div>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_78px]">
                <label className={labelClass}>이름<input className={inputClass} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="홍길동" /></label>
                <label className={labelClass}>전화번호<input className={inputClass} value={form.phone || ''} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} placeholder="010-0000-0000" /></label>
                <label className={labelClass}>생년월일<input type="text" inputMode="numeric" className={inputClass} value={form.birthdate || ''} onChange={(event) => { const birthdate = normalizeBirthdateInput(event.target.value, { allowSixDigit: false }); setForm((prev) => ({ ...prev, birthdate, age: calculateAgeFromBirthdate(birthdate) || prev.age })); }} onBlur={(event) => { const birthdate = normalizeBirthdateInput(event.target.value); setForm((prev) => ({ ...prev, birthdate, age: calculateAgeFromBirthdate(birthdate) || prev.age })); }} placeholder="19800101 또는 800101" /></label>
                <label className={labelClass}>나이<input type="number" min="0" className={fieldClass('나이')} value={form.age} onChange={(event) => setForm((prev) => ({ ...prev, age: event.target.value }))} placeholder="45" /></label>
                <div className="md:col-span-2 xl:col-span-1"><DarkSelect label="성별" value={form.gender} onChange={(value) => setForm((prev) => ({ ...prev, gender: value }))} options={polibotGenderOptions} /></div>
              </div>
            </div>

            <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-zinc-200">심평원 자료</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-600">기본진료정보와 약제정보를 함께 넣으면 치료횟수/투약일수 기준까지 채웁니다.</div>
                </div>
                <a href={HIRA_CERT_URL} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">
                  <ExternalLink size={14} />
                  심평원 인증
                </a>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_190px]">
                <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">
                  <Upload size={14} />
                  {hiraParsing ? '자료 읽는 중' : 'TXT/CSV/PDF 여러 개 불러오기'}
                  <input
                    type="file"
                    multiple
                    accept=".txt,.csv,.pdf,text/plain,text/csv,application/pdf"
                    className="hidden"
                    disabled={hiraParsing}
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      event.target.value = '';
                      if (onLoadHiraMedicalFiles) {
                        onLoadHiraMedicalFiles(files, hiraPassword);
                        return;
                      }
                      files.forEach((file, index) => onLoadHiraMedicalFile?.(file, hiraPassword, {
                        fileKey: `${file.name}-${file.size || 0}-${file.lastModified || 0}-${index}`
                      }));
                    }}
                  />
                </label>
                <label className="grid gap-1 text-[11px] font-black text-zinc-500">
                  PDF 비밀번호
                  <input
                    className={inputClass}
                    type="password"
                    inputMode="numeric"
                    value={hiraPassword}
                    onChange={(event) => setHiraPassword?.(event.target.value)}
                    placeholder="생년월일 자동 시도"
                  />
                </label>
              </div>
              <div className="text-[11px] font-bold leading-5 text-zinc-600">
                비밀번호가 비어 있으면 생년월일 기준 6자리/8자리를 자동으로 시도합니다.
              </div>
              {hiraFiles.length > 0 ? (
                <div className="grid gap-1">
                  {hiraFiles.map((file, index) => (
                    <div key={file.id || `${file.name}-${index}`} className="truncate text-xs font-black text-zinc-400">심평원 자료: {file.name}{file.type ? ` · ${file.type}` : ''}</div>
                  ))}
                </div>
              ) : hiraFileName ? <div className="truncate text-xs font-black text-zinc-400">심평원 자료: {hiraFileName}</div> : null}
              <textarea className={`${fieldClass('심평원/병력 자료')} min-h-[150px]`} value={form.medicalHistory} onChange={(event) => setForm((prev) => ({ ...prev, medicalHistory: event.target.value }))} placeholder="예: 고혈압 투약, 당뇨 통원, 입원/수술/검사 내역" />
            </div>

            <DarkButton onClick={() => onStepChange(2)} disabled={!form.age && !form.birthdate} className="w-full">코드 분석으로 이동</DarkButton>
          </div>
        </PanelCard>
      )}

      {step === 2 && (
        <PanelCard title="2. 병력/고지 정리" className="min-w-0 p-4">
          <div className="grid gap-3">
            {saving && <PolibotLoadingBanner label="고객 병력과 polidoc 기준을 대조하는 중" />}
            <PolibotManagerDesk
              coverageDocumentFileName={coverageDocumentFileName}
              hiraFileName={hiraFiles.length ? hiraFiles.map((item) => item.name).join(', ') : hiraFileName}
              actualCodes={actualCodes}
              matchedCoverageCodes={workspace.matchedCoverageCodes || []}
              managerCodes={managerCodes}
              designManagerReview={workspace.designManagerReview}
              profileReady={profileReady}
              hardMissingLabels={hardMissingLabels}
            />
            <PolibotConsultationSummaryCard summary={workspace.consultationSummary} />
            <PolibotExceptionDiseaseMatchList matches={workspace.exceptionDiseaseMatches || workspace.designManagerReview?.exceptionDiseaseMatches || []} />
            <div className="grid gap-2 rounded-2xl border border-emerald-300/15 bg-emerald-400/5 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-zinc-200">빠른 없음 처리</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-600">이상이 없는 항목은 한 번에 정리하고, 걸리는 병력만 카드로 추가합니다.</div>
                </div>
                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-emerald-100">1차 고지</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => markDisclosureClear({ recent1Year: '없음' })} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">1년 고지 없음</button>
                <button type="button" onClick={() => markDisclosureClear({ recent5Years: '없음', admissionSurgery: '없음', longTreatment: '없음', longMedication: '없음' })} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">5년 고지 없음</button>
                <button type="button" onClick={() => markDisclosureClear({ currentMedication: '없음', followUp: '없음', completeCure: '해당 없음' })} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 hover:border-white/25 hover:text-zinc-100">현재 치료/투약 없음</button>
              </div>
            </div>

            <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div>
                <div className="text-sm font-black text-zinc-200">1차 고지</div>
                <div className="mt-0.5 text-xs font-bold text-zinc-600">최근 기간별 문진과 병력 이벤트를 먼저 정리합니다.</div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <PolibotSelectCard label="기존 실손 여부" value={form.existingMedicalPlan} onChange={(value) => setForm((prev) => ({ ...prev, existingMedicalPlan: value }))} options={[{ value: '', label: '미확인' }, { value: '있음', label: '있음' }, { value: '없음', label: '없음' }, { value: '확인 필요', label: '확인 필요' }]} invalid={isMissing('기존 실손 여부')} />
                <PolibotSelectCard label="현재 투약" value={form.disclosureDetails?.currentMedication || ''} onChange={(value) => setDisclosurePatch({ currentMedication: value })} options={polibotDisclosureDecisionOptions} />
              </div>
              <PolibotRecent3MonthChecklist
                value={form.disclosureDetails?.recent3Months}
                onChange={(value) => setForm((prev) => ({ ...prev, disclosureDetails: { ...(prev.disclosureDetails || {}), recent3Months: value } }))}
              />
              <PolibotDiseaseCodePicker
                value={form.disclosureDetails?.diseaseEvents || []}
                onChange={(diseaseEvents) => setForm((prev) => ({ ...prev, disclosureDetails: { ...(prev.disclosureDetails || {}), diseaseEvents } }))}
                onAppendMedicalHistory={(line) => setForm((prev) => ({
                  ...prev,
                  medicalHistory: mergePolibotTextLines(prev.medicalHistory, line),
                  disclosureDetails: {
                    ...(prev.disclosureDetails || {}),
                    details: mergePolibotTextLines(prev.disclosureDetails?.details, line)
                  }
                }))}
              />
              <div className="grid gap-2">
                {quickDisclosure.map(([key, label]) => (
                  <PolibotSelectCard
                    key={key}
                    label={`${label} 고지`}
                    value={form.disclosureDetails?.[key] || ''}
                    onChange={(nextValue) => setForm((prev) => ({ ...prev, disclosureDetails: { ...(prev.disclosureDetails || {}), [key]: nextValue } }))}
                    options={polibotDisclosureDecisionOptions}
                  />
                ))}
              </div>
              <textarea className={`${inputClass} min-h-[80px]`} value={form.disclosureDetails?.details || ''} onChange={(event) => setForm((prev) => ({ ...prev, disclosureDetails: { ...(prev.disclosureDetails || {}), details: event.target.value } }))} placeholder="기타 고지 메모, 코드 후보, 부담보 예상 등을 입력" />
            </div>

            <PolibotCodeSummary
              title="설계매니저 분석 코드"
              description="두 자료에서 고지, 인수, 중복 확인 기준을 정리합니다."
              groups={filterCodeGroups}
              empty="보장분석과 심평원 자료를 넣으면 코드가 표시됩니다."
            />
            <PolibotDisclosureAssessmentList assessments={workspace.designManagerReview?.codeAssessments || []} />

            <DarkButton onClick={() => onStepChange(3)} className="w-full">추천 조건으로 이동</DarkButton>
          </div>
        </PanelCard>
      )}

      {step === 3 && (
        <PanelCard title="3. 추천 조건" className="min-w-0 p-4">
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-zinc-200">추천 기준</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-600">고객 목적, 필요 보장, 예산만 정하면 손보/생보 후보를 나눠 계산합니다.</div>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-500">POLIBOT</span>
              </div>
              <DarkSelect label="고객 목적" value={form.purpose} onChange={(value) => setForm((prev) => ({ ...prev, purpose: value }))} options={polibotPurposeOptions} invalid={isMissing('고객 목적')} />
              <div className={isMissing('필요 보장') ? 'rounded-2xl border border-red-400/35 bg-red-950/10 p-2.5' : 'grid gap-2'}>
                <div className="flex flex-wrap gap-2">
                  {polibotNeedOptions.map((need) => (
                    <button key={need} type="button" onClick={() => toggleNeed(need)} className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-center text-xs font-black leading-none transition ${selectedNeeds.includes(need) ? 'border-white bg-white text-zinc-950 shadow-sm shadow-white/10' : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200'}`}>{need}</button>
                  ))}
                </div>
                <input className={`${fieldClass('필요 보장')} text-xs text-zinc-500`} value={form.needs} onChange={(event) => setForm((prev) => ({ ...prev, needs: event.target.value }))} placeholder="암, 뇌, 심장" />
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <label className={labelClass}>목표 월 보험료<input inputMode="decimal" className={fieldClass('예산')} value={form.budget} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} onBlur={() => setForm((prev) => ({ ...prev, budget: normalizePolibotPremiumInput(prev.budget) }))} placeholder="예: 30" /></label>
                <label className={labelClass}>현재 보험료<input className={inputClass} value={form.existingPremium} onChange={(event) => setForm((prev) => ({ ...prev, existingPremium: event.target.value }))} placeholder="예: 18" /></label>
                <DarkSelect label="갱신 선호" value={form.renewalPreference} onChange={(value) => setForm((prev) => ({ ...prev, renewalPreference: value }))} options={[{ value: '', label: '미확인' }, { value: '비갱신 선호', label: '비갱신 선호' }, { value: '허용', label: '허용' }, { value: '상관 없음', label: '상관 없음' }]} />
                <DarkSelect label="보험사 범위" value={form.company} onChange={(value) => setForm((prev) => ({ ...prev, company: value }))} options={companies.map((company) => ({ value: company, label: company === '전체 보험사' ? `전체 보험사 (${catalogCompanies.length}개)` : company }))} searchable searchPlaceholder="보험사 검색" />
              </div>
              <PolibotCompanyHint companies={catalogCompanies} selectedCompany={form.company} loading={!workspaceLoaded} onOpenKnowledge={onOpenKnowledge} />
              <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold leading-relaxed text-zinc-500">{premiumHint}</div>
            </div>
            <PolibotCodeSummary
              title="추천 전 적용 코드"
              description="2단계에서 정리한 고지/질병 코드가 추천 필터에 반영됩니다."
              groups={filterCodeGroups}
              empty="병력 이벤트나 심평원 자료를 넣으면 코드가 표시됩니다."
              compact
            />
            <DarkButton onClick={save} disabled={!canGenerate} loading={saving} loadingLabel="추천 중" className="w-full">
              {usage.remaining <= 0 ? '남은 횟수 없음' : filterReady ? '손보·생보 추천 생성' : '필수값 확인 필요'}
            </DarkButton>
            {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
          </div>
        </PanelCard>
      )}

      {step === 4 && (
        <PanelCard title="4. 추천안 검토" className="min-w-0 p-4">
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-3">
              <PolibotStatusRow label="고객" value={[form.name, form.age ? `${form.age}세` : '', form.gender].filter(Boolean).join(' · ') || '미입력'} />
              <PolibotStatusRow label="고객 목적" value={form.purpose || '미입력'} />
              <PolibotStatusRow label="필요 보장" value={selectedNeeds.join(', ') || '미입력'} />
            </div>
            <div className="grid gap-2 rounded-2xl border border-amber-400/20 bg-amber-950/10 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <PolibotStatusRow label="설계매니저 검수" value={workspace.designManagerReview?.label || (hasRecommendations ? '설계매니저 검수 필요' : '추천 생성 후 검수 요청')} />
              <PolibotStatusRow label="검수 포인트" value={(workspace.designManagerReview?.reviewPoints || []).slice(0, 3).join(' · ') || (form.purpose ? `고객 목적: ${form.purpose}` : '고객 목적 선택 필요')} />
            </div>
            <PolibotCodeSummary
              title="적용 코드"
              description="추천 결과에 실제로 걸린 대표 기준 코드입니다."
              groups={recommendationCodeGroups}
              empty="추천 실행 후 적용 코드가 표시됩니다."
              compact
            />
            <PolibotDisclosureAssessmentList assessments={workspace.designManagerReview?.codeAssessments || []} compact />
            {workspace.qualityReport && <PolibotKnowledgeSummary report={workspace.qualityReport} />}
            {hasRecommendations ? (
              <PolibotRecommendationList recommendations={recommendations} saveMemo={saveMemo} onMemoChange={setSaveMemo} onSelect={setSelectedRecommendation} saving={saving} canGenerate={canGenerate} usage={usage} onGenerate={save} showGenerate testMode />
            ) : saving ? (
              <PolibotLoadingState title="추천 생성 중" description="고객 병력, polidoc 기준, 상품 DB를 대조해 후보를 고르고 있어요." />
            ) : (
              <div className="grid gap-3">
                <PolibotRecommendationEmptyState workspace={workspace} hasAnalysis={hasAnalysis} catalogCompanies={catalogCompanies} onOpenDetails={() => onStepChange(2)} onOpenKnowledge={onOpenKnowledge} showDetailAction={false} />
                <PolibotGenerateButton saving={saving} canGenerate={canGenerate} usage={usage} onGenerate={save} />
              </div>
            )}
          </div>
        </PanelCard>
      )}
    </div>
  );
}

function PolibotProgressHeader({ activeStep, usage }) {
  const steps = [
    ['고객 조건', '필수 정보 입력'],
    ['고객 분석', '부족 정보 확인'],
    ['상품 추천', '후보 검토']
  ];
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {steps.map(([title, caption], index) => {
            const step = index + 1;
            const active = activeStep === step;
            const done = activeStep > step;
            return (
              <div key={title} className={`flex min-w-[116px] items-center gap-2 rounded-xl px-2.5 py-1.5 ${active ? 'bg-white text-zinc-950' : done ? 'bg-white/10 text-zinc-100' : 'bg-black/20 text-zinc-500'}`}>
                <div className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${active ? 'bg-zinc-950 text-white' : done ? 'bg-white text-zinc-950' : 'bg-white/5 text-zinc-500'}`}>
                  {done ? '✓' : step}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black">{title}</div>
                  <div className={`truncate text-[10px] font-bold ${active ? 'text-zinc-600' : 'text-zinc-600'}`}>{caption}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="shrink-0 rounded-xl bg-black/25 px-2.5 py-1.5 text-right">
          <div className="text-[10px] font-black text-zinc-600">남은 사용</div>
          <div className="text-sm font-black text-zinc-100">
            {usage.unlimited ? '무제한' : <>{usage.remaining}회 <span className="text-zinc-600">/ {usage.limit}</span></>}
          </div>
        </div>
      </div>
    </div>
  );
}

function PolibotConsultationDraft({ draft, profile, saving = false }) {
  const profileNeeds = Array.isArray(profile?.needs) ? profile.needs : normalizeLines(profile?.needs);
  if (saving) {
    return (
      <div className="rounded-2xl bg-black/25 px-4 py-3">
        <div className="text-sm font-black text-zinc-100">고객 조건 분석 중</div>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">부족 정보와 추천 가능성을 정리하고 있어요.</p>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="grid gap-3">
        <div className="rounded-2xl bg-black/25 px-4 py-3">
          <div className="text-sm font-black text-zinc-100">아직 분석 전이에요</div>
          <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">핵심 조건을 넣고 추천 초안 만들기를 누르면 분석이 표시돼요.</p>
        </div>
        <SimpleInfoList items={[
          `현재 입력: ${[profile?.name, profile?.age ? `${profile.age}세` : '', profile?.gender].filter(Boolean).join(' · ') || '없음'}`,
          `필요 보장: ${profileNeeds.join(', ') || '미입력'}`,
          `예산/보험사: ${[profile?.budget ? `월 ${profile.budget}` : '', profile?.company].filter(Boolean).join(' · ') || '미입력'}`
        ]} />
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="rounded-2xl bg-black/25 p-4">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">정보 충분도</div>
        <div className="mt-1 text-lg font-black text-zinc-100">{draft.completeness || '보통'}</div>
        <div className="mt-2 text-sm leading-relaxed text-zinc-500">{draft.summary}</div>
      </div>
      {draft.currentCoverageAnalysis && (
        <div className="rounded-2xl bg-black/25 p-4">
          <div className="text-[11px] font-black text-zinc-600">현재 보장 상태</div>
          <div className="mt-1 text-sm font-black text-zinc-100">{draft.currentCoverageAnalysis.summary || '현재 보장 입력 확인 필요'}</div>
          <div className="mt-3 grid gap-1 text-xs leading-relaxed text-zinc-500">
            {(draft.currentCoverageAnalysis.rows || []).filter((row) => row.value || row.needed).slice(0, 8).map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                <span>{row.label}</span>
                <span className="max-w-[62%] text-right font-black text-zinc-300">{[row.value || '미입력', row.renewalType, row.maturity, row.note, row.status].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {(draft.underwritingAssessment?.route || draft.analysisResult?.gaps || draft.analysisResult?.remodelList) && (
        <div className="rounded-2xl bg-black/25 p-4">
          <div className="text-[11px] font-black text-zinc-600">인수/리모델링 판단</div>
          <div className="mt-2 grid gap-1 text-xs leading-relaxed text-zinc-500">
            {[
              draft.underwritingAssessment?.route && `심사 방향: ${draft.underwritingAssessment.route}`,
              draft.underwritingAssessment?.burden && `부담보: ${draft.underwritingAssessment.burden}`,
              draft.underwritingAssessment?.surcharge && `할증: ${draft.underwritingAssessment.surcharge}`,
              draft.analysisResult?.gaps && `부족 보장: ${draft.analysisResult.gaps}`,
              draft.analysisResult?.duplicates && `중복/과다: ${draft.analysisResult.duplicates}`,
              draft.analysisResult?.remodelList && `추천 방향: ${draft.analysisResult.remodelList}`,
              draft.analysisResult?.caution && `해지 주의: ${draft.analysisResult.caution}`
            ].filter(Boolean).slice(0, 7).map((item) => (
              <div key={item} className="rounded-xl bg-white/[0.03] px-3 py-2">{item}</div>
            ))}
          </div>
        </div>
      )}
      <SimpleInfoList items={[
        `필요 보장: ${(draft.needs || profileNeeds || []).join(', ') || '미입력'}`,
        `현재 가입 보험: ${draft.existingPolicies || profile?.existingPolicies || '미입력'}`,
        `부족 정보: ${(draft.missing || []).join(', ') || '없음'}`,
        `메모: ${draft.memo || '기본 정보 확인 완료'}`
      ]} />
      <div className="grid gap-2">
        <div className="text-xs font-black text-zinc-500">추가 확인 질문</div>
        <SimpleInfoList items={(draft.nextQuestions || []).length ? draft.nextQuestions : ['기존 보험료와 고지 이슈를 확인해 주세요.']} />
      </div>
      <div className="grid gap-2">
        <div className="text-xs font-black text-zinc-500">주의 조건</div>
        <SimpleInfoList items={(draft.cautions || []).length ? draft.cautions : ['추가 확인 필요']} />
      </div>
    </div>
  );
}

function PolibotConsultationSummaryCard({ summary }) {
  if (!summary) return null;
  const customer = summary.profile || {};
  const customerText = typeof customer === 'string'
    ? customer
    : (summary.profileLabel || [customer.name, customer.birthdate, customer.age ? `${customer.age}세` : '', customer.gender].filter(Boolean).join(' · '));
  const sections = [
    ['고객', [customerText, summary.purpose].filter(Boolean).join(' · ')],
    ['필요 보장', (summary.needs || []).join(', ')],
    ['보장분석', (summary.coverageSummary || []).join(' · ')],
    ['고지/심평원', [...(summary.medicalSummary || []), ...(summary.disclosureSummary || [])].slice(0, 4).join(' · ')],
    ['추천 방향', summary.route],
    ['추가 확인', (summary.nextQuestions || summary.missing || []).slice(0, 4).join(' · ')]
  ].filter(([, value]) => displayValue(value));
  return (
    <div className="grid gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-200">1차 정리</div>
          <div className="mt-0.5 text-xs font-bold text-zinc-600">개인정보, 보장분석, 심평원, 목적, 고지사항을 합친 추천 전 기준입니다.</div>
        </div>
        <span className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black text-cyan-100">통합</span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {sections.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-black/20 px-3 py-2">
            <div className="text-[10px] font-black text-zinc-600">{label}</div>
            <div className="mt-1 text-xs font-bold leading-relaxed text-zinc-300">{value}</div>
          </div>
        ))}
      </div>
      {(summary.exceptionSummary || []).length > 0 && (
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-bold leading-relaxed text-amber-100/80">
          예외질환 대조: {summary.exceptionSummary.slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  );
}

function PolibotExceptionDiseaseMatchList({ matches = [] }) {
  const safeMatches = Array.isArray(matches) ? matches.filter((item) => item?.diseaseName || item?.kcdCode).slice(0, 6) : [];
  if (!safeMatches.length) return null;
  const toneFor = (impact = '') => {
    if (impact === 'exception_candidate') return 'border-red-300/20 bg-red-400/10 text-red-100';
    if (impact === 'conditional_candidate') return 'border-amber-300/20 bg-amber-400/10 text-amber-100';
    return 'border-white/10 bg-black/20 text-zinc-300';
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-amber-300/15 bg-amber-400/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-200">예외질환 매칭</div>
          <div className="mt-0.5 text-xs font-bold text-zinc-600">심평원 상병코드와 병력 문구를 서버 예외질환 자료와 대조한 결과입니다.</div>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-500">{safeMatches.length}개</span>
      </div>
      <div className="grid gap-2">
        {safeMatches.map((item, index) => (
          <div key={`${item.company}-${item.kcdCode}-${item.diseaseName}-${index}`} className={`rounded-xl border px-3 py-2 ${toneFor(item.impact)}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-black">{item.kcdCode || '코드 없음'}</span>
              <span className="text-xs font-black">{item.diseaseName}</span>
              <span className="text-[10px] font-black opacity-70">{item.company}</span>
            </div>
            <div className="mt-1 text-[11px] font-bold leading-relaxed opacity-80">
              {[item.matchType, item.conditionText, (item.conditionFlags || []).join('/')].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PolibotCompanyHint({ companies = [], selectedCompany = '전체 보험사', loading = false, onOpenKnowledge }) {
  const safeCompanies = Array.isArray(companies) ? companies.map(displayValue).filter(Boolean) : [];
  const selectedCompanyText = displayValue(selectedCompany) || '전체 보험사';
  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-zinc-500">
        보험사 자료와 월별 상품 카탈로그를 불러오고 있어요.
      </div>
    );
  }
  if (!safeCompanies.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-zinc-500">
        추천에 쓸 보험사 목록을 아직 확인하지 못했어요.{' '}
        <button type="button" onClick={onOpenKnowledge} className="font-black text-zinc-200 underline decoration-white/20 underline-offset-4 hover:text-white">
          자료 확인
        </button>
        에서 연결 상태를 확인해 주세요.
      </div>
    );
  }
  const preview = safeCompanies.slice(0, 5);
  return (
    <div className="grid gap-2 rounded-2xl bg-black/20 px-3 py-2">
      <div className="text-[11px] font-bold leading-relaxed text-zinc-500">
        {selectedCompanyText === '전체 보험사'
          ? `자료에서 확인된 보험사 ${safeCompanies.length}개 전체를 대상으로 봅니다.`
          : `${selectedCompanyText} 자료 안에서만 추천 후보를 찾습니다.`}
      </div>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto">
        {preview.map((company) => (
          <span key={company} className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black ${selectedCompanyText === company ? 'border-white bg-white text-zinc-950' : 'border-white/10 text-zinc-500'}`}>
            {company}
          </span>
        ))}
        {safeCompanies.length > preview.length && (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-600">+{safeCompanies.length - preview.length}</span>
        )}
      </div>
    </div>
  );
}

function normalizePolibotRecent3MonthValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...createPolibotRecent3MonthState(), ...value };
  }
  const note = displayValue(value);
  return { ...createPolibotRecent3MonthState(), note };
}

function PolibotRecent3MonthChecklist({ value, onChange }) {
  const current = normalizePolibotRecent3MonthValue(value);
  const setField = (key, nextValue) => onChange?.({ ...current, [key]: nextValue, confirmedBy: 'seller' });
  const setAll = (nextValue) => {
    onChange?.({
      ...current,
      ...Object.fromEntries(polibotRecent3MonthFields.map((field) => [field.key, nextValue])),
      confirmedBy: 'seller'
    });
  };
  const answeredCount = polibotRecent3MonthFields.filter((field) => current[field.key]).length;
  const hasPositive = polibotRecent3MonthFields.some((field) => current[field.key] === 'yes');
  const complete = answeredCount === polibotRecent3MonthFields.length;
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-black text-zinc-200">최근 3개월 문진</div>
          <div className="mt-0.5 text-[11px] font-bold text-zinc-600">심평원 자료에 없는 최근 3개월 고지 항목입니다.</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => setAll('none')} className="h-8 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-2.5 text-[10px] font-black text-emerald-100 hover:border-emerald-200/40">전체 없음</button>
          <button type="button" onClick={() => setAll('')} className="h-8 rounded-xl border border-white/10 bg-black/25 px-2.5 text-[10px] font-black text-zinc-500 hover:border-white/25">초기화</button>
        </div>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        {polibotRecent3MonthFields.map((field) => {
          const selected = current[field.key] || '';
          return (
            <div key={field.key} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded-xl bg-white/[0.03] px-2.5 py-2">
              <span className="truncate text-[11px] font-black text-zinc-300">{field.label}</span>
              <button type="button" onClick={() => setField(field.key, 'none')} className={`h-7 rounded-lg px-2 text-[10px] font-black ${selected === 'none' ? 'bg-emerald-300 text-zinc-950' : 'bg-black/30 text-zinc-500 hover:text-zinc-200'}`}>없음</button>
              <button type="button" onClick={() => setField(field.key, 'yes')} className={`h-7 rounded-lg px-2 text-[10px] font-black ${selected === 'yes' ? 'bg-amber-300 text-zinc-950' : 'bg-black/30 text-zinc-500 hover:text-zinc-200'}`}>있음</button>
            </div>
          );
        })}
      </div>
      <div className={`rounded-xl px-3 py-2 text-[11px] font-bold leading-relaxed ${complete && !hasPositive ? 'bg-emerald-400/10 text-emerald-100/80' : hasPositive ? 'bg-amber-400/10 text-amber-100/80' : 'bg-black/20 text-zinc-600'}`}>
        {complete
          ? hasPositive ? '최근 3개월 해당 항목이 있어 설계매니저 심사 확인이 필요합니다.' : '최근 3개월 문진이 모두 없음으로 확인되어 코드 추천 확정에 반영됩니다.'
          : `최근 3개월 문진 ${answeredCount}/${polibotRecent3MonthFields.length}개 입력됨`}
      </div>
      <input
        className={`${inputClass} py-2 text-xs`}
        value={current.note || ''}
        onChange={(event) => onChange?.({ ...current, note: event.target.value })}
        placeholder="최근 3개월 문진 메모"
      />
    </div>
  );
}

function PolibotSelectCard({ label, value, onChange, options, invalid = false }) {
  const selectRef = useRef(null);
  const safeOptions = (Array.isArray(options) ? options : []).map((option) => {
    if (option && typeof option === 'object') {
      return {
        value: displayValue(option.value ?? option.id ?? option.label ?? option.name),
        label: displayValue(option.label ?? option.name ?? option.value ?? option.id)
      };
    }
    const text = displayValue(option);
    return { value: text, label: text };
  });
  return (
    <label
      className={`grid min-w-0 cursor-pointer gap-1 rounded-xl border bg-white/[0.03] p-2.5 text-[11px] font-black text-zinc-500 transition hover:border-white/20 hover:bg-white/[0.06] ${invalid ? 'border-red-400/45' : 'border-white/10'}`}
      onClick={(event) => {
        if (event.target === selectRef.current) return;
        selectRef.current?.focus();
        selectRef.current?.showPicker?.();
      }}
    >
      {label}
      <select
        ref={selectRef}
        className={`${inputClass} h-10 min-w-0 cursor-pointer py-2 text-xs ${invalid ? invalidFieldClass : ''}`}
        value={displayValue(value)}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {safeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function PolibotDateCard({ label, value, onChange }) {
  const current = value ? new Date(`${value}T00:00:00`) : new Date();
  const safeCurrent = Number.isNaN(current.getTime()) ? new Date() : current;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(safeCurrent.getFullYear());
  const [viewMonth, setViewMonth] = useState(safeCurrent.getMonth());
  const years = Array.from({ length: 42 }, (_, index) => new Date().getFullYear() + 1 - index);
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1)
  ];
  const formatDate = (day) => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const shiftMonth = (delta) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };
  return (
    <div className="relative min-w-0">
      <button
      type="button"
      className="grid w-full min-w-0 cursor-pointer gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-left text-[11px] font-black text-zinc-500 transition hover:border-white/20 hover:bg-white/[0.06]"
      onClick={(event) => {
        event.preventDefault();
        setOpen((prev) => !prev);
      }}
    >
      {label}
        <span className="flex h-10 min-w-0 items-center justify-between rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-bold text-zinc-100">
          <span className={value ? 'text-zinc-100' : 'text-zinc-600'}>{value || '연도. 월. 일.'}</span>
          <span className="text-zinc-500">⌄</span>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-2xl shadow-black/50">
          <div className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-2">
            <button type="button" onClick={() => shiftMonth(-1)} className="h-9 rounded-xl border border-white/10 text-zinc-400 hover:bg-white/10">‹</button>
            <div className="grid grid-cols-2 gap-2">
              <select className={`${inputClass} h-9 py-1 text-xs`} value={viewYear} onChange={(event) => setViewYear(Number(event.target.value))}>
                {years.map((year) => <option key={year} value={year}>{year}년</option>)}
              </select>
              <select className={`${inputClass} h-9 py-1 text-xs`} value={viewMonth} onChange={(event) => setViewMonth(Number(event.target.value))}>
                {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{index + 1}월</option>)}
              </select>
            </div>
            <button type="button" onClick={() => shiftMonth(1)} className="h-9 rounded-xl border border-white/10 text-zinc-400 hover:bg-white/10">›</button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black text-zinc-600">
            {['일', '월', '화', '수', '목', '금', '토'].map((day) => <div key={day}>{day}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((day, index) => {
              const nextValue = day ? formatDate(day) : '';
              const active = nextValue && nextValue === value;
              return day ? (
                <button
                  key={nextValue}
                  type="button"
                  onClick={() => {
                    onChange?.(nextValue);
                    setOpen(false);
                  }}
                  className={`h-8 rounded-lg text-xs font-black ${active ? 'bg-white text-zinc-950' : 'bg-black/30 text-zinc-300 hover:bg-white/10'}`}
                >
                  {day}
                </button>
              ) : <div key={`blank-${index}`} />;
            })}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { onChange?.(''); setOpen(false); }} className="h-9 rounded-xl border border-white/10 text-xs font-black text-zinc-500 hover:bg-white/10">초기화</button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-xl bg-white text-xs font-black text-zinc-950">닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PolibotDiseaseCodePicker({ value = [], onChange, onAppendMedicalHistory }) {
  const toast = useToast();
  const [occurredAt, setOccurredAt] = useState('');
  const [eventType, setEventType] = useState('');
  const [carrierType, setCarrierType] = useState('');
  const [query, setQuery] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const selected = Array.isArray(value) ? value : [];
  const search = async () => {
    const keyword = query.trim();
    if (!keyword) {
      toast('질병코드나 병명을 입력해 주세요.', 'error');
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: keyword,
        eventType,
        carrierType,
        limit: '24'
      });
      const data = await api.get(`/api/product-workspace/polibot/disease-search?${params.toString()}`, { timeoutMs: 8000 });
      setResults(Array.isArray(data?.results) ? data.results : []);
      if (!data?.results?.length) toast(data?.notice || '검색 결과가 없어요.', 'info');
    } catch (err) {
      toast(err.message || '질병코드 검색에 실패했어요.', 'error');
    } finally {
      setSearching(false);
    }
  };
  const addDisease = (item) => {
    const next = {
      occurredAt,
      eventType: eventType || item.eventType || '',
      kcdCode: item.kcdCode || '',
      diseaseName: item.diseaseName || '',
      company: item.company || '',
      carrierType: item.carrierType || '',
      conditionText: item.conditionText || '',
      status,
      memo: [item.carrierTypeLabel, status, item.eligibilityLevel, item.conditionText].filter(Boolean).join(' · ')
    };
    const key = [next.occurredAt, next.eventType, next.kcdCode, next.diseaseName, next.company].join('|');
    const merged = [
      ...selected.filter((row) => [row.occurredAt, row.eventType, row.kcdCode, row.diseaseName, row.company].join('|') !== key),
      next
    ].slice(-20);
    onChange?.(merged);
    onAppendMedicalHistory?.([
      occurredAt && `발생일: ${occurredAt}`,
      next.eventType && `구분: ${next.eventType}`,
      next.kcdCode && `질병코드: ${next.kcdCode}`,
      next.diseaseName && `병명: ${next.diseaseName}`,
      next.company && `기준보험사: ${next.company}`,
      next.conditionText && `인수기준: ${next.conditionText}`
    ].filter(Boolean).join(' · '));
    toast('질병코드를 고지 기준에 추가했어요.', 'success');
  };
  const addManualDisease = () => {
    const diseaseName = manualName.trim() || query.trim();
    const kcdCode = manualCode.trim().toUpperCase();
    if (!diseaseName && !kcdCode) {
      toast('병명이나 질병코드를 입력해 주세요.', 'error');
      return;
    }
    addDisease({
      kcdCode,
      diseaseName,
      eventType,
      carrierType,
      carrierTypeLabel: carrierType === 'life' ? '생보' : carrierType === 'nonlife' ? '손보' : '',
      conditionText: '직접 입력'
    });
    setManualName('');
    setManualCode('');
  };
  const removeDisease = (index) => {
    onChange?.(selected.filter((_, rowIndex) => rowIndex !== index));
  };
  const updateDisease = (index, patch) => {
    onChange?.(selected.map((item, rowIndex) => rowIndex === index ? { ...item, ...patch } : item));
  };
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-200">질병분류기호 검색</div>
          <div className="mt-0.5 text-xs font-bold text-zinc-600">발생일과 통원/입원/수술/투약 구분을 선택한 뒤 질병코드 또는 병명으로 검색합니다.</div>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-500">{selected.length}개 선택</span>
      </div>
      <div className="grid gap-2">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(210px,1.2fr)_minmax(140px,.8fr)_minmax(150px,.85fr)_minmax(150px,.85fr)]">
          <PolibotDateCard label="연월일(발생일)" value={occurredAt} onChange={setOccurredAt} />
          <PolibotSelectCard label="구분" value={eventType} onChange={setEventType} options={polibotDiseaseEventOptions} />
          <PolibotSelectCard label="자료" value={carrierType} onChange={setCarrierType} options={polibotCarrierTypeOptions} />
          <PolibotSelectCard label="현재 상태" value={status} onChange={setStatus} options={polibotDiseaseStatusOptions} />
        </div>
        <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_96px]">
          <label className="grid min-w-0 gap-1 text-[11px] font-black text-zinc-500">
            질병코드/병명
            <input
              className={inputClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  search();
                }
              }}
              placeholder="예: I10, 고혈압, 백내장"
            />
          </label>
          <div className="flex items-end">
            <DarkButton size="sm" onClick={search} disabled={searching} loading={searching} loadingLabel="검색 중" className="h-11 w-full">검색</DarkButton>
          </div>
        </div>
      </div>
      <div className="grid gap-2 rounded-xl bg-white/[0.03] p-2 md:grid-cols-[120px_minmax(0,1fr)_90px]">
        <label className="grid gap-1 text-[11px] font-black text-zinc-500">
          질병코드
          <input className={inputClass} value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="예: I10" />
        </label>
        <label className="grid gap-1 text-[11px] font-black text-zinc-500">
          병명 직접입력
          <input className={inputClass} value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder="검색 결과가 없을 때 직접 입력" />
        </label>
        <div className="flex items-end">
          <DarkButton size="sm" variant="ghost" onClick={addManualDisease} className="h-11 w-full">직접 추가</DarkButton>
        </div>
      </div>
      {results.length > 0 && (
        <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
          {results.map((item) => (
            <button key={`${item.id}-${item.company}`} type="button" onClick={() => addDisease(item)} className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-left hover:border-white/25 hover:bg-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white text-zinc-950 px-2 py-0.5 text-[10px] font-black">{item.kcdCode || '코드 없음'}</span>
                <span className="text-xs font-black text-zinc-100">{item.diseaseName}</span>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-zinc-500">{item.carrierTypeLabel}</span>
                <span className="text-[10px] font-black text-zinc-600">{item.company}</span>
              </div>
              <div className="mt-1 text-[11px] font-bold leading-relaxed text-zinc-500">{[item.diseaseCategory, item.conditionText].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <div className="grid gap-1.5">
          {selected.map((item, index) => (
            <div key={`${item.kcdCode}-${item.diseaseName}-${item.company}-${index}`} className="grid gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 py-2">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_130px_auto] md:items-start">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-emerald-50">{[item.occurredAt, item.eventType, item.kcdCode, item.diseaseName].filter(Boolean).join(' · ')}</div>
                  <div className="mt-1 truncate text-[11px] font-bold text-emerald-100/70">{[item.company, item.conditionText].filter(Boolean).join(' · ')}</div>
                </div>
                <PolibotSelectCard label="상태" value={item.status || ''} onChange={(nextStatus) => updateDisease(index, { status: nextStatus })} options={polibotDiseaseStatusOptions} />
                <button type="button" onClick={() => removeDisease(index)} className="h-8 rounded-lg border border-white/10 px-2 text-[10px] font-black text-zinc-300 hover:bg-white/10">삭제</button>
              </div>
              <input
                className={`${inputClass} py-2 text-xs`}
                value={item.memo || ''}
                onChange={(event) => updateDisease(index, { memo: event.target.value })}
                placeholder="확인 메모"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PolibotManagerDesk({ coverageDocumentFileName = '', hiraFileName = '', actualCodes = [], matchedCoverageCodes = [], managerCodes = [], designManagerReview = null, profileReady = false, hardMissingLabels = [] }) {
  const reviewCodes = managerCodes.filter((item) => item.status !== 'applied');
  const appliedCodes = managerCodes.filter((item) => item.status === 'applied');
  const codeAssessments = Array.isArray(designManagerReview?.codeAssessments) ? designManagerReview.codeAssessments : [];
  const companyConcentration = designManagerReview?.companyConcentration;
  const intakeRows = [
    {
      label: '보장분석',
      value: coverageDocumentFileName || '대기',
      ready: Boolean(coverageDocumentFileName),
      helper: '기본정보·기존계약·담보금액'
    },
    {
      label: '심평원',
      value: hiraFileName || '대기',
      ready: Boolean(hiraFileName),
      helper: '진료·투약·검사·고지 단서'
    }
  ];
  const primaryCodes = actualCodes.length ? actualCodes : matchedCoverageCodes.length ? matchedCoverageCodes : (reviewCodes.length ? reviewCodes : appliedCodes);
  return (
    <div className="grid gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-100">설계매니저 검수대</div>
          <div className="mt-0.5 text-xs font-bold leading-relaxed text-zinc-500">접수 자료를 코드화해서 상품 추천 전에 확인할 조건을 먼저 잡습니다.</div>
        </div>
        <div className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-2.5 py-1 text-[10px] font-black text-cyan-100">
          {actualCodes.length ? `실제 코드 ${actualCodes.length}개` : matchedCoverageCodes.length ? `추천 보장코드 ${matchedCoverageCodes.length}개` : managerCodes.length ? `검수 태그 ${managerCodes.length}개` : profileReady ? '분석 준비' : '자료 대기'}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {intakeRows.map((item) => (
          <div key={item.label} className={`rounded-xl border px-3 py-2 ${item.ready ? 'border-emerald-300/20 bg-emerald-400/10' : 'border-white/10 bg-black/20'}`}>
            <div className={`text-[10px] font-black ${item.ready ? 'text-emerald-100/70' : 'text-zinc-600'}`}>{item.label}</div>
            <div className={`mt-1 truncate text-xs font-black ${item.ready ? 'text-emerald-50' : 'text-zinc-500'}`}>{item.value}</div>
            <div className="mt-1 text-[11px] font-bold text-zinc-600">{item.helper}</div>
          </div>
        ))}
      </div>
      {hardMissingLabels.length > 0 && (
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs font-black text-amber-100">
          상품추천 필수값: {hardMissingLabels.join(', ')}
        </div>
      )}
      {companyConcentration?.detected && (
        <div className="rounded-xl border border-amber-300/20 bg-amber-400/10 px-3 py-2">
          <div className="text-xs font-black text-amber-100">보험사 편중 확인: {companyConcentration.company} {companyConcentration.count}/{companyConcentration.total}개</div>
          <div className="mt-1 text-[11px] font-bold leading-relaxed text-amber-100/70">{companyConcentration.reason}</div>
        </div>
      )}
      {primaryCodes.length ? (
        <div className="grid gap-2">
          {primaryCodes.slice(0, 5).map((item) => (
            <div key={item.code} className={`rounded-xl border px-3 py-2 ${item.status === 'applied' ? 'border-cyan-300/20 bg-cyan-300/10' : item.severity === 'high' ? 'border-amber-300/25 bg-amber-400/10' : 'border-white/10 bg-black/20'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-black text-zinc-200">{item.code}</span>
                <span className="text-xs font-black text-zinc-100">{item.label}</span>
                <span className="text-[10px] font-black text-zinc-600">{item.source}</span>
              </div>
              <div className="mt-1 text-[11px] font-bold leading-relaxed text-zinc-500">{item.reason}</div>
            </div>
          ))}
          {matchedCoverageCodes.length > 0 && (
            <div className="text-[11px] font-bold text-zinc-600">polidoc 기준 추천 보장코드 {matchedCoverageCodes.length}개가 추천안에 연결됩니다.</div>
          )}
          {codeAssessments.length > 0 && (
            <div className="text-[11px] font-bold text-zinc-600">고객조건 룰 기준 코드평가 {codeAssessments.length}개가 설계매니저 검수에 연결됩니다.</div>
          )}
          {actualCodes.length > 0 && managerCodes.length > 0 && (
            <div className="text-[11px] font-bold text-zinc-600">내부 검수 태그 {managerCodes.length}개는 추천 주의조건에 함께 반영됩니다.</div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-black/20 px-3 py-2 text-xs font-bold text-zinc-600">
          자료 안에 상병코드, 담보번호, 간편고지 숫자가 있으면 여기에 실제 코드로 표시됩니다.
        </div>
      )}
    </div>
  );
}

function collectPolibotCodes(...sources) {
  const dottedCodePattern = /\b\d(?:\.\d+){1,3}\b/g;
  const kcdCodePattern = /\b([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?|[A-Z][0-9]{3})\b/gi;
  const labeledCodePattern = /(?:코드|분류|상병|질병|담보|고지|KCD|ICD)[^\d]{0,12}(\d{3,5})\b/gi;
  const found = [];
  const looksLikeCode = (code = '', label = '', source = '') => {
    const value = displayValue(code).trim();
    const context = `${displayValue(label)} ${displayValue(source)}`;
    if (!value) return false;
    if (/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(value)) return true;
    if (/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?$|^[A-Z][0-9]{3}$/i.test(value)) return true;
    if (/^\d(?:\.\d+){1,3}$/.test(value)) return true;
    if (/^\d{1,5}$/.test(value)) {
      return /코드|분류|상병|질병|담보|보장|특약|진단비|수술비|입원비|암|뇌|심장|상해|간병|운전자|고지|KCD|ICD|polidoc/i.test(context);
    }
    return false;
  };
  const pushCode = (code, label = '', source = '', tone = '') => {
    const value = displayValue(code).trim();
    if (!looksLikeCode(value, label, source)) return;
    const key = value;
    if (found.some((item) => item.code === key)) return;
    found.push({ code: value, label: displayValue(label), source: displayValue(source), tone });
  };
  const inferTone = (value = '') => {
    const text = displayValue(value);
    if (/제외|불가|거절|보류|어려움|탈락|block|exclude/i.test(text)) return 'excluded';
    if (/확인|검토|주의|보류|필요|review|caution/i.test(text)) return 'review';
    return 'applied';
  };
  const visit = (value, source = '', inheritedTone = '') => {
    if (!value) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value);
      const tone = inheritedTone || 'applied';
      text.match(dottedCodePattern)?.forEach((code) => pushCode(code, '', source, tone));
      [...text.matchAll(kcdCodePattern)].forEach((match) => pushCode(match[1], '상병/KCD 코드', source, tone));
      [...text.matchAll(labeledCodePattern)].forEach((match) => pushCode(match[1], text.slice(Math.max(0, match.index - 20), (match.index || 0) + 60), source, tone));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, source, inheritedTone));
      return;
    }
    if (typeof value === 'object') {
      const tone = value.status || value.tone || value.result || inheritedTone || inferTone(value.reason || value.label || value.title || value.name || value.diseaseName || value.memo || '');
      pushCode(
        value.code || value.kcdCode || value.disclosureCode || value.underwritingCode || value.productCode,
        value.label || value.title || value.name || value.diseaseName || value.reason || '코드',
        value.source || value.fileName || value.company || source,
        tone
      );
      ['codes', 'codeCandidates', 'actualCodes', 'managerCodes', 'codeAssessments', 'decisionAnalysis', 'disclosureCodes', 'underwritingCodes', 'matchedCodes', 'matchedCoverageCodes', 'recommendationCodes', 'recommendedCodes', 'diseaseEvents', 'hiraDiseaseCodes', 'designManagerReview', 'designManagerSummary', 'evidence', 'evidenceMatches', 'evidenceAnchors', 'catalogItems', 'linkedBenefitGroups', 'routineChecks', 'reviewReasons', 'cautions', 'disclosureMemo', 'underwritingMemo'].forEach((key) => visit(value[key], value.fileName || value.source || source, tone));
    }
  };
  sources.forEach((source) => visit(source));
  return found.slice(0, 18);
}

function codeContext(text = '', index = 0, length = 0) {
  const value = String(text || '');
  return value.slice(Math.max(0, index - 48), Math.min(value.length, index + length + 72)).replace(/\s+/g, ' ').trim();
}

function polibotCodeBoundary(text = '', index = 0, length = 0) {
  const value = String(text || '');
  return {
    before: value[index - 1] || '',
    after: value[index + length] || ''
  };
}

function hasPolibotMedicalContext(context = '') {
  return /진단|진료|질환|질병|상병|염좌|골절|고혈압|당뇨|폴립|선종|수술|입원|통원|약처방|투약|치료|검사|백내장|망막|전립선|황반|늑골|관절|무릎|발목|요추|대장|용종|고지/.test(context);
}

function hasPolibotDocumentNoiseContext(context = '') {
  return /보험|상품|GA|월호|페이지|고객제시불가|파일:|보험료|가입설계/.test(context);
}

function isPolibotLikelyDateOrAmount(value = '', context = '') {
  const code = String(value || '').trim();
  if (/^(19|20)\d{2}$/.test(code)) return true;
  if (/^\d{6,8}$/.test(code)) return true;
  if (/\d{4}[-./]\d{1,2}|\d{1,3}(?:,\d{3})원|만원|세|회|일/.test(context) && !/코드|번호|담보|특약|상병|질병/.test(context)) return true;
  return false;
}

function normalizePolibotDisclosureCode(raw = '') {
  const value = String(raw || '').trim();
  const dottedParts = value.match(/^([35])\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (dottedParts) return [dottedParts[1], Number(dottedParts[2]), Number(dottedParts[3]), dottedParts[4] ? Number(dottedParts[4]) : ''].filter((part) => part !== '').join('.');
  const compact = value.match(/^3(\d{1,2})(\d{2})$/);
  if (compact) return `3.${Number(compact[1])}.${Number(compact[2])}`;
  const shorthand = {
    305: '3.0.5',
    315: '3.1.5',
    310: '3.1.0',
    325: '3.2.5',
    333: '3.3.3',
    335: '3.3.5',
    345: '3.4.5',
    355: '3.5.5',
    3105: '3.10.5',
    31010: '3.10.10',
    5105: '5.10.5',
    51010: '5.10.10'
  };
  if (shorthand[value]) return shorthand[value];
  return '';
}

function isPolibotStandaloneCode(text = '', index = 0, length = 0) {
  const { before, after } = polibotCodeBoundary(text, index, length);
  return !/[A-Za-z0-9가-힣]/.test(before) && !/[A-Za-z0-9가-힣]/.test(after);
}

function addPolibotActualCode(items, item = {}) {
  const code = String(item.code || '').trim().toUpperCase();
  if (!code || items.some((row) => row.code === code && row.kind === item.kind)) return;
  items.push({
    code,
    kind: item.kind || 'code',
    label: item.label || code,
    status: item.status || 'review',
    source: item.source || '고객 자료',
    reason: item.reason || '자료에서 실제 코드 후보로 확인됐습니다.',
    context: item.context || '',
    confidence: item.confidence || 70
  });
}

function buildPolibotRecommendedDisclosureCodes(form = {}) {
  const disclosure = form.disclosureDetails && typeof form.disclosureDetails === 'object' ? form.disclosureDetails : {};
  const rawMedical = [
    form.medicalHistory,
    Object.values(disclosure).filter(Boolean).join(' '),
    form.underwritingAssessment?.route,
    form.underwritingAssessment?.note,
    form.underwritingAssessment?.simpleReview
  ].filter(Boolean).join(' ');
  const looksLikeCoverageTable = /암\s*진단|뇌\/심장|뇌혈관질환|허혈성심장질환|운전자|실손|일반암|유사암|고액암|수술비|입원비|담보|가입금액|보험료/i.test(rawMedical);
  const hasMedicalEvidence = /심평원|의료기관|병원|약국|진료|외래|처방|투약|복용|고혈압|혈압|당뇨|고지혈|검사|재검|추적|관찰|소견|입원|수술|시술|질병코드|상병|KCD/i.test(rawMedical);
  const noMedical = /없음|무|해당\s*없|이상\s*없|문제\s*없/i.test(rawMedical);
  if ((!rawMedical || (looksLikeCoverageTable && !hasMedicalEvidence)) && !noMedical) return [];
  const text = rawMedical.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
  const items = [];
  const add = (item = {}) => {
    if (!item.code || items.some((row) => row.code === item.code)) return;
    items.push({
      kind: 'disclosure_recommendation',
      label: '추천 간편고지 유형',
      status: 'recommended',
      source: '설계매니저 산출',
      confidence: 78,
      context: rawMedical.slice(0, 240),
      ...item
    });
  };
  const hasHira = /심평원|의료기관|병원|약국|진료|외래|처방/.test(text);
  const hasChronicMedication = /고혈압|혈압|당뇨|고지혈|콜레스테롤|지질|투약|복용|처방|약국/.test(text);
  const hasFollowup = /검사|재검|추적|관찰|소견|결절|용종/.test(text);
  const hasAdmissionSurgery = /입원|수술|시술/.test(text);
  const hasMajor = /암|심근경색|협심증|뇌졸중|뇌출혈|뇌경색|심장판막|간경화|백혈병|후유증|전이|재발/.test(text);
  const hasHypertensionDiabetes = /고혈압|혈압|당뇨/.test(text);
  const hasLongWindow = /10년|십년|장기|30일|7일|입원일수|수술일|치료\s*종료|완치/.test(text);
  const hasLightIssue = /경증|초경증|용종|결절|검진|외래|통원|약국|처방/.test(text) && !hasMajor && !hasAdmissionSurgery;
  if (hasMajor || (hasAdmissionSurgery && hasLongWindow)) {
    add({ code: '3.10.10', reason: '중대질환 또는 입원/수술 이력 가능성이 있어 10년형 간편고지까지 산출 후보로 둡니다.', confidence: hasMajor ? 88 : 82 });
  }
  if (hasLightIssue || (hasChronicMedication && !hasAdmissionSurgery && !hasMajor)) {
    add({ code: '3.10.5', reason: hasLightIssue ? '경증/초경증 또는 외래·처방 중심 단서가 있어 서버 코드표의 3.10.5 간편고지 후보를 함께 봅니다.' : '만성질환 투약 단서가 있으나 중대/입원 이력이 약해 3.10.5 경증 유병자 후보를 비교합니다.', confidence: hasLightIssue ? 84 : 80 });
  }
  if (hasAdmissionSurgery || hasChronicMedication) {
    add({ code: '3.5.5', reason: hasAdmissionSurgery ? '입원/수술/시술 단서가 있어 최근 5년 고지형 산출을 우선 후보로 둡니다.' : '만성질환 투약 또는 처방 단서가 있어 5년형 간편고지 산출을 우선 후보로 둡니다.', confidence: hasChronicMedication ? 86 : 82 });
  }
  if (hasFollowup || (hasHira && !hasAdmissionSurgery && !hasMajor)) {
    add({ code: '3.3.5', reason: hasFollowup ? '검사/재검/추적관찰 단서가 있어 3개월·3년·5년 질문형을 비교 후보로 둡니다.' : '심평원/진료 이력은 있으나 중대 병력 단서가 약해 3.3.5 비교 후보로 둡니다.', confidence: hasFollowup ? 80 : 74 });
  }
  if (hasFollowup && !hasAdmissionSurgery && !hasMajor) {
    add({ code: '3.2.5', reason: '검사/추적관찰 중심의 비교적 가벼운 고지 단서라 3.2.5 초경증 후보도 비교합니다.', confidence: 72 });
  }
  if (noMedical) {
    add({ code: '5.10.5', reason: '입력상 병력 이슈가 낮아 건강고지/우량체 계열 후보를 우선 비교합니다.', confidence: 78 });
    add({ code: '5.5.5', reason: '표준·건강고지 가능 고객이면 5.5.5 계열도 보험료 비교 후보로 둡니다.', confidence: 72 });
  }
  if (hasHypertensionDiabetes && /당뇨고지|당뇨\s*고지|합병증|인슐린/.test(text)) {
    add({ code: '3.10.5.5', reason: '당뇨 고지 또는 합병증 확인 단서가 있어 3.10.5.5 당뇨고지형을 별도 후보로 둡니다.', confidence: 82 });
  }
  return items;
}

function buildPolibotActualCodes(form = {}) {
  const disclosure = form.disclosureDetails && typeof form.disclosureDetails === 'object' ? form.disclosureDetails : {};
  const text = [
    form.medicalHistory,
    Object.values(disclosure).filter(Boolean).join('\n'),
    form.existingPolicies,
    form.underwritingAssessment?.route
  ].filter(Boolean).join('\n');
  const items = [];
  for (const match of text.matchAll(/\b([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?|[A-Z][0-9]{3})\b/gi)) {
    const raw = match[1] || '';
    const context = codeContext(text, match.index || 0, raw.length);
    const medicalContext = hasPolibotMedicalContext(context);
    if (hasPolibotDocumentNoiseContext(context) && !medicalContext) continue;
    addPolibotActualCode(items, {
      code: raw,
      kind: 'KCD',
      label: '상병/KCD 코드',
      source: /심평원|병원|약국|진료/.test(context) ? '심평원/병력 자료' : '고지 메모',
      reason: '상병 또는 KCD 형식 코드로 보여 고지 분류 확인이 필요합니다.',
      context,
      confidence: medicalContext ? 92 : 78
    });
  }
  const explicitPatterns = [
    /(?:보장|담보|특약|상병|질병|고지)\s*(?:코드|번호)\s*[:：#]?\s*(\d{2,5})\b/gi,
    /\b(\d{2,5})\s*번\s*(?:담보|보장|특약|상병|질병|고지|코드)\b/gi
  ];
  for (const pattern of explicitPatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || '';
      const context = codeContext(text, match.index || 0, raw.length);
      if (isPolibotLikelyDateOrAmount(raw, context)) continue;
      addPolibotActualCode(items, {
        code: raw,
        kind: 'numeric',
        label: '숫자 코드',
        source: '자료 내 코드 문맥',
        reason: '코드/번호 문맥에서 나온 숫자입니다. 금액이나 나이가 아닌지 최종 확인하세요.',
        context,
        confidence: /상병|질병|고지/.test(context) ? 82 : 74
      });
    }
  }
  const disclosurePatterns = [
    /\b([35]\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b/g,
    /\b(305|315|325|333|335|345|355|3105|31010|5105|51010|310)\b/g,
    /\b3(\d{1,2})(\d{2})\b/g
  ];
  for (const pattern of disclosurePatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0] || '';
      const code = normalizePolibotDisclosureCode(raw);
      const context = codeContext(text, match.index || 0, raw.length);
      if (!code) continue;
      if (!/간편|유병|고지|표준|심사/.test(context)) continue;
      if (/^(325|335|355|333|310)$/.test(code) && !isPolibotStandaloneCode(text, match.index || 0, raw.length)) continue;
      addPolibotActualCode(items, {
        code,
        kind: 'disclosure',
        label: '간편고지 유형',
        source: '고지 메모',
        reason: '간편고지 유형 숫자로 보여 표준/간편 비교 기준에 반영합니다.',
        context,
        confidence: code.includes('.') ? 90 : 80
      });
    }
  }
  buildPolibotRecommendedDisclosureCodes(form).forEach((item) => {
    if (items.some((row) => row.code === item.code)) return;
    addPolibotActualCode(items, item);
  });
  return items.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 24);
}

function buildPolibotManagerCodeRecommendations(form = {}) {
  const needs = normalizeLines(form.needs);
  const disclosure = form.disclosureDetails && typeof form.disclosureDetails === 'object' ? form.disclosureDetails : {};
  const text = [
    form.medicalHistory,
    Object.values(disclosure).filter(Boolean).join(' '),
    form.existingMedicalPlan,
    form.underwritingAssessment?.route
  ].filter(Boolean).join(' ');
  const items = [];
  const add = (item) => {
    if (!item?.code || items.some((row) => row.code === item.code)) return;
    items.push({
      status: item.status || 'review',
      severity: item.severity || (item.status === 'applied' ? 'info' : 'medium'),
      source: item.source || '설계매니저 기준',
      ...item
    });
  };
  const numberAfter = (pattern) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : null;
  };
  const outpatientDays = numberAfter(/외래\s*(\d+)\s*일/);
  const pharmacyCount = numberAfter(/약국\s*(\d+)\s*건/);
  const medicalCount = numberAfter(/의료기관\s*(\d+)\s*건/);
  if (/심평원\s*5년|의료기관\/약국\s*이용/.test(text)) {
    add({ code: 'HIRA-5Y-REVIEW', label: '심평원 5년 이력 확인', reason: '3개월/1년/5년 고지 질문과 청구 이력을 분리해 확인합니다.', status: 'applied', source: '심평원 자료' });
  }
  if ((Number.isFinite(pharmacyCount) && pharmacyCount >= 3) || /약국\s*청구|약국\s*이력|약국\s*이용/.test(text)) {
    add({ code: 'HIRA-PHARMACY-MULTI', label: '약국 청구 다수', reason: pharmacyCount ? `약국 청구 ${pharmacyCount}건 기준으로 처방일수와 현재 복용 여부를 확인합니다.` : '약국 청구 이력 기준으로 처방일수와 현재 복용 여부를 확인합니다.', status: 'review', source: '심평원 자료' });
  }
  if (Number.isFinite(outpatientDays) && outpatientDays >= 10) {
    add({ code: 'HIRA-OUTPATIENT-MANY', label: '외래 이용 다수', reason: `외래 ${outpatientDays}일 이력이 있어 반복 치료 여부를 확인합니다.`, status: 'review', source: '심평원 자료' });
  }
  if (Number.isFinite(medicalCount) && medicalCount >= 10) {
    add({ code: 'HIRA-MEDICAL-MULTI', label: '의료기관 이용 다수', reason: `의료기관 ${medicalCount}건 기준으로 진료과별 반복 방문을 확인합니다.`, status: 'review', source: '심평원 자료' });
  }
  if (/정형외과|한방병원|관절|허리|목|디스크|염좌/.test(text)) {
    add({ code: 'UW-MUSCULOSKELETAL', label: '근골격계 부담보 확인', reason: '정형외과/한방병원 또는 근골격계 단서가 있어 부위 부담보 가능성을 확인합니다.', status: 'review', source: '심평원/고지 자료' });
  }
  if (/내과|고혈압|혈압|당뇨|고지혈|콜레스테롤|지질/.test(text)) {
    add({ code: 'UW-INTERNAL-MED', label: '내과성 질환 고지 확인', reason: '내과성 질환 단서가 있어 만성질환 투약 여부를 확인합니다.', status: 'review', source: '심평원/고지 자료' });
  }
  if (/검사|재검|추적|관찰|소견/.test(text)) {
    add({ code: 'UW-FOLLOWUP-EXAM', label: '추가검사/추적관찰 확인', reason: '추가검사/추적관찰 단서가 있어 3개월/1년 고지 해당 여부를 확인합니다.', status: 'review', severity: 'high', source: '고지 자료' });
  }
  if (/입원|수술|시술/.test(text)) {
    add({ code: 'UW-ADMISSION-SURGERY', label: '입원/수술 이력 확인', reason: '입원/수술/시술 이력이 있어 5년 고지와 완치 여부를 확인합니다.', status: 'review', severity: 'high', source: '고지 자료' });
  }
  if (form.existingMedicalPlan && form.existingMedicalPlan !== '없음') {
    add({ code: 'MEDPLAN-DUP', label: '기존 실손 중복 확인', reason: '기존 실손이 있어 새 실손/의료비 담보 추천 전 중복 여부를 확인합니다.', status: 'review', source: '보장분석 자료' });
  }
  if (needs.includes('수술')) {
    add({ code: 'NEED-SURGERY', label: '수술비 보완 우선', reason: '필요 보장에 수술이 있어 질병/상해 수술비와 기존 담보 중복을 우선 비교합니다.', status: 'applied', source: '보장분석 자료' });
  }
  if (/간편|유병|고지\s*심사|표준\/간편|조건부|당뇨|고혈압|투약|부담보|할증/.test(text) || items.some((item) => item.severity === 'high')) {
    add({ code: 'ROUTE-SIMPLE-COMPARE', label: '표준/간편 동시 비교', reason: '고지 이슈가 있어 표준심사 단독보다 간편심사 또는 조건부 인수를 함께 비교합니다.', status: 'applied', severity: 'high', source: '설계매니저 기준' });
  }
  if (!items.length && /없음|해당\s*없/.test(text)) {
    add({ code: 'ROUTE-STANDARD-FIRST', label: '표준심사 우선', reason: '입력상 고지 이슈가 낮아 표준심사를 먼저 비교합니다.', status: 'applied', source: '설계매니저 기준' });
  }
  return items.slice(0, 12);
}

function normalizePolibotAdvisorDisplayCodes(codes = []) {
  const output = [];
  const sourceCodes = Array.isArray(codes) ? codes : [];
  const explicitDisclosureCodes = new Set(sourceCodes
    .map((item) => normalizePolibotDisclosureCode(item?.code))
    .filter(Boolean));
  const add = (item = {}) => {
    if (!item?.code || output.some((row) => row.code === item.code && row.label === item.label)) return;
    output.push(item);
  };
  sourceCodes.forEach((item) => {
    const code = displayValue(item?.code).trim();
    if (!code) return;
    const disclosureCode = normalizePolibotDisclosureCode(code);
    if (disclosureCode) {
      add({ ...item, code: disclosureCode, label: item.label || '간편고지 유형', status: item.status || 'review' });
      return;
    }
    if (code === 'ROUTE-SIMPLE-COMPARE') {
      if (explicitDisclosureCodes.size === 0) {
        add({ ...item, code: '간편심사', label: '고지유형 산출 필요', status: 'review', source: '설계매니저 기준' });
      }
      return;
    }
    if (code === 'ROUTE-STANDARD-FIRST') {
      add({ ...item, code: '표준심사', label: '표준체 우선', status: 'applied', source: '설계매니저 기준' });
      return;
    }
    if (code === 'MEDPLAN-DUP') {
      add({ ...item, code: '실손중복', label: '기존 실손 중복 확인', status: 'review', source: item.source || '보장분석 자료' });
      return;
    }
    if (code === 'UW-MUSCULOSKELETAL') {
      add({ ...item, code: '부담보', label: '근골격계 확인', status: 'review' });
      return;
    }
    if (code === 'UW-INTERNAL-MED') {
      add({ ...item, code: '내과고지', label: '만성질환 투약 확인', status: 'review' });
      return;
    }
    if (code === 'UW-FOLLOWUP-EXAM') {
      add({ ...item, code: '추가검사', label: '3개월/1년 고지 확인', status: 'review' });
      return;
    }
    if (code === 'UW-ADMISSION-SURGERY') {
      add({ ...item, code: '입원수술', label: '5년 고지 확인', status: 'review' });
      return;
    }
    if (code === 'HIRA-5Y-REVIEW') {
      add({ ...item, code: '심평원5년', label: '청구 이력 확인', status: 'applied' });
      return;
    }
    if (code === 'HIRA-PHARMACY-MULTI') {
      add({ ...item, code: '투약확인', label: '처방일수/복용 여부', status: 'review' });
      return;
    }
    if (code === 'HIRA-OUTPATIENT-MANY' || code === 'HIRA-MEDICAL-MULTI') {
      add({ ...item, code: '반복진료', label: '동일 질환 반복 치료 확인', status: 'review' });
      return;
    }
    if (/^NEED-/.test(code) || /^\d+$/.test(code)) return;
    add(item);
  });
  return output;
}

function groupPolibotCodes(codes = [], context = {}) {
  const groups = { applied: [], review: [], excluded: [] };
  const contextText = displayValue(context?.recommendationNotice || context?.status || context?.summary || '');
  const explicitTone = (item = {}) => {
    const raw = displayValue(item.tone || item.result || item.status).toLowerCase();
    if (/^(applied|apply|selected|matched|recommended|included)$/.test(raw) || /적용|추천|매칭|선택/.test(raw)) return 'applied';
    if (/^(excluded|exclude|blocked|rejected)$/.test(raw) || /제외|불가|거절|탈락/.test(raw)) return 'excluded';
    if (/^(review|caution|hold|manual_required)$/.test(raw) || /확인|검토|주의|보류/.test(raw)) return 'review';
    return '';
  };
  normalizePolibotAdvisorDisplayCodes(codes).forEach((item) => {
    const explicit = explicitTone(item);
    const text = `${explicit ? displayValue(item.tone || item.result || item.status) : ''} ${displayValue(item.label)} ${displayValue(item.source)} ${contextText}`;
    const key = explicit || (/제외|불가|거절|탈락|exclude|block/i.test(text)
      ? 'excluded'
      : /확인|검토|주의|보류|필요|review|caution/i.test(text)
        ? 'review'
        : 'applied');
    if (!groups[key].some((row) => row.code === item.code)) groups[key].push(item);
  });
  return groups;
}

function PolibotCodeBadges({ codes = [], empty = '분석된 코드 없음', limit = 8, tone = 'applied' }) {
  const safeCodes = Array.isArray(codes) ? codes.filter((item) => item?.code).slice(0, limit) : [];
  if (!safeCodes.length) return <div className="text-xs font-bold text-zinc-600">{empty}</div>;
  const toneClass = tone === 'excluded'
    ? 'border-red-300/20 bg-red-400/10 text-red-100'
    : tone === 'review'
      ? 'border-amber-300/20 bg-amber-400/10 text-amber-100'
      : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';
  const labelClassName = tone === 'excluded' ? 'text-red-100/60' : tone === 'review' ? 'text-amber-100/60' : 'text-cyan-100/60';
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {safeCodes.map((item) => (
        <span key={`${item.code}-${item.label || item.source}`} className={`inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black ${toneClass}`}>
          <span className="shrink-0">{item.code}</span>
          {item.label && <span className={`truncate ${labelClassName}`}>{item.label}</span>}
        </span>
      ))}
    </div>
  );
}

function PolibotCodeSummary({ title, description, groups = {}, empty, compact = false }) {
  const [open, setOpen] = useState(false);
  const applied = groups.applied || [];
  const review = groups.review || [];
  const excluded = groups.excluded || [];
  const total = applied.length + review.length + excluded.length;
  return (
    <div className="grid gap-2 rounded-2xl border border-cyan-300/15 bg-cyan-400/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-200">{title}</div>
          {description && <div className="mt-0.5 text-xs font-bold text-zinc-600">{description}</div>}
        </div>
        <button type="button" onClick={() => setOpen((prev) => !prev)} className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-400 hover:border-white/25 hover:text-zinc-100">
          {open ? '접기' : '상세'}
        </button>
      </div>
      {total ? (
        <div className="grid gap-2 md:grid-cols-3">
          <PolibotCodeCount tone="applied" label="적용" count={applied.length} preview={applied[0]?.code} />
          <PolibotCodeCount tone="review" label="확인 필요" count={review.length} preview={review[0]?.code} />
          <PolibotCodeCount tone="excluded" label="제외" count={excluded.length} preview={excluded[0]?.code} />
        </div>
      ) : <div className="text-xs font-bold text-zinc-600">{empty}</div>}
      {total > 0 && !compact && <PolibotCodeBadges codes={applied.length ? applied : [...review, ...excluded]} limit={3} tone={applied.length ? 'applied' : review.length ? 'review' : 'excluded'} />}
      {open && (
        <div className="grid gap-2 rounded-2xl bg-black/20 p-2.5">
          <PolibotCodeDetail label="적용 코드" codes={applied} tone="applied" />
          <PolibotCodeDetail label="확인 필요 코드" codes={review} tone="review" />
          <PolibotCodeDetail label="제외 코드" codes={excluded} tone="excluded" />
        </div>
      )}
    </div>
  );
}

function PolibotDisclosureAssessmentList({ assessments = [], compact = false }) {
  const safeItems = Array.isArray(assessments) ? assessments.filter((item) => item?.code).slice(0, compact ? 4 : 8) : [];
  if (!safeItems.length) return null;
  const toneFor = (status = '') => {
    if (status === 'recommended') return 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';
    if (status === 'compare') return 'border-amber-300/20 bg-amber-400/10 text-amber-100';
    return 'border-red-300/20 bg-red-400/10 text-red-100';
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-zinc-200">코드별 판단</div>
          <div className="mt-0.5 text-xs font-bold text-zinc-600">고객 병력, 최근 3개월, 자료기간, 서버 코드표 근거를 함께 본 결과입니다.</div>
        </div>
        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-500">{safeItems.length}개</span>
      </div>
      <div className="grid gap-2">
        {safeItems.map((item) => {
          const evidence = Array.isArray(item.evidenceMatches) ? item.evidenceMatches : [];
          return (
            <div key={`${item.code}-${item.status}`} className={`rounded-xl border px-3 py-2 ${toneFor(item.status)}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-black">{item.code}</span>
                <span className="text-xs font-black">{item.statusLabel || item.status || '판단'}</span>
                <span className="text-[10px] font-black opacity-70">{item.confidence ? `${item.confidence}점` : ''}</span>
              </div>
              <div className="mt-1 text-[11px] font-bold leading-relaxed opacity-80">{item.label || item.reason}</div>
              {!compact && Array.isArray(item.blockers) && item.blockers.length > 0 && <div className="mt-1 text-[11px] font-black leading-relaxed opacity-80">보류: {item.blockers.slice(0, 2).join(' · ')}</div>}
              {!compact && item.nextCheck && <div className="mt-1 text-[11px] font-bold leading-relaxed opacity-70">확인: {item.nextCheck}</div>}
              {evidence.length > 0 && (
                <div className="mt-2 flex min-w-0 gap-1.5 overflow-x-auto">
                  {evidence.slice(0, 3).map((row, index) => (
                    <span key={`${row.company}-${row.productName}-${index}`} className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-black opacity-80">
                      {[row.company, row.productName || row.connectedValue].filter(Boolean).join(' · ') || row.source || '근거'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PolibotCodeCount({ label, count, preview, tone }) {
  const toneClass = tone === 'excluded'
    ? 'border-red-300/20 bg-red-400/10 text-red-100'
    : tone === 'review'
      ? 'border-amber-300/20 bg-amber-400/10 text-amber-100'
      : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <div className="text-[10px] font-black opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-black">{count}개{preview ? <span className="ml-1 text-[11px] opacity-70">{preview}</span> : null}</div>
    </div>
  );
}

function PolibotCodeDetail({ label, codes, tone }) {
  return (
    <div className="grid gap-1.5">
      <div className="text-[11px] font-black text-zinc-500">{label}</div>
      <PolibotCodeBadges codes={codes} tone={tone} empty="없음" limit={12} />
    </div>
  );
}


function PolibotGenerateButton({ saving, canGenerate, usage, onGenerate }) {
  return (
    <div className="grid min-w-0 gap-2 rounded-2xl border border-white/10 bg-black/20 p-2.5">
      <DarkButton size="sm" onClick={onGenerate} disabled={!canGenerate} loading={saving} loadingLabel="분석 중">
        {usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}
      </DarkButton>
      {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
    </div>
  );
}

function PolibotRecommendationList({ recommendations, saveMemo, onMemoChange, onSelect, saving, canGenerate, usage, onGenerate, showGenerate = false, testMode = false }) {
  const recommendationState = recommendations.some((item) => (item.reviewReasons || []).length > 0 || item.recommendationStatus === 'needs_review')
    ? '확인 필요 추천'
    : '추천 후보';
  const groupedRecommendations = [
    ['nonlife', '손보 추천', recommendations.filter((item) => item.carrierType === 'nonlife')],
    ['life', '생보 추천', recommendations.filter((item) => item.carrierType === 'life')],
    ['other', '기타 추천', recommendations.filter((item) => !['nonlife', 'life'].includes(item.carrierType))]
  ].filter(([, , items]) => items.length > 0);
  const renderRecommendation = (item) => {
    const itemCodes = collectPolibotCodes(item);
    const itemCodeGroups = groupPolibotCodes(itemCodes, item);
    const designSummary = item.designManagerSummary || item.decisionAnalysis?.designManagerSummary || {};
    const checkItems = [
      designSummary.route && `심사 경로: ${designSummary.route}`,
      designSummary.nextAction && `다음 작업: ${designSummary.nextAction}`,
      ...(designSummary.sellerQuestions || []).slice(0, 2),
      ...(item.reviewReasons || []).slice(0, 2),
      ...(item.routineChecks || []).slice(0, 1)
    ].filter(Boolean);
    return (
      <button key={item.id} type="button" onClick={() => onSelect(item)} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">{item.type === 'bundle' ? '조합 추천' : '단품 추천'}</span>
              {item.carrierTypeLabel && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-zinc-500">{item.carrierTypeLabel}</span>}
            </div>
            <div className="mt-1 break-keep text-sm font-black text-zinc-100">{item.name}</div>
            {!testMode && <div className="mt-1 text-[11px] font-bold text-zinc-600">확신도 {item.confidence?.level || '보통'} · 점수 {item.score || '-'}</div>}
            <div className="mt-2 grid gap-1.5">
              <PolibotCodeBadges codes={itemCodeGroups.applied} empty={itemCodeGroups.review?.length ? '' : '코드 대조 전'} limit={3} tone="applied" />
              {(itemCodeGroups.review || []).length > 0 && <PolibotCodeBadges codes={itemCodeGroups.review} limit={2} tone="review" />}
            </div>
          </div>
          <ChevronRight size={18} className="mt-1 shrink-0 text-zinc-600" />
        </div>
        <div className="mt-3 grid gap-1 text-xs leading-relaxed text-zinc-500">
          {item.coverageGap && <div>핵심 보완: {item.coverageGap}</div>}
          {testMode && <div>보험료: {item.premium || '보험료 자료 없음'}</div>}
          {testMode && item.additionalBudgetMemo && <div>예산 기준: {item.additionalBudgetMemo}</div>}
          {designSummary.route && <div>설계매니저: {designSummary.route}{designSummary.nextAction ? ` · ${designSummary.nextAction}` : ''}</div>}
          {item.feedback && <div className="text-zinc-400">피드백: {item.feedback}{item.feedbackReason ? ` · ${item.feedbackReason}` : ''}</div>}
          {(((item.reviewReasons || []).length > 0 || (item.routineChecks || []).length > 0 || (item.cautions || []).length > 0) || !testMode) && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-950/10 px-3 py-2 font-black text-amber-100/90">
              확인 조건: {checkItems.slice(0, 3).join(' · ') || (item.cautions || [])[0] || '고지사항과 기존 보험 중복 여부 확인'}
            </div>
          )}
          {!testMode && (item.confidence?.reasons || []).slice(0, 2).map((reason) => (
            <div key={reason}>확인 메모: {reason}</div>
          ))}
          {testMode && item.confidence?.level === '낮음' && <div className="text-zinc-600">자료 신뢰도 확인 필요</div>}
        </div>
      </button>
    );
  };
  return (
    <div className="grid gap-3">
      {saving && <PolibotLoadingBanner label="추천 후보를 다시 계산하는 중" />}
      <div className="rounded-2xl bg-black/25 px-4 py-3">
        <div className="text-sm font-black text-zinc-100">{testMode ? recommendationState : '추천 후보'} {recommendations.length}개</div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">손보 최대 3개, 생보 최대 3개로 나눠 보여줍니다. 카드를 눌러 근거와 주의 조건을 확인한 뒤 고객목록에 저장하세요.</p>
      </div>
      <div className="grid gap-2">
        {groupedRecommendations.map(([key, label, items]) => (
          <div key={key} className="grid gap-2">
            <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
              <span className="text-xs font-black text-zinc-200">{label}</span>
              <span className="text-[10px] font-black text-zinc-600">{items.length}/3개</span>
            </div>
            {items.map(renderRecommendation)}
          </div>
        ))}
      </div>
      <label className={`${labelClass} mt-1`}>저장 메모<textarea className={inputClass} rows="2" value={saveMemo} onChange={(event) => onMemoChange(event.target.value)} placeholder="고객에게 확인할 내용이나 메모를 적어두세요." /></label>
      {showGenerate && <PolibotGenerateButton saving={saving} canGenerate={canGenerate} usage={usage} onGenerate={onGenerate} />}
    </div>
  );
}

function PolibotRecommendationEmptyState({ workspace, hasAnalysis = false, catalogCompanies = [], onOpenDetails, onOpenKnowledge, showDetailAction = true }) {
  const report = workspace.qualityReport || {};
  const draft = workspace.consultationDraft || {};
  const missing = Array.isArray(draft.missing) ? draft.missing : [];
  const recommendable = Number(report.recommendableProducts || 0);
  const hardMissing = missing.filter((label) => ['나이', '필요 보장', '예산'].includes(label));
  const hasCustomerBlocker = hardMissing.length > 0 || /나이|필요 보장|예산|고객 조건|정보를 먼저/.test(workspace.recommendationNotice || '');
  const hasDataBlocker = recommendable <= 0 || catalogCompanies.length === 0 || /상품 자료|상품 데이터|확정 상품|자료 부족|검수 필요|검토 필요|OCR/i.test(workspace.recommendationNotice || '');
  const title = !hasAnalysis
    ? '고객 분석을 먼저 해주세요'
    : hasCustomerBlocker
      ? '고객 조건을 더 입력해야 해요'
      : hasDataBlocker
        ? '추천 가능한 상품 자료가 부족해요'
        : '조건에 맞는 추천 후보가 아직 없어요';
  const notice = workspace.recommendationNotice || (!hasAnalysis
    ? '핵심 조건을 넣고 추천 초안 만들기를 누르면 고객 분석이 먼저 정리돼요.'
    : hasCustomerBlocker
      ? '상세 조건을 보강하면 추천 가능성이 올라갑니다.'
      : hasDataBlocker
        ? '자료 확인에서 상품 비교표나 설계 자료를 추가해 주세요.'
        : '니즈, 예산, 보험사 범위를 조금 더 구체화해 주세요.');
  const action = hasDataBlocker && !hasCustomerBlocker
    ? { label: '자료 확인', onClick: onOpenKnowledge }
    : showDetailAction ? { label: '상세 조건 채우기', onClick: onOpenDetails } : null;
  return (
    <div className="grid gap-3">
      <div className="rounded-2xl bg-black/25 px-4 py-3">
        <div className="text-sm font-black text-zinc-100">{title}</div>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{notice}</p>
      </div>
      <div className="grid gap-2 text-sm">
        <PolibotStatusRow label="고객 정보" value={hardMissing.length ? `필수 부족: ${hardMissing.join(', ')}` : missing.length ? `확인 필요: ${missing.join(', ')}` : hasAnalysis ? '핵심 조건 확인됨' : '분석 전'} />
        <PolibotStatusRow label="상품 자료" value={`보험사 후보 ${catalogCompanies.length}개 · 자동 확정 ${recommendable}개`} />
      </div>
      {action && <DarkButton variant="ghost" size="sm" onClick={action.onClick} className="w-full">{action.label}</DarkButton>}
    </div>
  );
}

function PolibotStatusRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
      <div className="text-xs font-black text-zinc-600">{label}</div>
      <div className="max-w-[70%] text-right text-xs font-black leading-relaxed text-zinc-200">{displayValue(value)}</div>
    </div>
  );
}

function PolibotRecommendationModal({ recommendation, profile, onClose, onSave, onFeedback, testMode = false }) {
  const [feedback, setFeedback] = useState(recommendation.feedback || '');
  const [feedbackReason, setFeedbackReason] = useState(recommendation.feedbackReason || '');
  const [feedbackMemo, setFeedbackMemo] = useState(recommendation.feedbackMemo || '');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const analysis = recommendation.decisionAnalysis || {};
  const designManagerSummary = recommendation.designManagerSummary || analysis.designManagerSummary || {};
  const reviewSummary = recommendation.reviewSummary || {};
  const reviewReasons = recommendation.reviewReasons || [...(reviewSummary.blockers || []), ...(reviewSummary.reasons || [])];
  const routineChecks = recommendation.routineChecks || reviewSummary.routineChecks || [];
  const cautionItems = reviewReasons.length || routineChecks.length
    ? [...reviewReasons, ...routineChecks]
    : (recommendation.cautions || []);
  const saveWithFeedback = () => onSave({
    ...recommendation,
    feedback,
    feedbackReason,
    feedbackMemo,
    feedbackSavedAt: feedback ? new Date().toISOString() : recommendation.feedbackSavedAt
  });
  const submitFeedback = async () => {
    if (!feedback || !onFeedback) return;
    setSavingFeedback(true);
    try {
      await onFeedback(recommendation, { feedback, reason: feedbackReason, memo: feedbackMemo });
    } finally {
      setSavingFeedback(false);
    }
  };
  const feedbackReasons = ['상품명 틀림', '보장 매칭 부족', '조건 누락', '설명 부족', '고객 조건 부족'];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="max-h-[86vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-black text-zinc-100">{recommendation.name}</div>
            <div className="mt-1 text-xs font-bold text-zinc-600">
              {recommendation.type === 'bundle' ? '조합 추천' : '단품 추천'}{!testMode && ` · 점수 ${recommendation.score}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100"><X size={18} /></button>
        </div>
        <div className="mt-5 grid gap-3">
          {!testMode && <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/25 p-4">
            {[
              ['검토 이유', reviewSummary.summary || recommendation.headline || recommendation.reason || '고객 조건과 근거 자료가 맞는 조합이에요.'],
              ['확인 조건', reviewReasons[0] || routineChecks[0] || (recommendation.cautions || [])[0] || '고지사항과 기존 보험 중복 여부를 확인해 주세요.'],
              ['추천 상태', recommendation.recommendationStatusLabel || (recommendation.recommendationStatus === 'ready' ? '추천 초안 준비' : '상담 확인 필요')]
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">{label}</div>
                <div className="text-sm font-black leading-relaxed text-zinc-200">{value}</div>
              </div>
            ))}
          </div>}
          <div className="grid gap-2 rounded-2xl bg-black/25 p-4 text-sm text-zinc-400">
            <AccountInfoRow label="추천 조합" value={recommendation.name || '-'} />
            <AccountInfoRow label="고객 조건" value={[profile?.name, profile?.age ? `${profile.age}세` : '', profile?.gender].filter(Boolean).join(' · ') || '미입력'} />
            <AccountInfoRow label="고객 목적" value={profile?.purpose || '미입력'} />
            <AccountInfoRow label="필요 보장" value={(profile?.needs || []).join(', ') || '미입력'} />
            <AccountInfoRow label="가입 가능성" value={analysis.eligibilityLevel || '확인 필요'} />
            <AccountInfoRow label="추천 상태" value={recommendation.recommendationStatusLabel || recommendation.recommendationStatus || '확인 필요'} />
            <AccountInfoRow label="판단 점수" value={analysis.decisionScore ? `${analysis.decisionScore.level} · ${analysis.decisionScore.score}점 · ${analysis.decisionScore.reason}` : '-'} />
            <AccountInfoRow label="근거 정확도" value={analysis.evidenceIntegrity ? `${analysis.evidenceIntegrity.level} · ${analysis.evidenceIntegrity.score}점 · ${analysis.evidenceIntegrity.reason}` : '-'} />
            <AccountInfoRow label="목적 적합도" value={analysis.purposeAnalysis ? `${analysis.purposeAnalysis.level} · ${analysis.purposeAnalysis.score}점 · ${analysis.purposeAnalysis.label}` : '-'} />
            <AccountInfoRow label="가격 전략" value={analysis.priceStrategy?.label || recommendation.additionalBudgetMemo || '-'} />
            <AccountInfoRow label="설계매니저 판단" value={[designManagerSummary.route, designManagerSummary.nextAction].filter(Boolean).join(' · ') || '-'} />
            <AccountInfoRow label="보완 포인트" value={recommendation.coverageGap || '-'} />
            <AccountInfoRow label="추천 보장코드" value={(recommendation.matchedCoverageCodes || []).slice(0, 12).map((item) => `${item.code}${item.connectedValue || item.label ? ` ${item.connectedValue || item.label}` : ''}`).join(', ') || '-'} />
            <AccountInfoRow label="보험료 메모" value={[recommendation.premium, recommendation.premiumConfidence === 'reference' ? '참고값' : ''].filter(Boolean).join(' · ') || '-'} />
            {testMode && <AccountInfoRow label="예산 기준" value={recommendation.additionalBudgetMemo || '-'} />}
            <AccountInfoRow label="확인 조건" value={cautionItems.join(', ') || '추가 확인 필요'} />
            {!testMode && <AccountInfoRow label="추천 확신도" value={`${recommendation.confidence?.level || '보통'}${recommendation.confidence?.reasons?.length ? ` · ${recommendation.confidence.reasons.join(', ')}` : ''}`} />}
            {testMode && recommendation.confidence?.level === '낮음' && <AccountInfoRow label="자료 신뢰도" value="확인 필요" />}
          </div>
          {(analysis.why || analysis.coverageMatches || analysis.ageChecks || analysis.medicalRisk || analysis.priceStrategy) && (
            <CollapsiblePanel title="상담 판단 분석">
              <div className="grid gap-3">
                {(analysis.why || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">왜 추천하는지</div>
                    <SimpleInfoList items={(recommendation.advisorExplanation || []).length ? recommendation.advisorExplanation : analysis.why} />
                  </div>
                )}
                {(analysis.coverageMatches || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">보장 니즈 매칭</div>
                    <SimpleInfoList items={analysis.coverageMatches.map((item) => `${item.need} · ${item.label} · ${item.reason}`)} />
                  </div>
                )}
                {(recommendation.matchedCoverageCodes || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">polidoc 추천 보장코드</div>
                    <SimpleInfoList items={(recommendation.matchedCoverageCodes || []).slice(0, 12).map((item) => `${item.code} · ${item.connectedValue || item.label || '보장 코드'} · ${item.company || (item.companies || [])[0] || '보험사 확인'} · ${item.source || 'polidoc'}${item.confidence ? ` · ${item.confidence}점` : ''}`)} />
                  </div>
                )}
                {(designManagerSummary.route || (designManagerSummary.recommendedCodes || []).length > 0) && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">설계매니저 판단</div>
                    <SimpleInfoList items={[
                      designManagerSummary.route && `심사 경로 · ${designManagerSummary.route}`,
                      designManagerSummary.routeReason && `경로 근거 · ${designManagerSummary.routeReason}`,
                      designManagerSummary.nextAction && `다음 작업 · ${designManagerSummary.nextAction}`,
                      ...(designManagerSummary.priorityCoverage || []).map((item) => `우선 보장 · ${item.label} · ${item.priority} · ${item.reason}`),
                      ...(designManagerSummary.recommendedCodes || []).slice(0, 8).map((item) => `추천 코드 · ${item.code} · ${item.connectedValue || '보장 코드'} · ${item.category || '분류 확인'} · ${item.priority || '검토'}`),
                      ...(designManagerSummary.riskFlags || []).slice(0, 6).map((item) => `리스크 확인 · ${item}`),
                      ...(designManagerSummary.sellerQuestions || []).slice(0, 6).map((item) => `설계사 확인 · ${item}`)
                    ].filter(Boolean)} />
                  </div>
                )}
                {analysis.evidenceIntegrity && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">근거 정확도</div>
                    <SimpleInfoList items={[
                      `${analysis.evidenceIntegrity.level} · ${analysis.evidenceIntegrity.score}점 · ${analysis.evidenceIntegrity.reason}`,
                      ...((analysis.evidenceIntegrity.checks || []).map((item) => `${item.label} · ${item.status} · ${item.reason}`))
                    ]} />
                  </div>
                )}
                {analysis.purposeAnalysis && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">목적 적합도</div>
                    <SimpleInfoList items={[
                      `${analysis.purposeAnalysis.label} · ${analysis.purposeAnalysis.level} ${analysis.purposeAnalysis.score}점`,
                      ...((analysis.purposeAnalysis.successCriteria || []).map((item) => `성공 조건 · ${item}`)),
                      ...((analysis.purposeAnalysis.blockers || []).map((item) => `보류 조건 · ${item}`)),
                      ...((analysis.purposeAnalysis.tradeoffs || []).map((item) => `트레이드오프 · ${item}`))
                    ]} />
                  </div>
                )}
                {analysis.itemDecisionSummary && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">상품 선정 요약</div>
                    <SimpleInfoList items={[
                      (analysis.itemDecisionSummary.priorityItems || []).length > 0 && `우선 후보 · ${analysis.itemDecisionSummary.priorityItems.join(', ')}`,
                      ...((analysis.itemDecisionSummary.holdItems || []).map((item) => `${[item.company, item.productName].filter(Boolean).join(' ') || '상품'} · 보류/검수 · ${(item.reasons || []).join(', ') || '조건 확인 필요'}`)),
                      (analysis.itemDecisionSummary.premiumUnknownItems || []).length > 0 && `보험료 확인 필요 · ${analysis.itemDecisionSummary.premiumUnknownItems.join(', ')}`
                    ].filter(Boolean)} />
                  </div>
                )}
                {(reviewReasons.length > 0 || routineChecks.length > 0) && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">검수/확인 분리</div>
                    <SimpleInfoList items={[
                      ...reviewReasons.map((item) => `검수 필요 · ${item}`),
                      ...routineChecks.map((item) => `상담 확인 · ${item}`)
                    ]} />
                  </div>
                )}
                {(analysis.coveragePriority || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">보장 우선순위</div>
                    <SimpleInfoList items={analysis.coveragePriority.map((item) => `${item.need} · ${item.priority} · ${item.reason}`)} />
                  </div>
                )}
                {(analysis.ageChecks || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">나이/가입 조건</div>
                    <SimpleInfoList items={analysis.ageChecks.map((item) => `${[item.company, item.productName].filter(Boolean).join(' ')} · ${item.label} · ${item.reason}`)} />
                  </div>
                )}
                {(analysis.itemDiagnostics || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">상품별 세부 진단</div>
                    <SimpleInfoList items={analysis.itemDiagnostics.map((item) => {
                      const breakdown = item.decisionBreakdown || {};
                      const scoreParts = [
                        breakdown.coverage && `보장 ${breakdown.coverage.score}`,
                        breakdown.age && `연령 ${breakdown.age.score}`,
                        breakdown.premium && `보험료 ${breakdown.premium.score}`,
                        breakdown.underwriting && `심사 ${breakdown.underwriting.score}`,
                        breakdown.evidence && `근거 ${breakdown.evidence.score}`,
                        breakdown.renewal && breakdown.renewal.score ? `갱신 ${breakdown.renewal.score}` : ''
                      ].filter(Boolean).join(' / ');
                      const detailParts = [
                        breakdown.premium?.matchQuality?.label,
                        breakdown.underwriting?.classification?.label,
                        breakdown.evidence?.quality?.level && `근거품질 ${breakdown.evidence.quality.level}`
                      ].filter(Boolean).join(' · ');
                      const strengths = (item.strengths || breakdown.strengths || []).slice(0, 2).join(', ');
                      const blockers = (item.blockers || breakdown.blockers || []).slice(0, 2).join(', ');
                      return `${[item.company, item.productName].filter(Boolean).join(' ')} · ${item.fitLevel} ${item.fitScore}점 · 매칭 ${item.matchedNeeds.join(', ') || '없음'} · ${item.premiumStatus}${detailParts ? ` · ${detailParts}` : ''}${scoreParts ? ` · ${scoreParts}` : ''}${strengths ? ` · 강점: ${strengths}` : ''}${blockers ? ` · 확인: ${blockers}` : item.cautions.length ? ` · 주의: ${item.cautions.join(', ')}` : ''}`;
                    })} />
                  </div>
                )}
                {(analysis.companyOutlook || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">보험사별 가능성</div>
                    <SimpleInfoList items={analysis.companyOutlook.map((item) => `${item.company} · ${item.status} ${item.fitScore || 0}점 · ${item.route} · 상품 ${item.products.join(', ') || '확인 필요'} · ${item.reasons.join(' ')}`)} />
                  </div>
                )}
                {analysis.medicalRisk && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">병력/고지 판단</div>
                    <SimpleInfoList items={[
                      analysis.medicalRisk.label,
                      analysis.medicalRisk.routeHint && `심사 방향 · ${analysis.medicalRisk.routeHint}`,
                      ...((analysis.medicalRisk.flags || []).map((item) => `${item.label} · ${item.risk} · ${item.question}`)),
                      ...(analysis.medicalRisk.reasons || [])
                    ].filter(Boolean)} />
                  </div>
                )}
                {(analysis.underwritingRoute || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">심사 경로 추천</div>
                    <SimpleInfoList items={analysis.underwritingRoute.map((item) => `${item.priority}순위 · ${item.label} · ${item.status} · ${item.reason}`)} />
                  </div>
                )}
                {(analysis.disclosureTimeline || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">고지 기간 체크</div>
                    <SimpleInfoList items={analysis.disclosureTimeline.map((item) => `${item.label} · ${item.status} · ${item.reason}`)} />
                  </div>
                )}
                {(analysis.underwritingChecklist || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">인수심사 체크리스트</div>
                    <SimpleInfoList items={analysis.underwritingChecklist.map((item) => `${item.label} · ${item.status} · ${item.reason}`)} />
                  </div>
                )}
                {analysis.priceStrategy && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">보험료 의사결정</div>
                    <SimpleInfoList items={[
                      analysis.priceStrategy.label,
                      analysis.premiumFit && `${analysis.premiumFit.label} · ${analysis.premiumFit.reason}`,
                      ...(analysis.priceStrategy.reasons || [])
                    ].filter(Boolean)} />
                  </div>
                )}
                {(analysis.premiumReferences || []).length > 0 && (
                  <div className="rounded-2xl bg-black/25 px-4 py-3">
                    <div className="text-[11px] font-black text-zinc-600">문서 내 참고 보험료표</div>
                    <SimpleInfoList items={analysis.premiumReferences.map((item) => `${[item.company, item.productName || item.label, item.age ? `${item.age}세` : '', item.gender].filter(Boolean).join(' · ')} · ${item.premium} · 상품 연결 ${item.linkStatus === 'linked' ? '확정' : '검수 필요'}`)} />
                  </div>
                )}
              </div>
            </CollapsiblePanel>
          )}
          {(recommendation.catalogItems || []).length > 0 && (
            <CollapsiblePanel title="확정 상품 정보">
              {(recommendation.catalogItems || []).map((item, index) => (
                <div key={`${item.productName}-${index}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-black text-zinc-200">{[item.company, item.productName].filter(Boolean).join(' ') || '상품명 미입력'}</div>
                    <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] font-black text-zinc-500">정보 {item.completeness || '부족'}</span>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs leading-relaxed text-zinc-500">
                    <div>상품군: {item.productGroup || '미분류'} · 담보: {(item.coverageKeywords || []).join(', ') || '미입력'}</div>
                    {(item.ageRange || item.paymentTerm || item.renewalType) && (
                      <div>조건: {[item.ageRange, item.paymentTerm, item.renewalType].filter(Boolean).join(' · ')}</div>
                    )}
                    {(item.premiumExample || item.refundRate) && (
                      <div>보험료/환급: {[item.premiumExample, item.refundRate].filter(Boolean).join(' · ')}</div>
                    )}
                    {(item.coverageDetails || []).length > 0 && (
                      <div>세부 담보: {(item.coverageDetails || []).slice(0, 5).map((coverage) => [coverage.fineCategory || coverage.category, coverage.title, coverage.amount].filter(Boolean).join(' ')).join(' · ')}</div>
                    )}
                    {item.decisionBreakdown && (
                      <div>
                        추천판단: {[item.decisionBreakdown.level, item.decisionBreakdown.score ? `${item.decisionBreakdown.score}점` : '', item.decisionBreakdown.premium?.amount ? `보험료 ${item.decisionBreakdown.premium.amount}` : '', item.decisionBreakdown.age?.label, item.decisionBreakdown.underwriting?.status].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {(item.decisionBreakdown?.strengths || []).length > 0 && (
                      <div>강점: {(item.decisionBreakdown.strengths || []).slice(0, 3).join(' · ')}</div>
                    )}
                    {(item.decisionBreakdown?.blockers || []).length > 0 && (
                      <div>확인 필요: {(item.decisionBreakdown.blockers || []).slice(0, 3).join(' · ')}</div>
                    )}
                    {(item.linkedBenefitGroups || []).length > 0 && (
                      <div className="mt-2 space-y-2">
                        {(item.linkedBenefitGroups || []).slice(0, 2).map((group, groupIndex) => (
                          <div key={`${group.key || group.plan || groupIndex}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                            <div className="font-black text-zinc-300">
                              {[group.linkConfidence === 'strong' ? '강한 연결' : group.linkConfidence === 'usable' ? '사용 가능 연결' : '검수 필요 연결', group.linkedSummary || group.plan].filter(Boolean).join(' · ')}
                            </div>
                            {(group.premiums || []).length > 0 && (
                              <div>보험료: {(group.premiums || []).slice(0, 3).map((premium) => [premium.gender, premium.age ? `${premium.age}세` : '', premium.amount].filter(Boolean).join(' ')).join(' · ')}</div>
                            )}
                            {(group.coverages || []).length > 0 && (
                              <div>담보: {(group.coverages || []).slice(0, 4).map((coverage) => [coverage.fineCategory || coverage.category, coverage.title, coverage.amount].filter(Boolean).join(' ')).join(' · ')}</div>
                            )}
                            {(group.conditions?.ageRange || group.conditions?.paymentTerm || group.conditions?.renewalType) && (
                              <div>조건: {[group.conditions.ageRange, group.conditions.paymentTerm, group.conditions.renewalType].filter(Boolean).join(' · ')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {(item.disclosureMemo || item.reductionMemo) && (
                      <div>고지/감액: {[item.disclosureMemo, item.reductionMemo].filter(Boolean).join(' · ')}</div>
                    )}
                    {(item.evidenceAnchors || []).length > 0 && (
                      <div>원문 근거: {(item.evidenceAnchors || []).slice(0, 2).map((anchor) => anchor.excerpt).filter(Boolean).join(' · ')}</div>
                    )}
                    {(item.targetAudience || []).length > 0 && <div>추천 대상: {item.targetAudience.join(', ')}</div>}
                    {(item.excludedAudience || []).length > 0 && <div>제외 대상: {item.excludedAudience.join(', ')}</div>}
                    {item.cautionMemo && <div>주의: {item.cautionMemo}</div>}
                  </div>
                </div>
              ))}
            </CollapsiblePanel>
          )}
          {(recommendation.excludedCandidates || []).length > 0 && (
            <CollapsiblePanel title="제외/보류 후보">
              <SimpleInfoList items={recommendation.excludedCandidates.map((item) => `${item.name} · ${item.reason}${(item.details || []).length ? ` · ${(item.details || []).join(' / ')}` : ''}`)} />
            </CollapsiblePanel>
          )}
          {(recommendation.nextQuestions || []).length > 0 && (
            <CollapsiblePanel title="추가 확인 질문">
              <SimpleInfoList items={recommendation.nextQuestions} />
            </CollapsiblePanel>
          )}
          <div className="grid gap-2">
            <div className="text-xs font-black text-zinc-500">검토 피드백</div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl bg-black/25 p-1">
              {['좋음', '애매함', '틀림'].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFeedback(value)}
                  className={`rounded-xl px-3 py-2 text-sm font-black ${feedback === value ? 'bg-white text-zinc-950' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {feedbackReasons.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFeedbackReason((current) => current === value ? '' : value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                    feedbackReason === value
                      ? 'border-white bg-white text-zinc-950'
                      : 'border-white/10 text-zinc-500 hover:border-white/30 hover:text-zinc-200'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <textarea
              value={feedbackMemo}
              onChange={(event) => setFeedbackMemo(event.target.value)}
              rows="2"
              className={`${inputClass} text-xs`}
              placeholder="틀리거나 애매한 이유를 짧게 남겨주세요."
            />
            <button
              type="button"
              onClick={submitFeedback}
              disabled={!feedback || savingFeedback}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-black text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            >
              {savingFeedback && <RefreshCw size={15} className="shrink-0 animate-spin" />}
              {savingFeedback ? '피드백 저장 중' : '피드백 저장'}
            </button>
          </div>
          <CollapsiblePanel title="근거 자료">
            {(recommendation.evidence || []).map((source) => (
              <div key={`${source.month}-${source.fileName}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm">
                <div className="font-black text-zinc-200">{source.month} · {source.fileName}</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-500">
                  {(source.companies || [source.company]).filter(Boolean).join(', ') || '보험사 미분류'} · {source.productGroup || '상품군 미분류'} · {(source.keywords || []).slice(0, 6).join(', ') || '키워드 없음'}
                </div>
                {source.summary && <div className="mt-2 text-xs leading-relaxed text-zinc-600">{source.summary}</div>}
              </div>
            ))}
          </CollapsiblePanel>
          <DarkButton onClick={saveWithFeedback}>고객목록에 저장</DarkButton>
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
    api.get('/api/product-workspace/polibot/customer-workspace')
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
                <DarkButton onClick={saveEdit} disabled={saving} loading={saving} loadingLabel="저장 중">수정 저장</DarkButton>
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
    api.get('/api/product-workspace/polibot/customer-workspace')
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
    if (filters.type === 'draft') {
      header = ['customerName', 'age', 'gender', 'needs', 'completeness', 'missing', 'nextQuestions', 'cautions', 'memo'];
      rows = rowsSource.map((customer) => {
        const draft = customer.consultationDraft || workspace.consultationDraft || {};
        const profile = customer.name ? customer : workspace.customerProfile || {};
        return [
          profile.name || customer.name,
          profile.age || customer.age,
          profile.gender || customer.gender,
          (profile.needs || draft.needs || []).join(' | '),
          draft.completeness || '',
          (draft.missing || []).join(' | '),
          (draft.nextQuestions || []).join(' | '),
          (draft.cautions || []).join(' | '),
          draft.memo || customer.memo || ''
        ].map(csvEscape).join(',');
      });
    } else if (filters.type === 'customers') {
      header = ['customerName', 'age', 'gender', 'needs', 'budget', 'selectedRecommendation', 'confidence', 'feedback', 'feedbackReason', 'excludedCandidates', 'memo', 'savedAt'];
      rows = rowsSource.map((customer) => [
        customer.name,
        customer.age,
        customer.gender,
        (customer.needs || []).join(' | '),
        customer.budget,
        customer.selectedRecommendation?.name || '',
        customer.selectedRecommendation?.confidence?.level || '',
        customer.selectedRecommendation?.feedback || '',
        customer.selectedRecommendation?.feedbackReason || '',
        (customer.excludedCandidates || customer.selectedRecommendation?.excludedCandidates || []).map((item) => `${item.name}: ${item.reason}`).join(' | '),
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
      header = ['customerName', 'recommendationName', 'type', 'score', 'confidence', 'feedback', 'feedbackReason', 'coverageGap', 'premium', 'cautions', 'excludedCandidates', 'nextQuestions', 'evidenceProducts', 'evidenceFiles'];
      rows = rowsSource.flatMap((customer) => (customer.recommendations || workspace.recommendations || []).map((rec) => [
        customer.name,
        rec.name,
        rec.type === 'bundle' ? '조합' : '단품',
        rec.score,
        rec.confidence?.level || '',
        rec.feedback || '',
        rec.feedbackReason || '',
        rec.coverageGap,
        rec.premium,
        (rec.cautions || []).join(' | '),
        (rec.excludedCandidates || []).map((item) => `${item.name}: ${item.reason}`).join(' | '),
        (rec.nextQuestions || []).join(' | '),
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
          <DarkSelect label="상품군" value={filters.productGroup} onChange={(value) => setFilters((prev) => ({ ...prev, productGroup: value }))} options={[{ value: '', label: '전체 상품군' }, ...(workspace.catalog?.productGroups || []).map((item) => ({ value: item, label: item }))]} searchable searchPlaceholder="상품군 검색" />
          <DarkSelect label="자료 월" value={filters.month} onChange={(value) => setFilters((prev) => ({ ...prev, month: value }))} options={[{ value: '', label: '전체 월' }, ...(workspace.catalog?.months || []).map((item) => ({ value: item, label: item }))]} searchable searchPlaceholder="자료 월 검색" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DarkSelect label="대상" value={filters.target} onChange={(value) => setFilters((prev) => ({ ...prev, target: value }))} options={[{ value: 'all', label: '저장 고객 전체' }, { value: 'latest', label: '현재 추천 결과' }]} />
          <DarkSelect label="다운로드 종류" value={filters.type} onChange={(value) => setFilters((prev) => ({ ...prev, type: value }))} options={[{ value: 'draft', label: '고객 분석' }, { value: 'recommendations', label: '상품 추천' }, { value: 'customers', label: '고객별 기록' }, { value: 'evidence', label: '근거 자료 요약' }]} />
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
  const [candidateFiles, setCandidateFiles] = useState([]);
  const [workspace, setWorkspace] = useState({});
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const usage = workspaceUsage(workspace);
  const savedCandidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const candidateCount = savedCandidates.length || rows.split(/\n|\r/).map((line) => line.trim()).filter(Boolean).filter((line, index) => !(index === 0 && /url|handle|category|followers|팔로워|카테고리|조회수|views?/i.test(line))).length;

  const persistCandidates = async ({ nextRows = rows, nextFileName = fileName, nextFiles = candidateFiles, silent = false } = {}) => {
    const next = await api.post('/api/product-workspace/infludex/candidates', { rows: nextRows, fileName: nextFileName, files: nextFiles });
    setWorkspace(next || {});
    setRows(next?.candidateRows || nextRows || '');
    setFileName(next?.fileName || nextFileName || '');
    setCandidateFiles([]);
    if (!silent) toast('인스타그램 후보를 저장했어요.', 'success');
    return next;
  };

  const loadCandidateFile = (file) => {
    if (!file) return;
    if (!/\.(csv|txt|docx)$/i.test(file.name)) {
      toast('CSV, TXT, DOCX 파일만 업로드할 수 있어요.', 'error');
      return;
    }
    setFileName(file.name);
    setParsing(true);
    if (/\.docx$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = async () => {
        const result = String(reader.result || '');
        const nextFiles = [{
          fileName: file.name,
          name: file.name,
          size: file.size,
          type: file.type || '',
          base64: result.includes(',') ? result.split(',').pop() : result
        }];
        setCandidateFiles(nextFiles);
        try {
          await persistCandidates({ nextRows: '', nextFileName: file.name, nextFiles, silent: true });
          toast('DOCX 후보 파일을 분석해 저장했어요.', 'success');
        } catch (err) {
          toast(err.message || 'DOCX 후보 파일 분석에 실패했어요.', 'error');
        } finally {
          setParsing(false);
        }
      };
      reader.onerror = () => {
        setParsing(false);
        toast('파일을 읽지 못했어요.', 'error');
      };
      reader.readAsDataURL(file);
      return;
    }
    setCandidateFiles([]);
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result || '').trim();
      if (!text) {
        setParsing(false);
        toast('파일 내용이 비어 있어요.', 'error');
        return;
      }
      const nextRows = [rows.trim(), text].filter(Boolean).join('\n');
      setRows(nextRows);
      try {
        await persistCandidates({ nextRows, nextFileName: file.name, nextFiles: [], silent: true });
        toast('후보 파일 내용을 분석해 저장했어요.', 'success');
      } catch (err) {
        toast(err.message || '후보 파일 분석에 실패했어요.', 'error');
      } finally {
        setParsing(false);
      }
    };
    reader.onerror = () => {
      setParsing(false);
      toast('파일을 읽지 못했어요.', 'error');
    };
    reader.readAsText(file, 'utf-8');
  };

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => {
        setWorkspace(data || {});
        setRows(data?.candidateRows || '');
        setFileName(data?.fileName || '');
      })
      .catch((err) => toast(err.message || 'INFLUDEX 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      await persistCandidates();
      onOpenGrade?.();
    } catch (err) {
      toast(err.message || '후보 저장에 실패했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/infludex/reset', {});
      setWorkspace(next || {});
      setRows('');
      setFileName('');
      setCandidateFiles([]);
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
        <div className="mb-3 grid gap-2">
          <div className="text-sm font-black text-zinc-300">파일 업로드</div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/25 px-4 py-5 text-sm font-bold text-zinc-300 hover:bg-white/5">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Upload size={17} />
              <span className="min-w-0 truncate">{fileName || 'CSV/TXT/DOCX 업로드'}</span>
            </span>
            <input
              type="file"
              accept=".csv,.txt,.docx"
              className="hidden"
              onChange={(event) => loadCandidateFile(event.target.files?.[0])}
            />
          </label>
          <p className="mt-3 text-xs leading-relaxed text-zinc-600">CSV, TXT, DOCX 지원 · 최근 5개 릴스 평균 조회수 필수</p>
        </div>
        <label className={labelClass}>
          후보 목록
          <textarea
            className={inputClass}
            rows="7"
            value={rows}
            onChange={(event) => setRows(event.target.value)}
            placeholder={'url,handle,category,followers,avgLikes,avgComments,avgReelsViews,recentPostAt,adMemo\nhttps://instagram.com/example,@example,뷰티,30000,1500,180,42000,2026-05-01,'}
          />
        </label>
        <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-500">
          {parsing ? '파일 분석 중...' : `현재 후보 ${candidateCount}개`}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={save} disabled={saving || parsing || (!rows.trim() && candidateFiles.length === 0 && savedCandidates.length === 0)} loading={saving} loadingLabel="저장 중">후보 저장</DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={saving || parsing || (savedCandidates.length === 0 && !rows.trim() && !fileName)}>새로 올리기</DarkButton>
        </div>
      </PanelCard>
      {savedCandidates.length > 0 && (
        <PanelCard title="저장된 후보">
          <div className="grid gap-2">
            {savedCandidates.slice(0, 8).map((item) => {
              const followers = Number(item.followerCount || 0);
              const reelsViews = Number(item.avgReelsViews || 0);
              return (
                <div key={item.id || item.handle || item.url} className="rounded-2xl bg-black/25 px-4 py-3">
                  <div className="text-sm font-black text-zinc-200">{infludexCandidateLabel(item)}</div>
                  <div className="mt-1 text-xs font-bold text-zinc-500">{[item.displayName || item.description, item.category, followers ? `팔로워 ${followers.toLocaleString('ko-KR')}` : '분석 대기', reelsViews ? `릴스 평균 조회 ${reelsViews.toLocaleString('ko-KR')}` : '릴스 조회수 필요'].filter(Boolean).join(' · ')}</div>
                </div>
              );
            })}
          </div>
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
  const scoredResults = results.filter((item) => item.analysisStatus !== 'data_missing' && item.grade);
  const missingResults = results.filter((item) => item.analysisStatus === 'data_missing' || !item.grade);
  const recommendedResults = scoredResults.filter((item) => ['S', 'A'].includes(item.grade));
  const reviewResults = results.filter((item) => !['S', 'A'].includes(item.grade));
  const gradeRows = ['S', 'A', 'B', 'C', 'D'].map((grade) => [grade, scoredResults.filter((item) => item.grade === grade).length]);

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
      toast('후보 분석을 완료했어요.', 'success');
    } catch (err) {
      toast(err.message || '후보 분석에 실패했어요.', 'error');
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
      <PanelCard title="후보 분석">
        <ProductUsageStrip usage={usage} />
        {results.length > 0 && (
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">전체</div>
              <div className="mt-1 text-xl font-black text-zinc-100">{results.length}</div>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">추천</div>
              <div className="mt-1 text-xl font-black text-emerald-300">{recommendedResults.length}</div>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">확인 필요</div>
              <div className="mt-1 text-xl font-black text-amber-300">{reviewResults.length}</div>
            </div>
          </div>
        )}
        {results.length > 0 && (
          <div className="mb-3 grid grid-cols-5 gap-2">
            {gradeRows.map(([grade, count]) => (
              <div key={grade} className="rounded-2xl bg-black/25 px-3 py-3 text-center">
                <div className="text-sm font-black text-zinc-100">{grade}</div>
                <div className="mt-1 text-lg font-black text-zinc-300">{count}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={analyze} disabled={analyzing || candidates.length === 0 || usage.remaining <= 0} loading={analyzing} loadingLabel="분석 중">
            {usage.remaining <= 0 ? '남은 횟수 없음' : `후보 ${candidates.length}개 분석`}
          </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={analyzing || (candidates.length === 0 && results.length === 0)}>초기화</DarkButton>
        </div>
      </PanelCard>
      <PanelCard title="분석 결과">
        {results.length === 0 ? (
          <Notice>후보를 저장하고 후보 분석을 실행하면 결과가 표시돼요.</Notice>
        ) : (
          <div className="grid gap-2">
            {scoredResults.map((item) => (
              <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-zinc-200">{infludexCandidateLabel(item)}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{[item.displayName || item.description, item.category].filter(Boolean).join(' · ') || '카테고리 미입력'}</div>
                  </div>
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black text-zinc-200">{item.grade} · {item.score}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-zinc-500">
                  <span>{item.decision || (Number(item.score || 0) >= 72 ? '추천' : Number(item.score || 0) >= 58 ? '검토' : '추가 확인')}</span>
                  {Number(item.avgReelsViews || item.reelsViews || 0) > 0 && <span>최근 5개 릴스 평균 조회 {Number(item.avgReelsViews || item.reelsViews || 0).toLocaleString('ko-KR')}</span>}
                  {Number(item.recentReelsCount || 0) > 0 && <span>릴스 {Number(item.recentReelsCount).toLocaleString('ko-KR')}개 기준</span>}
                  {item.recentPostAt && <span>최근 활동 확인</span>}
                </div>
                {item.riskFlags?.length > 0 && <div className="mt-2 text-[11px] font-bold text-amber-400">{[...new Set(item.riskFlags.map(infludexRiskLabel))].slice(0, 2).join(' · ')}</div>}
              </div>
            ))}
            {missingResults.length > 0 && (
              <div className="mt-2 rounded-3xl border border-amber-400/20 bg-amber-400/5 p-3">
                <div className="mb-2 text-sm font-black text-amber-200">확인 필요 후보 {missingResults.length}개</div>
                <div className="grid gap-2">
                  {missingResults.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-zinc-200">{infludexCandidateLabel(item)}</div>
                          <div className="mt-0.5 truncate text-xs text-zinc-500">{[item.displayName || item.description, item.category].filter(Boolean).join(' · ') || '설명 보강 필요'}</div>
                        </div>
                        <span className="shrink-0 rounded-full border border-amber-400/20 px-2.5 py-1 text-[11px] font-black text-amber-200">확인 필요</span>
                      </div>
                      {item.contactMemo && <div className="mt-2 text-xs font-bold text-zinc-500">문의 {item.contactMemo}</div>}
                      <div className="mt-2 text-[11px] font-bold text-amber-300">{[...new Set((item.riskFlags || []).map(infludexRiskLabel))].slice(0, 2).join(' · ') || '정보 확인 필요'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </PanelCard>
    </>
  );
}

function InfludexDownloadPanel({ onOpenUpload }) {
  const toast = useToast();
  const [workspace, setWorkspace] = useState({});
  const [showCriteria, setShowCriteria] = useState(false);
  const results = sortInfludexResults(Array.isArray(workspace.infludexResults) ? workspace.infludexResults : []);

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '다운로드 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const downloadCsv = () => {
    const header = ['url', 'handle', 'displayName', 'category', 'grade', 'score', 'decision', 'status', 'followers', 'recent5ReelsAvgLikes', 'recent5ReelsAvgComments', 'recent5ReelsAvgViews', 'recentReelsCount', 'recentReelsMetricSource', 'recentPostAt', 'contactMemo', 'summary'];
    const rows = results.map((item) => [
      item.url,
      item.handle,
      item.displayName || item.description,
      item.category,
      item.grade,
      item.score,
      item.decision || '',
      item.analysisStatus === 'data_missing' || !item.grade ? '확인 필요' : ['S', 'A'].includes(item.grade) ? '추천' : '검토',
      item.followerCount,
      item.avgLikes,
      item.avgComments,
      item.avgReelsViews || item.reelsViews,
      item.recentReelsCount,
      item.recentReelsMetricSource,
      item.recentPostAt,
      item.contactMemo,
      [...new Set((item.riskFlags || []).map(infludexRiskLabel))].slice(0, 2).join(' | ') || (item.gradeReason || item.reasons)?.slice(0, 2).join(' | ') || ''
    ].map(csvEscape).join(','));
    downloadTextFile('infludex-results.csv', `\uFEFF${[header.join(','), ...rows].join('\r\n')}`, 'text/csv;charset=utf-8');
  };

  return (
    <PanelCard title="결과 다운로드">
      <div className="grid gap-2">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setShowCriteria((value) => !value)}
            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-black text-zinc-300 hover:bg-white/5"
          >
            분석 기준
          </button>
        </div>
        {showCriteria && (
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-xs font-bold leading-relaxed text-zinc-400">
            <div className="font-black text-zinc-200">INFLUDEX 주요 기준</div>
            <div className="mt-2 grid gap-1.5">
              <div>반응률 = 평균 좋아요+댓글 / 팔로워</div>
              <div>릴스 조회율 = 최근 5개 릴스 평균 조회수 / 팔로워</div>
              <div>댓글 비중 = 평균 댓글 / 전체 반응</div>
              <div>최근 게시일, 카테고리 적합도, 팔로워 규모를 함께 반영</div>
              <div>대형 계정의 낮은 반응률/조회율, 댓글 부족, 릴스 조회수 누락은 감점 및 등급 상한</div>
            </div>
          </div>
        )}
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
    description: '캠페인 추천, 참여자 선정, 제출물 검수를 한 화면에서 묶어 운영자가 판단할 일만 남겨요. 지금은 무료로 시작할 수 있어요.',
    cta: 'SPREAD 무료로 시작'
  },
  polibot: {
    title: 'POLIBOT',
    subtitle: '보험 보장분석 자동화',
    motto: '보험 상품과 고객 조건을 빠르게 비교해요.',
    description: '고객 프로필과 보장 니즈를 바탕으로 추천 초안과 비교 결과를 정리해요.',
    cta: 'POLIBOT 시작하기'
  },
  infludex: {
    title: 'INFLUDEX',
    subtitle: '인스타그램 인플루언서 분석',
    motto: '카테고리와 반응 지표로 후보를 먼저 걸러요.',
    description: '인스타그램 계정 후보를 S/A/B/C/D 등급으로 정리하고 결과를 다운로드해요.',
    cta: 'INFLUDEX 시작하기'
  },
  sublog: {
    title: 'SUBLOG',
    subtitle: '구독 비용 관리',
    motto: '매달 새는 돈을 한눈에 봐요.',
    description: '매달 결제되는 구독 서비스를 직접 등록하고 월간, 연간, 하루 평균 비용을 정리해요.',
    cta: 'SUBLOG 시작하기'
  },
  auvibot: {
    title: 'AUVIBOT',
    subtitle: '상품 쇼츠 생산 자동화',
    motto: '상품 입력부터 소싱, 컷 조합, 렌더링까지 한 흐름으로 묶어요.',
    description: 'SNS 트렌드 패턴은 분석하고, 실제 영상은 권리 문제가 적은 소스와 자체 클립 라이브러리로 조합하는 쇼츠 제작 워크스페이스예요.',
    cta: 'AUVIBOT 시작하기'
  }
};

const auvibotContent = {
  run: {
    title: '자동화 실행',
    description: '사용자가 상품을 직접 정하지 않아도 랜덤 주제, 상품 후보, 영상 소스, 트렌드 훅을 묶어 쇼츠 작업을 자동으로 생성합니다.',
    items: [
      ['주제 발굴', '차량, 주방, 욕실, 데스크, 뷰티 같은 카테고리와 욕구 시드를 조합합니다.'],
      ['상품 매칭', '쿠팡 상품 검색 결과에서 쇼츠로 만들기 쉬운 후보를 고릅니다.'],
      ['소싱/편집', '상품에 맞는 영상 후보를 찾고 훅, 컷 순서, CTA까지 자동으로 구성합니다.']
    ]
  },
  settings: {
    title: '설정 확인',
    description: '고객은 게시 기준과 영상 스타일만 정하고, 생성/소싱/렌더링 시스템은 JASAIN에서 관리합니다.',
    items: [
      ['상품 API', '쿠팡 파트너스 Access Key, Secret Key, Partner ID, Tracking Code가 필요합니다.'],
      ['영상 소싱 API', 'Pexels, Pixabay 같은 안전한 소싱 API 키를 연결합니다.'],
      ['생성/렌더링', 'OpenAI, TTS, BGM, FFmpeg 렌더 옵션과 저장 위치를 설정합니다.']
    ]
  },
  learning: {
    title: '인기영상 학습',
    description: 'SNS 원본 영상을 복사하지 않고, 잘 되는 영상의 구조만 학습해 AUVIBOT 편집 규칙에 반영합니다.',
    items: [
      ['훅 패턴', '첫 1초에 반응을 만드는 문장 구조와 시선 흐름을 추출합니다.'],
      ['컷 템포', '컷 길이, 자막 위치, CTA 타이밍을 패턴화합니다.'],
      ['리스크 필터', '타인 얼굴, 목소리, 워터마크, 원본 재사용은 기본적으로 제외합니다.']
    ]
  },
  posts: {
    title: '포스팅 현황',
    description: '자동화 실행으로 생성된 쇼츠 작업의 진행 상태를 확인하는 화면입니다.',
    items: [
      ['소싱 완료', '영상 후보가 모였지만 아직 편집안이 확정되지 않은 작업입니다.'],
      ['렌더 대기', '타임라인과 자막이 준비되어 MP4 생성만 남은 작업입니다.'],
      ['업로드 대기', '렌더 결과가 준비되어 Shorts, Reels, TikTok 큐로 보낼 수 있는 작업입니다.']
    ]
  },
  analytics: {
    title: '성과 보기',
    description: 'AUVIBOT이 만든 쇼츠의 생성량, 렌더 성공률, 업로드 후 성과를 보고 다음 자동화 기준을 조정합니다.',
    items: [
      ['생성 성과', '오늘 생성된 작업 수, 렌더 성공률, 실패 사유를 요약합니다.'],
      ['소스 성과', '어떤 카테고리와 영상 소스가 좋은 결과를 냈는지 추적합니다.'],
      ['훅 성과', '조회수와 클릭을 기준으로 다음 훅 생성 규칙에 반영합니다.']
    ]
  }
};

function AuvibotThreadsConnection({ account, reloadAccounts }) {
  const toast = useToast();
  const [connecting, setConnecting] = useState(false);
  const [confirmingThreadsApproval, setConfirmingThreadsApproval] = useState(false);
  const [savingHandle, setSavingHandle] = useState(false);
  const [requestingThreads, setRequestingThreads] = useState(false);
  const [threadsRequests, setThreadsRequests] = useState([]);
  const [requestMemo, setRequestMemo] = useState('');
  const [handleDraft, setHandleDraft] = useState(account?.account_handle || '');
  const [oauthError, setOauthError] = useState(null);
  const [oauthSuccess, setOauthSuccess] = useState(null);
  const connected = Boolean(account?.has_threads_access_token);
  const tokenFailed = account?.threads_token_status === 'refresh_failed';
  const statusText = connected
    ? tokenFailed ? '재연결 필요' : '연결됨'
    : '미연결';
  const statusClass = connected && !tokenFailed ? 'text-emerald-200' : 'text-amber-200';

  useEffect(() => {
    setHandleDraft(account?.account_handle || '');
  }, [account?.id, account?.account_handle]);

  useEffect(() => {
    if (!account?.id || connected) {
      setThreadsRequests([]);
      return;
    }
    api.get(`/api/me/threads-connection-requests?accountId=${account.id}`)
      .then((rows) => setThreadsRequests(Array.isArray(rows) ? rows : []))
      .catch(() => setThreadsRequests([]));
  }, [account?.id, connected]);

  useEffect(() => {
    if (!account?.id) {
      setOauthError(null);
      setOauthSuccess(null);
      return;
    }
    try {
      const rawError = sessionStorage.getItem(`cujasa:threadsOAuthError:${account.id}`);
      const rawSuccess = sessionStorage.getItem(`cujasa:threadsOAuthSuccess:${account.id}`);
      setOauthError(connected ? null : rawError ? JSON.parse(rawError) : null);
      setOauthSuccess(rawSuccess ? JSON.parse(rawSuccess) : null);
    } catch {
      setOauthError(null);
      setOauthSuccess(null);
    }
  }, [account?.id, connected]);

  const activeThreadsRequest = threadsRequests
    .filter((row) => row && !['connected', 'canceled'].includes(row.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null;
  const threadsOAuthReady = connected || activeThreadsRequest?.status === 'customer_action_required';
  const actionLabel = connected
    ? '다시 연결하기'
    : threadsOAuthReady
      ? '승인 후 연결'
      : activeThreadsRequest
        ? '요청 업데이트'
        : '이 핸들로 연결 요청';

  const saveHandle = async () => {
    if (!account?.id) {
      toast('먼저 계정을 추가해 주세요.', 'error');
      return false;
    }
    const nextHandle = String(handleDraft || '').trim();
    if (!nextHandle) {
      toast('Threads 핸들을 입력해 주세요.', 'error');
      return false;
    }
    if (nextHandle === String(account.account_handle || '').trim()) return true;
    setSavingHandle(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, { account_handle: nextHandle });
      await reloadAccounts?.();
      toast('Threads 핸들을 저장했어요.', 'success');
      return true;
    } catch (err) {
      toast(err.message || 'Threads 핸들을 저장하지 못했어요.', 'error');
      return false;
    } finally {
      setSavingHandle(false);
    }
  };

  const requestThreadsRegistration = async () => {
    if (!await saveHandle()) return;
    setRequestingThreads(true);
    try {
      const result = await api.post('/api/me/threads-connection-requests', {
        accountId: account.id,
        threadsHandle: String(handleDraft || '').trim(),
        requestMemo
      });
      setThreadsRequests((prev) => [result.request, ...prev.filter((row) => row.id !== result.request?.id)].filter(Boolean));
      await reloadAccounts?.();
      toast(result.alreadyExists ? '기존 Threads 등록 요청을 업데이트했어요.' : 'Threads 등록 요청을 보냈어요.', 'success');
    } catch (err) {
      toast(err.message || 'Threads 등록 요청을 보내지 못했어요.', 'error');
    } finally {
      setRequestingThreads(false);
    }
  };

  const connectThreads = async () => {
    if (!account?.id) {
      toast('먼저 연결할 계정을 선택해 주세요.', 'error');
      return;
    }
    if (!await saveHandle()) return;
    setConnecting(true);
    try {
      sessionStorage.setItem('cujasa:threadsOAuthReturnAction', 'auvibot-settings');
      sessionStorage.setItem('cujasa:threadsOAuthReturnProduct', 'auvibot');
      const payload = await api.get(`/api/auth/threads/start?accountId=${account.id}`);
      if (payload?.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error('Threads 연결 주소가 없습니다.');
    } catch (err) {
      setOauthError({ message: err.message || 'Threads 연결을 시작하지 못했어요.', code: 'THREADS_OAUTH_START_FAILED', at: new Date().toISOString() });
      toast(err.message || 'Threads 연결을 시작하지 못했어요.', 'error');
      setConnecting(false);
    }
  };

  return (
    <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3" open>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-black text-zinc-100">Threads</div>
            <span className={`rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-black ${statusClass}`}>{statusText}</span>
          </div>
          <ChevronDown size={16} className="shrink-0 text-zinc-500" />
        </div>
      </summary>
      <div className="mt-4 grid gap-3">
        <label className={labelClass}>
          Threads 핸들
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]">
            <input className={inputClass} value={handleDraft} onChange={(event) => setHandleDraft(event.target.value)} placeholder="@myhandle" />
            <DarkButton type="button" variant="ghost" size="sm" className="h-full min-h-11 w-full justify-center whitespace-nowrap px-3" onClick={saveHandle} disabled={savingHandle || !account?.id} loading={savingHandle} loadingLabel="저장 중">
              <CheckCircle2 size={15} />
              저장
            </DarkButton>
          </div>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-black/25 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-zinc-100">{handleDraft || account?.account_handle || 'Threads 핸들 미입력'}</div>
            {account?.threads_connected_at && (
              <div className="mt-1 text-xs text-zinc-500">연결 {dateTime(account.threads_connected_at)}</div>
            )}
          </div>
          <DarkButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={threadsOAuthReady ? () => setConfirmingThreadsApproval(true) : requestThreadsRegistration}
            disabled={connecting || requestingThreads || savingHandle || !account?.id}
            loading={connecting || requestingThreads}
            loadingLabel={connecting ? '이동 중' : '요청 중'}
          >
            <Link2 size={15} />
            {actionLabel}
          </DarkButton>
        </div>
        {!connected && !threadsOAuthReady && (
          <label className={labelClass}>
            운영자에게 보낼 메모
            <input className={inputClass} value={requestMemo} onChange={(event) => setRequestMemo(event.target.value)} placeholder="예: 이 핸들로 연결하고 싶어요" />
          </label>
        )}
        {oauthSuccess?.message && <Notice tone="success">{oauthSuccess.message}</Notice>}
        {oauthError?.message && (
          <Notice tone="error">
            {oauthError.message}{oauthError.code ? ` (${oauthError.code})` : ''}
          </Notice>
        )}
        {!connected && threadsOAuthReady && (
          <Notice>
            Meta 등록이 완료됐습니다. Threads 계정의 웹 승인 화면에서 앱 접근을 승인한 뒤 연결을 마무리해 주세요.
          </Notice>
        )}
        {connected && (
          <DarkButton type="button" variant="ghost" size="sm" onClick={() => reloadAccounts?.()}>
            <RefreshCw size={15} />
            연결 상태 새로고침
          </DarkButton>
        )}
      </div>
      {confirmingThreadsApproval && (
        <ThreadsWebApprovalModal
          account={account}
          connecting={connecting}
          onCancel={() => setConfirmingThreadsApproval(false)}
          onConfirm={() => {
            setConfirmingThreadsApproval(false);
            connectThreads();
          }}
        />
      )}
    </details>
  );
}

function ThreadsWebApprovalModal({ account, connecting, onCancel, onConfirm }) {
  const handle = account?.account_handle || '연결할 Threads 핸들';
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-5">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        <div className="text-lg font-black text-zinc-50">Threads 웹 승인 확인</div>
        <div className="mt-3 grid gap-3 text-sm leading-relaxed text-zinc-300">
          <p>
            관리자가 Meta 개발자센터에 계정을 등록한 뒤에도, <strong className="text-zinc-50">Threads 계정의 웹 승인</strong>을 먼저 눌러야 연결이 완료됩니다.
          </p>
          <div className="grid gap-2 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-xs font-bold leading-relaxed text-amber-100">
            <div>1. Chrome/Safari에서 threads.net에 {handle}로 로그인</div>
            <div>2. 웹 Threads에서 계정 탭 → 웹 승인 → CUJASA Threads 수락</div>
            <div>3. 승인 후 이 화면으로 돌아와 연결 진행</div>
          </div>
          <p className="text-xs text-zinc-500">
            Threads 앱만 로그인되어 있으면 실패할 수 있습니다. 다른 계정이 뜨면 브라우저에서 로그아웃한 뒤 올바른 계정으로 다시 로그인해 주세요.
          </p>
        </div>
        <div className="mt-5 flex gap-2">
          <DarkButton type="button" variant="ghost" className="flex-1 justify-center" onClick={onCancel} disabled={connecting}>
            취소
          </DarkButton>
          <DarkButton type="button" className="flex-1 justify-center" onClick={onConfirm} disabled={connecting} loading={connecting} loadingLabel="이동 중">
            승인 확인 후 연결
          </DarkButton>
        </div>
      </div>
    </div>
  );
}

function AuvibotAccountSetup({ account, accountCreation }) {
  return (
    <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3" open={!account?.id}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-sm font-black text-zinc-100">사용할 Threads 채널</div>
            <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-black text-zinc-500">
              {accountCreation?.count ?? 0}/{accountCreation?.maxAccounts ?? 2}
            </span>
          </div>
          <ChevronDown size={16} className="shrink-0 text-zinc-500" />
        </div>
      </summary>
      <div className="mt-4 grid gap-3">
        {account?.id && (
          <div className="rounded-2xl bg-black/25 px-4 py-3">
            <div className="text-sm font-black text-zinc-100">{account.name || '선택된 계정'}</div>
            <div className="mt-1 text-xs text-zinc-500">{account.account_handle || 'Threads 핸들 미입력'}</div>
            <div className="mt-2 text-xs leading-relaxed text-zinc-600">
              CUJASA에서 이미 쓰는 채널이면 AUVIBOT도 같은 Threads 연결을 공유합니다.
            </div>
          </div>
        )}
        {accountCreation?.show ? (
          <BetaAccountAddForm accountCreation={accountCreation} />
        ) : (
          <DarkButton type="button" variant="ghost" size="sm" onClick={accountCreation?.open} disabled={!accountCreation?.canAdd || accountCreation?.adding} loading={accountCreation?.adding} loadingLabel="추가 중">
            <Plus size={15} />
            새 채널 추가
          </DarkButton>
        )}
        {!accountCreation?.canAdd && (
          <Notice>
            계정 한도에 도달했습니다. 추가 계정이 필요하면 요금제 또는 관리자 설정을 확인해야 합니다.
          </Notice>
        )}
      </div>
    </details>
  );
}

const auvibotSettingsDefaults = {
  dailyCount: '3',
  uploadTime: '09:00',
  autoPublish: 'review',
  categories: '차량, 주방, 데스크',
  excludedCategories: '의료, 금융, 민감 이슈',
  captionStyle: 'bold',
  voiceStyle: 'natural',
  bgmStyle: 'bright',
  sourceMode: 'safe',
  trendIntensity: 'balanced',
  forbiddenKeywords: ''
};

function auvibotSettingsKey(accountId = '') {
  return `jasain:auvibot:settings:${accountId || 'default'}`;
}

function AuvibotCustomerSettings({ account, reloadAccounts }) {
  const toast = useToast();
  const [settings, setSettings] = useState(() => {
    try {
      return { ...auvibotSettingsDefaults, ...JSON.parse(localStorage.getItem(auvibotSettingsKey(account?.id)) || '{}') };
    } catch {
      return auvibotSettingsDefaults;
    }
  });
  const [coupang, setCoupang] = useState({
    coupang_access_key: '',
    coupang_secret_key: '',
    coupang_partner_id: '',
    coupang_tracking_code: ''
  });
  const [saving, setSaving] = useState(false);
  const [requestingSetup, setRequestingSetup] = useState(false);

  useEffect(() => {
    try {
      setSettings({ ...auvibotSettingsDefaults, ...JSON.parse(localStorage.getItem(auvibotSettingsKey(account?.id)) || '{}') });
    } catch {
      setSettings(auvibotSettingsDefaults);
    }
  }, [account?.id]);

  const update = (key, value) => setSettings((prev) => ({ ...prev, [key]: value }));
  const updateCoupang = (key, value) => setCoupang((prev) => ({ ...prev, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      localStorage.setItem(auvibotSettingsKey(account?.id), JSON.stringify(settings));
      if (account?.id) {
        await api.patch(`/api/accounts/${account.id}`, {
          coupang_access_key: coupang.coupang_access_key,
          coupang_secret_key: coupang.coupang_secret_key,
          coupang_partner_id: coupang.coupang_partner_id,
          coupang_tracking_code: coupang.coupang_tracking_code
        });
        setCoupang({
          coupang_access_key: '',
          coupang_secret_key: '',
          coupang_partner_id: '',
          coupang_tracking_code: ''
        });
        await reloadAccounts?.();
      }
      toast('AUVIBOT 설정을 저장했어요.', 'success');
    } catch (err) {
      toast(err.message || '설정을 저장하지 못했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };
  const requestSetup = async () => {
    setRequestingSetup(true);
    try {
      await api.post('/api/me/setup-request', {
        accountId: account?.id || null,
        message: 'AUVIBOT 상품/수익화 및 시스템 설정 확인 요청'
      });
      toast('관리자에게 셋업 요청을 보냈어요.', 'success');
    } catch (err) {
      toast(err.message || '셋업 요청을 보내지 못했어요.', 'error');
    } finally {
      setRequestingSetup(false);
    }
  };

  return (
    <div className="grid gap-3">
      <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3" open>
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-zinc-100">게시 설정</div>
            <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          </div>
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            하루 게시 수
            <select className={inputClass} value={settings.dailyCount} onChange={(event) => update('dailyCount', event.target.value)}>
              <option value="1">1개</option>
              <option value="3">3개</option>
              <option value="5">5개</option>
            </select>
          </label>
          <label className={labelClass}>
            첫 게시 시간
            <input className={inputClass} type="time" value={settings.uploadTime} onChange={(event) => update('uploadTime', event.target.value)} />
          </label>
          <label className={labelClass}>
            게시 방식
            <select className={inputClass} value={settings.autoPublish} onChange={(event) => update('autoPublish', event.target.value)}>
              <option value="review">검수 후 게시</option>
              <option value="auto">자동 게시</option>
              <option value="draft">초안만 생성</option>
            </select>
          </label>
          <label className={labelClass}>
            트렌드 반영
            <select className={inputClass} value={settings.trendIntensity} onChange={(event) => update('trendIntensity', event.target.value)}>
              <option value="safe">낮게</option>
              <option value="balanced">보통</option>
              <option value="aggressive">높게</option>
            </select>
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3" open>
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-black text-zinc-100">쿠팡 파트너스</div>
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-black text-zinc-500">
                {account?.has_coupang_access_key && account?.has_coupang_secret_key ? '저장됨' : '필요'}
              </span>
            </div>
            <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          </div>
        </summary>
        <div className="mt-4 grid gap-3">
          <label className={labelClass}>
            Access Key
            <input className={inputClass} value={coupang.coupang_access_key} onChange={(event) => updateCoupang('coupang_access_key', event.target.value)} placeholder={account?.has_coupang_access_key ? '저장됨 - 변경 시에만 입력' : 'Access Key'} />
          </label>
          <label className={labelClass}>
            Secret Key
            <input className={inputClass} type="password" value={coupang.coupang_secret_key} onChange={(event) => updateCoupang('coupang_secret_key', event.target.value)} placeholder={account?.has_coupang_secret_key ? '저장됨 - 변경 시에만 입력' : 'Secret Key'} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Partner ID
              <input className={inputClass} value={coupang.coupang_partner_id} onChange={(event) => updateCoupang('coupang_partner_id', event.target.value)} placeholder={account?.has_coupang_partner_id ? '저장됨 - 변경 시에만 입력' : 'Partner ID'} />
            </label>
            <label className={labelClass}>
              Tracking Code
              <input className={inputClass} value={coupang.coupang_tracking_code} onChange={(event) => updateCoupang('coupang_tracking_code', event.target.value)} placeholder={account?.has_coupang_tracking_code ? '저장됨 - 변경 시에만 입력' : 'Tracking Code'} />
            </label>
          </div>
        </div>
      </details>

      <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-zinc-100">상품/소싱 기준</div>
            <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          </div>
        </summary>
        <div className="mt-4 grid gap-3">
          <label className={labelClass}>
            우선 카테고리
            <input className={inputClass} value={settings.categories} onChange={(event) => update('categories', event.target.value)} />
          </label>
          <label className={labelClass}>
            제외 카테고리
            <input className={inputClass} value={settings.excludedCategories} onChange={(event) => update('excludedCategories', event.target.value)} />
          </label>
          <label className={labelClass}>
            금지 키워드
            <textarea className={`${inputClass} min-h-24 resize-none`} value={settings.forbiddenKeywords} onChange={(event) => update('forbiddenKeywords', event.target.value)} placeholder="한 줄에 하나씩 입력" />
          </label>
          <label className={labelClass}>
            소싱 기준
            <select className={inputClass} value={settings.sourceMode} onChange={(event) => update('sourceMode', event.target.value)}>
              <option value="safe">안전 소스 우선</option>
              <option value="product">상품 적합도 우선</option>
              <option value="trend">트렌드 적합도 우선</option>
            </select>
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-black text-zinc-100">영상 스타일</div>
            <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          </div>
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            자막
            <select className={inputClass} value={settings.captionStyle} onChange={(event) => update('captionStyle', event.target.value)}>
              <option value="bold">크고 선명하게</option>
              <option value="minimal">깔끔하게</option>
              <option value="dynamic">움직임 있게</option>
            </select>
          </label>
          <label className={labelClass}>
            음성
            <select className={inputClass} value={settings.voiceStyle} onChange={(event) => update('voiceStyle', event.target.value)}>
              <option value="natural">자연스럽게</option>
              <option value="bright">밝게</option>
              <option value="none">음성 없음</option>
            </select>
          </label>
          <label className={labelClass}>
            BGM
            <select className={inputClass} value={settings.bgmStyle} onChange={(event) => update('bgmStyle', event.target.value)}>
              <option value="bright">밝은 분위기</option>
              <option value="calm">차분한 분위기</option>
              <option value="none">BGM 없음</option>
            </select>
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="text-sm font-black text-zinc-100">JASAIN 관리 설정</div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black text-emerald-200">관리 중</span>
            </div>
            <ChevronDown size={16} className="shrink-0 text-zinc-500" />
          </div>
        </summary>
        <div className="mt-4 grid gap-2">
          {['AI 생성', '영상 소싱', '음성', '렌더링', '저장소'].map((item) => (
            <div key={item} className="flex items-center justify-between rounded-2xl bg-black/25 px-4 py-3">
              <span className="text-sm font-bold text-zinc-300">{item}</span>
              <span className="text-xs font-black text-zinc-500">JASAIN 설정</span>
            </div>
          ))}
          <DarkButton type="button" variant="ghost" size="sm" onClick={requestSetup} disabled={requestingSetup} loading={requestingSetup} loadingLabel="요청 중">
            <Settings size={15} />
            관리자 셋업 요청
          </DarkButton>
        </div>
      </details>

      <DarkButton type="button" onClick={save} disabled={saving} loading={saving} loadingLabel="저장 중">
        <CheckCircle2 size={16} />
        설정 저장
      </DarkButton>
    </div>
  );
}

function AuvibotPanel({ mode = 'run', account, reloadAccounts, accountCreation, reloadCurrentUser, onOpenAction }) {
  const content = auvibotContent[mode] || auvibotContent.run;
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const [workspace, setWorkspace] = useState(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);

  const loadWorkspace = useCallback(async () => {
    setLoadingWorkspace(true);
    try {
      setWorkspace(await api.get('/api/product-workspace/auvibot'));
    } catch (error) {
      setWorkspace(null);
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'settings') return;
    loadWorkspace();
  }, [loadWorkspace, mode]);

  const runAuvibot = async () => {
    setRunning(true);
    try {
      await api.post('/api/product-workspace/auvibot/run', {
        accountId: account?.id || null,
        count: 5,
        sourceMode: 'mixed',
        quality: 'conversion',
        category: '전체'
      });
      toast('AUVIBOT 자동화를 시작했어요.', 'success');
      await loadWorkspace();
    } catch (err) {
      toast(err.message || 'AUVIBOT 자동화를 시작하지 못했어요. 설정 확인에서 셋업 상태를 먼저 확인해 주세요.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const jobs = Array.isArray(workspace?.jobs) ? workspace.jobs : [];
  const jobCounts = jobs.reduce((acc, job) => {
    const status = job.status || 'queued';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return (
    <PanelCard className="self-start">
      <div className="text-xs font-black uppercase tracking-wide text-zinc-500">AUVIBOT</div>
      <h2 className="mt-3 text-2xl font-black text-zinc-100">{content.title}</h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-500">{content.description}</p>
      {mode === 'run' && (
        <div className="mt-5 grid gap-3">
          <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-white/10 p-3 text-zinc-100">
                <PlayCircle size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-black text-zinc-100">자동화 중지됨</div>
                <p className="mt-1 text-sm leading-relaxed text-zinc-500">
                  자동화를 시작하면 영상 소싱, 상품 매칭, 편집 작업 큐를 생성해요.
                </p>
                <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-400">
                  <span className="font-black text-zinc-100">{account?.name || '계정 없음'}</span>
                  {account?.account_handle && <span className="ml-2 text-zinc-600">{account.account_handle}</span>}
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-black/25 p-4">
            <div className="text-sm font-black text-zinc-100">사전 점검</div>
            <Notice>설정 확인에서 Threads, 쿠팡 API, 영상 스타일을 먼저 저장하면 자동화 실행이 가능합니다.</Notice>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <DarkButton type="button" variant="ghost" onClick={() => onOpenAction?.('auvibot-settings')}>
                설정 확인
              </DarkButton>
              <DarkButton type="button" onClick={runAuvibot} disabled={running} loading={running} loadingLabel="처리 중">
                자동화 시작
              </DarkButton>
            </div>
          </div>
        </div>
      )}
      {mode === 'settings' && (
        <div className="mt-5 grid gap-3">
          <AuvibotOnboardingChecklist account={account} />
          <Notice>
            영상 소싱, 음성, 렌더링 키는 JASAIN 관리 설정에서 운영합니다. 고객은 Threads와 쿠팡 정보만 확인하면 됩니다.
          </Notice>
          <AuvibotAccountSetup account={account} accountCreation={accountCreation} />
          <AuvibotThreadsConnection account={account} reloadAccounts={reloadAccounts} />
          <AuvibotCustomerSettings account={account} reloadAccounts={reloadAccounts} />
        </div>
      )}
      {mode !== 'settings' && (
        <div className="mt-5 grid gap-3">
          {mode === 'posts' && (
            <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-black text-zinc-100">작업 큐</div>
                <button type="button" onClick={loadWorkspace} className="grid h-8 w-8 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100" aria-label="새로고침">
                  <RefreshCw size={15} className={loadingWorkspace ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="mt-3 grid gap-2">
                {jobs.length === 0 && <div className="rounded-2xl bg-black/20 px-4 py-3 text-xs font-bold text-zinc-500">아직 접수된 작업이 없어요.</div>}
                {jobs.slice(0, 10).map((job) => (
                  <div key={job.id} className="flex items-center justify-between gap-3 rounded-2xl bg-black/20 px-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-zinc-200">{job.title || '자동 주제 쇼츠'}</div>
                      <div className="mt-1 truncate text-xs text-zinc-500">{job.category || '전체'} · {job.sourceMode || 'mixed'} · {dateTime(job.createdAt)}</div>
                    </div>
                    <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black uppercase text-zinc-400">
                      {job.status || 'queued'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mode === 'analytics' && (
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['대기', jobCounts.queued || 0],
                ['진행', jobCounts.running || 0],
                ['완료', jobCounts.done || jobCounts.completed || 0]
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
                  <div className="text-xs font-black text-zinc-500">{label}</div>
                  <div className="mt-2 text-2xl font-black text-zinc-100">{value}</div>
                </div>
              ))}
            </div>
          )}
          {content.items.map(([title, description]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
              <div className="text-sm font-black text-zinc-100">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</div>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  );
}

function AuvibotOnboardingChecklist({ account }) {
  const hasThreads = Boolean(account?.has_threads_access_token);
  const hasCoupang = Boolean(account?.has_coupang_access_key && account?.has_coupang_secret_key && account?.has_coupang_partner_id);
  const steps = [
    { key: 'threads', label: 'Threads 연결', done: hasThreads, meta: hasThreads ? '연결됨' : '필요' },
    { key: 'coupang', label: '쿠팡 API', done: hasCoupang, meta: hasCoupang ? '저장됨' : '필요' },
    { key: 'system', label: '영상 소싱/렌더 키', done: true, meta: 'JASAIN 관리' },
    { key: 'review', label: '테스트 영상 검수', done: false, meta: '셋업 후 진행' }
  ];

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {steps.map((step, index) => (
        <div key={step.key} className={`rounded-2xl border px-4 py-3 ${step.done ? 'border-emerald-400/15 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03]'}`}>
          <div className="flex items-center gap-2">
            {step.done ? <CheckCircle2 size={15} className="text-emerald-300" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-white/[0.06] text-[10px] font-black text-zinc-400">{index + 1}</span>}
            <span className="text-sm font-black text-zinc-100">{step.label}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">{step.meta}</div>
        </div>
      ))}
    </div>
  );
}

const sublogStorageKeyPrefix = 'jasain_sublog_subscriptions_v1';
const sublogCategories = ['전체', 'AI', '영상', '음악', '생산성', '클라우드', '기타'];
const sublogPresets = [
  { name: 'ChatGPT Plus', amount: 20, currency: 'USD', category: 'AI' },
  { name: 'Claude Pro', amount: 20, currency: 'USD', category: 'AI' },
  { name: 'Cursor', amount: 20, currency: 'USD', category: 'AI' },
  { name: 'Netflix', amount: 17000, currency: 'KRW', category: '영상' },
  { name: 'YouTube Premium', amount: 14900, currency: 'KRW', category: '영상' },
  { name: 'Spotify', amount: 10900, currency: 'KRW', category: '음악' },
  { name: 'Notion', amount: 10, currency: 'USD', category: '생산성' },
  { name: 'iCloud+', amount: 1100, currency: 'KRW', category: '클라우드' }
];

function sublogToKrw(item = {}) {
  return Number(item.amount || 0) * (item.currency === 'USD' ? 1350 : 1);
}

function sublogMoney(value = 0) {
  return `${Math.round(Number(value) || 0).toLocaleString('ko-KR')}원`;
}

function sublogDisplayAmount(item = {}) {
  const amount = Number(item.amount || 0);
  return item.currency === 'USD' ? `$${amount.toLocaleString('en-US')}` : sublogMoney(amount);
}

function sublogDaysUntil(day, today = new Date()) {
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  const candidate = new Date(base.getFullYear(), base.getMonth(), Math.min(Number(day) || 1, new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()));
  if (candidate >= base) return Math.round((candidate - base) / 86400000);
  const next = new Date(base.getFullYear(), base.getMonth() + 1, Math.min(Number(day) || 1, new Date(base.getFullYear(), base.getMonth() + 2, 0).getDate()));
  return Math.round((next - base) / 86400000);
}

function SublogPanel({ currentUser }) {
  const toast = useToast();
  const accountStorageKey = useMemo(() => {
    const accountKey = String(currentUser?.email || currentUser?.userId || 'unknown').trim().toLowerCase() || 'unknown';
    return `${sublogStorageKeyPrefix}:${accountKey}`;
  }, [currentUser?.email, currentUser?.userId]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('전체');
  const [sort, setSort] = useState('recent');
  const [activeTab, setActiveTab] = useState('subscriptions');
  const [editingId, setEditingId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', currency: 'KRW', billingDay: 1, category: '기타', memo: '' });
  const [reminderDays, setReminderDays] = useState(() => {
    const saved = Number(localStorage.getItem(`${accountStorageKey}:reminder_days`));
    return Number.isFinite(saved) && saved >= 0 ? saved : 3;
  });
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return window.Notification.permission;
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.get('/api/product-workspace/sublog/subscriptions');
      const serverItems = payload.items || [];
      const migrationKey = `${accountStorageKey}:server_migrated`;
      const localItems = (() => {
        try {
          return JSON.parse(localStorage.getItem(accountStorageKey) || '[]');
        } catch {
          return [];
        }
      })();
      if (serverItems.length === 0 && localItems.length > 0 && localStorage.getItem(migrationKey) !== '1') {
        const migrated = [];
        for (const item of localItems.slice(0, 50)) {
          const result = await api.post('/api/product-workspace/sublog/subscriptions', item);
          if (result?.item) migrated.push(result.item);
        }
        localStorage.setItem(migrationKey, '1');
        setItems(migrated);
      } else {
        setItems(serverItems);
      }
    } catch (err) {
      toast(err.message || 'SUBLOG 구독 목록을 불러오지 못했어요.', 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accountStorageKey, toast]);

  useEffect(() => {
    const savedReminderDays = Number(localStorage.getItem(`${accountStorageKey}:reminder_days`));
    setReminderDays(Number.isFinite(savedReminderDays) && savedReminderDays >= 0 ? savedReminderDays : 3);
    loadItems();
  }, [accountStorageKey, loadItems]);

  useEffect(() => {
    localStorage.setItem(`${accountStorageKey}:reminder_days`, String(reminderDays));
  }, [accountStorageKey, reminderDays]);

  const totals = useMemo(() => {
    const monthly = items.reduce((sum, item) => sum + sublogToKrw(item), 0);
    return { monthly, yearly: monthly * 12, daily: monthly / 30, count: items.length };
  }, [items]);
  const nearest = useMemo(() => [...items].sort((a, b) => sublogDaysUntil(a.billingDay) - sublogDaysUntil(b.billingDay))[0] || null, [items]);
  const upcomingReminders = useMemo(() => items
    .map((item) => ({ ...item, daysUntil: sublogDaysUntil(item.billingDay) }))
    .filter((item) => item.daysUntil <= Number(reminderDays))
    .sort((a, b) => a.daysUntil - b.daysUntil), [items, reminderDays]);
  const visible = useMemo(() => {
    const rows = filter === '전체' ? items : items.filter((item) => item.category === filter);
    return [...rows].sort((a, b) => {
      if (sort === 'amount-desc') return sublogToKrw(b) - sublogToKrw(a);
      if (sort === 'amount-asc') return sublogToKrw(a) - sublogToKrw(b);
      if (sort === 'billing-soon') return sublogDaysUntil(a.billingDay) - sublogDaysUntil(b.billingDay);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }, [filter, items, sort]);

  const resetForm = () => {
    setEditingId('');
    setForm({ name: '', amount: '', currency: 'KRW', billingDay: 1, category: '기타', memo: '' });
  };
  const openAddForm = () => {
    resetForm();
    setFormOpen(true);
  };
  const closeForm = () => {
    resetForm();
    setFormOpen(false);
  };
  const save = async (event) => {
    event.preventDefault();
    const amount = Number(String(form.amount).replace(/,/g, ''));
    const name = form.name.trim();
    if (!name || !Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    try {
      const payload = { ...form, id: editingId || undefined, name, amount, billingDay: Math.min(31, Math.max(1, Number(form.billingDay) || 1)), memo: form.memo.trim() };
      const result = await api.post('/api/product-workspace/sublog/subscriptions', payload);
      if (result?.item) {
        setItems((current) => editingId
          ? current.map((item) => item.id === editingId ? result.item : item)
          : [result.item, ...current]);
      }
      closeForm();
    } catch (err) {
      toast(err.message || '구독을 저장하지 못했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };
  const edit = (item) => {
    setEditingId(item.id);
    setForm({ name: item.name, amount: String(item.amount), currency: item.currency, billingDay: item.billingDay, category: item.category, memo: item.memo || '' });
    setFormOpen(true);
  };
  const remove = async (item) => {
    if (!window.confirm(`${item.name} 구독을 삭제할까요?`)) return;
    try {
      await api.delete(`/api/product-workspace/sublog/subscriptions/${encodeURIComponent(item.id)}`);
      setItems((current) => current.filter((row) => row.id !== item.id));
    } catch (err) {
      toast(err.message || '구독을 삭제하지 못했어요.', 'error');
    }
  };
  const applyPreset = (preset) => setForm({ ...form, ...preset, amount: String(preset.amount), billingDay: form.billingDay || 1, memo: '' });
  const addSample = async () => {
    setSaving(true);
    try {
      const samples = [
        { name: 'ChatGPT Plus', amount: 20, currency: 'USD', billingDay: 12, category: 'AI', memo: '업무 보조' },
        { name: 'YouTube Premium', amount: 14900, currency: 'KRW', billingDay: 21, category: '영상', memo: '광고 없이 보기' }
      ];
      const saved = [];
      for (const sample of samples) {
        const result = await api.post('/api/product-workspace/sublog/subscriptions', sample);
        if (result?.item) saved.push(result.item);
      }
      setItems((current) => [...saved, ...current]);
    } catch (err) {
      toast(err.message || '예시 구독을 추가하지 못했어요.', 'error');
    } finally {
      setSaving(false);
    }
  };
  const requestBrowserNotification = async () => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }
    const next = await window.Notification.requestPermission();
    setNotificationPermission(next);
  };

  useEffect(() => {
    if (notificationPermission !== 'granted' || upcomingReminders.length === 0) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const notificationKey = `${accountStorageKey}:notification_sent:${todayKey}`;
    if (localStorage.getItem(notificationKey) === '1') return;
    const body = upcomingReminders
      .slice(0, 3)
      .map((item) => `${item.daysUntil === 0 ? '오늘' : `${item.daysUntil}일 뒤`} ${item.name} · ${sublogDisplayAmount(item)}`)
      .join('\n');
    try {
      new window.Notification('SUBLOG 결제 알림', { body });
      localStorage.setItem(notificationKey, '1');
    } catch {
      // Some mobile browsers block notifications unless the web app is installed.
    }
  }, [accountStorageKey, notificationPermission, upcomingReminders]);

  return (
    <div className="grid gap-3">
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-zinc-500">SUBLOG</div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-zinc-100">매달 새는 돈을 한눈에.</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-500">구독비와 다음 결제일만 빠르게 정리해요.</p>
          </div>
          {activeTab === 'subscriptions' && (
            <button type="button" onClick={openAddForm} className="shrink-0 rounded-2xl bg-white px-3 py-2 text-xs font-black text-zinc-950 hover:bg-zinc-100">
              구독 추가
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-black/25 p-1">
        {[
          ['subscriptions', '구독'],
          ['settings', '설정']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`rounded-xl px-3 py-2 text-sm font-black transition ${activeTab === key ? 'bg-white text-zinc-950' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-bold text-zinc-500">
          구독 목록을 불러오는 중이에요.
        </div>
      )}

      {activeTab === 'subscriptions' && (
        <>
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="text-xs font-bold text-zinc-500">이번 달 구독비</div>
            <div className="mt-1 text-3xl font-black text-zinc-100">{sublogMoney(totals.monthly)}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              {[
                ['하루 평균', sublogMoney(totals.daily)],
                ['연간 예상', sublogMoney(totals.yearly)],
                ['구독 수', `${totals.count}개`]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-white/[0.04] px-3 py-2">
                  <div className="font-bold text-zinc-600">{label}</div>
                  <div className="mt-0.5 truncate font-black text-zinc-300">{value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            {nearest ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-zinc-500">다음 결제</div>
                  <div className="mt-1 truncate text-sm font-black text-zinc-100">{nearest.name}</div>
                  <div className="mt-0.5 text-xs font-bold text-zinc-500">매월 {nearest.billingDay}일 · {sublogDisplayAmount(nearest)}</div>
                </div>
                <div className="shrink-0 rounded-2xl bg-white px-3 py-2 text-center text-zinc-950">
                  <div className="text-[10px] font-black text-zinc-500">남은 기간</div>
                  <div className="text-sm font-black">{sublogDaysUntil(nearest.billingDay) === 0 ? '오늘' : `D-${sublogDaysUntil(nearest.billingDay)}`}</div>
                </div>
              </div>
            ) : (
              <div className="text-sm font-bold text-zinc-500">첫 구독을 추가하면 다음 결제 예정일을 보여드릴게요.</div>
            )}
          </div>
        </>
      )}

      {activeTab === 'settings' && <PanelCard title="결제 알림">
        <div className="grid gap-3">
          <div className="grid gap-2">
            <div className="text-xs font-bold text-zinc-500">알림 기준</div>
            <select className={inputClass} value={reminderDays} onChange={(e) => setReminderDays(Number(e.target.value))}>
              <option value={0}>결제 당일</option>
              <option value={1}>1일 전부터</option>
              <option value={3}>3일 전부터</option>
              <option value={7}>7일 전부터</option>
            </select>
          </div>
          {upcomingReminders.length > 0 ? (
            <div className="grid gap-2">
              {upcomingReminders.slice(0, 4).map((item) => (
                <div key={`reminder-${item.id}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm">
                  <div className="font-black text-zinc-100">
                    {item.daysUntil === 0 ? '오늘 결제 예정' : `${item.daysUntil}일 뒤 결제 예정`}
                  </div>
                  <div className="mt-1 text-xs font-bold text-zinc-500">{item.name} · {sublogDisplayAmount(item)} · 매월 {item.billingDay}일</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-500">선택한 기간 안에 결제 예정인 구독이 없습니다.</div>
          )}
          {notificationPermission === 'unsupported' ? (
            <Notice>이 브라우저에서는 알림 권한을 지원하지 않아요. SUBLOG 안의 결제 예정 목록으로 확인해 주세요.</Notice>
          ) : notificationPermission === 'granted' ? (
            <Notice tone="success">브라우저 알림이 켜져 있어요. SUBLOG를 열었을 때 결제 예정 알림을 보여드릴게요.</Notice>
          ) : (
            <DarkButton type="button" variant="ghost" onClick={requestBrowserNotification}>브라우저 알림 켜기</DarkButton>
          )}
        </div>
      </PanelCard>}

      {activeTab === 'subscriptions' && <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-zinc-100">구독 목록</div>
            <div className="text-xs font-bold text-zinc-600">{visible.length}개 표시 중</div>
          </div>
          <select className="w-36 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs font-black text-zinc-300 outline-none focus:border-white/25" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">최근 추가 순</option>
            <option value="amount-desc">금액 높은 순</option>
            <option value="amount-asc">금액 낮은 순</option>
            <option value="billing-soon">결제일 가까운 순</option>
          </select>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {sublogCategories.map((category) => (
            <button key={category} type="button" onClick={() => setFilter(category)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black ${filter === category ? 'border-white/30 bg-white text-zinc-950' : 'border-white/10 text-zinc-500 hover:bg-white/5'}`}>
              {category}
            </button>
          ))}
        </div>
      </div>}

      {activeTab === 'subscriptions' && (items.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/25 px-4 py-5 text-center">
          <div className="text-sm font-black text-zinc-100">아직 등록된 구독이 없습니다.</div>
          <p className="mt-1 text-sm text-zinc-500">가장 자주 쓰는 서비스부터 하나씩 추가해보세요.</p>
          <div className="mt-4 flex justify-center gap-2">
            <DarkButton type="button" onClick={openAddForm}>구독 추가</DarkButton>
            <DarkButton type="button" variant="ghost" onClick={addSample} disabled={saving}>예시로 보기</DarkButton>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          {visible.map((item) => (
            <div key={item.id} className="rounded-2xl border border-white/10 bg-black/25 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate font-black text-zinc-100">{item.name}</div>
                    <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-black text-zinc-500">{item.category}</span>
                  </div>
                  <div className="mt-1 text-xs font-bold text-zinc-500">매월 {item.billingDay}일 · {sublogDisplayAmount(item)} · {sublogDaysUntil(item.billingDay) === 0 ? '오늘' : `D-${sublogDaysUntil(item.billingDay)}`}</div>
                  {item.memo && <div className="mt-1 truncate text-xs text-zinc-600">{item.memo}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => edit(item)} className="rounded-full px-2 py-1 text-xs font-black text-zinc-400 hover:bg-white/10 hover:text-white">수정</button>
                  <button type="button" onClick={() => remove(item)} disabled={saving} className="rounded-full px-2 py-1 text-xs font-black text-zinc-500 hover:bg-white/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50">삭제</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm lg:absolute lg:inset-0 lg:rounded-[28px]">
          <button type="button" aria-label="닫기" className="absolute inset-0" onClick={closeForm} />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-[28px] border-t border-white/10 bg-[#191919] p-4 shadow-2xl shadow-black/60 lg:inset-x-3 lg:bottom-3 lg:rounded-[24px] lg:border">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-zinc-100">{editingId ? '구독 정보 수정' : '새 구독 추가'}</div>
                <div className="mt-1 text-xs leading-relaxed text-zinc-500">월 결제 금액과 결제일만 입력하면 비용을 자동으로 계산해요.</div>
              </div>
              <button type="button" onClick={closeForm} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {sublogPresets.map((preset) => (
                <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-black text-zinc-300 hover:bg-white/10">
                  {preset.name}
                </button>
              ))}
            </div>
            <form onSubmit={save} className="grid gap-3">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="서비스 이름 예: Netflix" autoFocus />
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="매달 결제 금액" />
                <select className={inputClass} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option>KRW</option>
                  <option>USD</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className={inputClass} type="number" min="1" max="31" value={form.billingDay} onChange={(e) => setForm({ ...form, billingDay: e.target.value })} placeholder="결제일" />
                <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {sublogCategories.filter((item) => item !== '전체').map((category) => <option key={category}>{category}</option>)}
                </select>
              </div>
              <textarea className={`${inputClass} min-h-[74px]`} value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="메모 예: 가족 공유, 해지 예정, 업무용" />
              <div className="grid grid-cols-2 gap-2">
                <DarkButton type="button" variant="ghost" onClick={closeForm}>취소</DarkButton>
                <DarkButton type="submit" disabled={saving} loading={saving} loadingLabel="저장 중">{editingId ? '저장하기' : '구독 추가'}</DarkButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductPreview({ action, onStartProduct, starting }) {
  const product = productPreviewContent[action.key] || productPreviewContent.dexor;
  const configuredProduct = productById(action.key);
  const preparing = configuredProduct?.status === 'preparing' || isProductInMaintenance(configuredProduct || { id: action.key });
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
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {starting && <RefreshCw size={16} className="shrink-0 animate-spin" />}
        {preparing ? '서비스 준비중' : starting ? '시작하는 중' : product.cta}
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

const ENGAGEMENT_PATTERN_LABELS = {
  choice_tension: '선택 갈림형',
  experience_question: '경험 질문형',
  regret_prevention: '후회 방지형',
  empathy_prompt: '공감 질문형'
};

function EngagementQualityMeta({ post, compact = false }) {
  const metadata = post?.metadata || {};
  if (!metadata.engagementScore) return null;
  const patternLabel = ENGAGEMENT_PATTERN_LABELS[metadata.engagementPattern] || metadata.engagementPattern || '패턴 미분류';
  const reasons = Array.isArray(metadata.selectionReasons) ? metadata.selectionReasons.slice(0, compact ? 2 : 3) : [];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
      <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-black text-emerald-300">
        댓글 유도 {metadata.engagementScore}점
      </span>
      <span className="rounded-full bg-white/5 px-2.5 py-1 font-bold text-zinc-400">{patternLabel}</span>
      {reasons.map((reason) => (
        <span key={reason} className="rounded-full bg-white/5 px-2.5 py-1 font-bold text-zinc-500">{reason}</span>
      ))}
    </div>
  );
}

function CandidateScoreSummary({ post }) {
  const scores = Array.isArray(post?.metadata?.candidateScores) ? post.metadata.candidateScores : [];
  if (scores.length <= 1) return null;
  return (
    <details className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-500">
      <summary className="cursor-pointer font-black text-zinc-400">후보 점수/탈락 이유 보기</summary>
      <div className="mt-2 grid gap-1">
        {scores.map((candidate) => (
          <div key={`${candidate.index}-${candidate.engagementScore}`} className="flex items-center justify-between gap-3 rounded-xl bg-black/20 px-3 py-2">
            <span className="min-w-0 truncate">
              #{Number(candidate.index) + 1} · {ENGAGEMENT_PATTERN_LABELS[candidate.engagementPattern] || candidate.engagementPattern || '패턴 미분류'}
              {candidate.rejectionReasons?.length ? ` · ${candidate.rejectionReasons.join(', ')}` : ''}
            </span>
            <span className={`shrink-0 font-black ${candidate.selected ? 'text-emerald-300' : 'text-zinc-500'}`}>
              {candidate.selected ? '선택 ' : ''}{candidate.engagementScore}점
            </span>
          </div>
        ))}
      </div>
    </details>
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
                <span className={`h-2 w-2 shrink-0 rounded-full ${queueDotClass(row)}`} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-black ${isPostedLinkIssue(row) ? 'text-amber-300' : 'text-zinc-200'}`}>{queueDisplayTitle(row)}</div>
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
                      {(rowDetail?.post?.body || post?.body) && (
                        <div className="grid gap-2">
                          <EngagementQualityMeta post={rowDetail?.post || post} />
                          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-300">{rowDetail?.post?.body || post?.body}</pre>
                          <CandidateScoreSummary post={rowDetail?.post || post} />
                        </div>
                      )}
                      {(row.friendly_message || row.error_message) && <Notice tone={isPostedLinkIssue(row) ? 'warning' : 'error'}>{row.friendly_title ? `${row.friendly_title} · ` : ''}{row.friendly_message || row.error_message}</Notice>}
                      {row.post_url && isTrustedThreadsPostUrl(row.post_url) && <a href={row.post_url} target="_blank" rel="noreferrer" className="text-sm font-bold text-zinc-100 hover:text-white">게시글 보기</a>}
                      {row.post_url && !isTrustedThreadsPostUrl(row.post_url) && <div className="text-sm font-bold text-amber-200">Threads 링크 확인 필요</div>}
                      {onDismiss && (
                        <DarkButton variant="ghost" size="sm" onClick={() => onDismiss(row.id)} disabled={dismissingId === row.id} loading={dismissingId === row.id} loadingLabel="정리 중">
                          확인 완료
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
          <span className={`font-black ${isPostedLinkIssue(row) ? 'text-amber-300' : 'text-zinc-200'}`}>{queueDisplayTitle(row)}</span>
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

function normalizeLines(value = '') {
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function displayValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return displayValue(
      value.name
      || value.label
      || value.title
      || value.productName
      || value.company
      || value.productId
      || value.id
      || value.status
      || ''
    ) || JSON.stringify(value);
  }
  return String(value);
}

function SimpleInfoList({ items }) {
  const safeItems = Array.isArray(items) ? items.map(displayValue).filter(Boolean) : [];
  return (
    <div className="grid gap-2">
      {safeItems.map((item, index) => (
        <div key={`${item}-${index}`} className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-bold text-zinc-300">{item}</div>
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
    <section className={`min-w-0 rounded-3xl border border-white/10 bg-white/[0.03] p-5 ${className}`}>
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

function useModalDismiss(onClose) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

function PrivacyModal({ onClose }) {
  useModalDismiss(onClose);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#191919] shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div className="text-lg font-black text-zinc-100">개인정보처리방침</div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="grid gap-5 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-zinc-400">
          <p>이상한 회사는 JASAIN 서비스 제공과 계정 보호를 위해 필요한 범위에서 개인정보를 처리합니다. 회원가입, 구매 신청, 결제, 외부 계정 연결, 고객 상담 단계에서 아래 항목이 처리될 수 있습니다.</p>
          <PolicySection title="수집 항목">회원가입 시 고객명, 연락처, 아이디, 비밀번호 암호화값, 선택 솔루션, 개인정보 동의 일시를 수집합니다. 구매 및 결제 시 상품명, 결제금액, 주문번호, 입금 상태, 가상계좌 정보, 결제 승인 및 취소 기록을 처리합니다. 서비스 이용 중에는 보유 솔루션, 이용권, 접속 및 오류 기록, 상담 기록, Threads 계정 연결 상태, Coupang API 연결 상태, 자동화 설정값, 생성·예약·게시 이력이 처리될 수 있습니다.</PolicySection>
          <PolicySection title="이용 목적">회원 식별과 로그인, 무료체험 제공, 유료 이용권 관리, 결제 및 입금 확인, 서비스 셋업, 자동화 기능 제공, 장애 대응, 부정 이용 방지, 고객 안내, 계약 이행, 분쟁 대응, 법령상 의무 이행을 위해 사용합니다.</PolicySection>
          <PolicySection title="보유 기간">회원 정보는 탈퇴 또는 계약 종료 후 지체 없이 파기하는 것을 원칙으로 합니다. 다만 정산, 분쟁 대응, 부정 이용 방지, 법령상 보존 의무가 필요한 경우 해당 기간 동안 보관합니다. 계약·청약철회 기록과 대금결제 기록은 전자상거래 등에서의 소비자보호에 관한 법률에 따라 5년, 서비스 이용 관련 로그는 통신비밀보호법에 따라 3개월 보관할 수 있습니다.</PolicySection>
          <PolicySection title="제3자 제공 및 처리 위탁">회사는 이용자 동의 없이 개인정보를 임의로 판매하지 않습니다. 다만 결제 처리, 인프라 운영, 이메일·문자 안내, 고객 응대, 외부 플랫폼 연동처럼 서비스 제공에 필요한 범위에서 Toss Payments, 호스팅·데이터베이스 제공자, 메시지 발송 사업자, Meta/Threads, Coupang 등 관련 사업자에게 제공하거나 처리를 위탁할 수 있습니다.</PolicySection>
          <PolicySection title="환불 기준">CUJASA 일시불 상품은 결제 후 7일 이내 환불 신청 시 구매 가격의 20%를 환불하며, 7일 이후에는 환불이 불가합니다. 월정액 상품은 결제된 이용 기간이 시작된 뒤 해당 회차 환불이 제한되며, 다음 결제 전 해지 요청 시 다음 회차부터 과금되지 않습니다. 중복 결제, 결제 오류, 회사 귀책으로 서비스 제공이 불가능한 경우에는 확인 후 별도 환불을 진행합니다.</PolicySection>
          <PolicySection title="이용자 권리 및 책임">이용자는 개인정보 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. Threads, Coupang, 카드사, 은행 등 외부 서비스의 정책 변경, 계정 제한, 인증 만료, 이용자 입력 오류로 발생하는 연결 문제는 회사가 임의로 복구할 수 없으며, 필요한 경우 재연결 또는 재설정 안내를 제공합니다.</PolicySection>
          <div className="rounded-2xl bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
            시행일 2026년 5월 15일 · 책임자 이상빈 · 이메일 dypapa0309@gmail.com · 사업자등록번호 876-28-01550 · 주소 상동로 87 가나베스트타운 803-102
          </div>
        </div>
      </div>
    </div>
  );
}

function BusinessInfoModal({ onClose }) {
  useModalDismiss(onClose);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191919] p-6 shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
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
  useModalDismiss(onClose);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-5 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#191919] p-6 shadow-2xl shadow-black/50" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-lg font-black text-zinc-100">고객센터</div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
            <X size={18} />
          </button>
        </div>
        <div className="mt-5 grid gap-3 text-sm text-zinc-400">
          <p className="leading-relaxed text-zinc-500">워크스페이스 안에서 해결되지 않는 내용은 전화, 문자, 카카오톡으로 남겨주세요.</p>
          <div className="grid grid-cols-2 gap-2">
            <a href="tel:01040941666" className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-black text-zinc-950">
              전화하기
            </a>
            <a href="sms:01040941666?body=%5BJASAIN%20%EC%83%81%EB%8B%B4%5D%20" className="rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-200 hover:bg-white/10">
              문자하기
            </a>
          </div>
          <a href="mailto:dypapa0309@gmail.com?subject=%5BJASAIN%20%EB%AC%B8%EC%9D%98%5D" className="rounded-2xl border border-white/10 px-4 py-3 text-center text-sm font-black text-zinc-200 hover:bg-white/10">
            문의 남기기
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

function DarkSelect({ label, value, onChange, options, searchable = false, searchPlaceholder = '검색', invalid = false }) {
  const safeOptions = (Array.isArray(options) ? options : []).map((option) => {
    if (option && typeof option === 'object') {
      return {
        ...option,
        value: displayValue(option.value ?? option.id ?? option.label ?? option.name),
        label: displayValue(option.label ?? option.name ?? option.value ?? option.id)
      };
    }
    const text = displayValue(option);
    return { value: text, label: text };
  });
  const safeValue = displayValue(value);
  if (searchable) {
    return (
      <label className={labelClass}>
        {label}
        <SearchableSelect
          value={safeValue}
          onChange={onChange}
          options={safeOptions}
          placeholder={safeOptions.find((option) => option.value === safeValue)?.label || '선택'}
          searchPlaceholder={searchPlaceholder}
          variant="dark"
          className={invalid ? invalidFieldClass : ''}
        />
      </label>
    );
  }

  return (
    <label className={labelClass}>
      {label}
      <select className={`${inputClass} ${invalid ? invalidFieldClass : ''}`} value={safeValue} onChange={(event) => onChange(event.target.value)}>
        {safeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function ProductUsageStrip({ usage }) {
  if (!usage) return null;
  return (
    <div className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs font-black text-zinc-500">남은 사용</div>
        <div className="mt-0.5 truncate text-sm font-bold text-zinc-300">{usageSummaryLabel(usage)}</div>
      </div>
      <div className="max-w-[42vw] shrink-0 truncate text-right text-xl font-black text-zinc-100 sm:max-w-[180px] sm:text-2xl">{usageRemainingLabel(usage)}</div>
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

function DarkButton({ children, variant = 'primary', size = 'md', className = '', loading = false, loadingLabel = '', disabled = false, ...props }) {
  const variantClass = variant === 'ghost'
    ? 'border border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/10'
    : 'bg-zinc-100 text-zinc-950 hover:bg-white';
  const sizeClass = size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm';
  return (
    <button type="button" className={`inline-flex items-center justify-center gap-2 rounded-2xl font-black disabled:cursor-not-allowed disabled:opacity-50 ${variantClass} ${sizeClass} ${className}`} disabled={disabled || loading} {...props}>
      {loading && <RefreshCw size={size === 'sm' ? 14 : 16} className="shrink-0 animate-spin" aria-hidden="true" />}
      {loading ? (loadingLabel || children) : children}
    </button>
  );
}

function Notice({ children, tone = 'info' }) {
  const className = tone === 'error'
    ? 'border-white/15 bg-black/25 text-zinc-200'
    : tone === 'success'
      ? 'border-white/20 bg-white/10 text-zinc-100'
      : tone === 'warning'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
        : 'border-white/10 bg-white/[0.03] text-zinc-400';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${className}`}>
      {children}
    </div>
  );
}
