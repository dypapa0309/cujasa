import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, BarChart3, Bot, CheckCircle2, ChevronDown, ChevronRight, Clapperboard, ClipboardCheck, CreditCard, Download, FileText, Landmark, Link2, LogOut, PauseCircle, PlayCircle, Plus, RefreshCw, RotateCw, Search, Settings, ShieldCheck, Sparkles, Upload, Users, UserCircle, Wand2, X } from 'lucide-react';
import { api, postEvent } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';
import { useToast } from '../../lib/toast.jsx';
import { PRODUCTS, CURRENT_PRODUCT, productById } from '../../config/products.js';
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
const spreadMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_SPREAD_BETA !== 'true';
const infludexMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_INFLUDEX_BETA !== 'true';

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
  { key: 'polibot-upload', productId: 'polibot', label: 'PDF 업로드', icon: Upload, hint: '보험 상품 PDF와 메모를 넣고 분석 준비 상태를 만들어요.' },
  { key: 'polibot-recommend', productId: 'polibot', label: '상품 추천', icon: Sparkles, hint: '고객 조건과 보장 니즈로 추천 초안을 만들어요.' },
  { key: 'polibot-customers', productId: 'polibot', label: '고객 관리', icon: Users, hint: '고객 조건과 추천 기록을 정리해요.' },
  { key: 'polibot-download', productId: 'polibot', label: '결과 다운로드', icon: Download, hint: '추천 결과를 CSV로 내려받아요.' }
];

const infludexActions = [
  { key: 'infludex-upload', productId: 'infludex', label: '후보 업로드', icon: Upload, hint: '인스타그램 계정 URL, 카테고리, 반응 지표를 넣어요.' },
  { key: 'infludex-grade', productId: 'infludex', label: '링크 분석', icon: Search, hint: 'S/A/B/C/D 등급과 캠페인 선정 기준을 확인해요.' },
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
  if (product?.id === 'spread') return spreadMaintenanceEnabled;
  if (product?.id === 'infludex') return infludexMaintenanceEnabled;
  return false;
}

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/25';
const invalidFieldClass = 'ring-1 ring-red-400/45 bg-red-950/10';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';
const dexorCategoryOptions = ['맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const dexorScoreRows = [
  ['S', '90점 이상', '최우선 후보'],
  ['A', '80-89점', '우선 선정 후보'],
  ['B', '70-79점', '검토 가능 후보'],
  ['C', '60-69점', '보조 후보'],
  ['D', '60점 미만', '제외 또는 재검토']
];
const polibotNeedOptions = ['암', '뇌', '심장', '수술', '입원', '실손', '생활비', '운전자'];
const polibotTargetPremiumQuickOptions = ['10', '20', '30', '40', '50'];
const polibotGenderOptions = [
  { value: '', label: '미확인' },
  { value: '남성', label: '남성' },
  { value: '여성', label: '여성' }
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

function polibotBudgetHint({ budget = '', existingPremium = '', purpose = '' } = {}) {
  const target = parsePolibotPremiumValue(budget);
  const current = parsePolibotPremiumValue(existingPremium);
  const remodel = /리모델링|보험료 절감/.test(purpose);
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
  if (value >= 90) return '최우선으로 볼 만한 후보예요.';
  if (value >= 80) return '우선 선정 후보에 가까워요.';
  if (value >= 70) return '조건을 확인하며 검토할 후보예요.';
  if (value >= 60) return '보조 후보로 보는 편이 좋아요.';
  return '제외하거나 다시 검토하는 편이 좋아요.';
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
    followers_missing: '팔로워 수 필요',
    engagement_missing: '좋아요/댓글 평균 필요',
    recent_post_missing: '최근 게시일 필요',
    inactive_over_60d: '최근 활동 확인 필요',
    ad_memo_present: '광고/협찬 메모 있음'
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
  const initialUrlProductId = productById(new URLSearchParams(window.location.search).get('product'))?.id || CURRENT_PRODUCT.id;
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
  const isTestUser = String(props.currentUser?.email || '').trim().toLowerCase() === 'test1@test.com';
  const compactPolibotStepper = action.key === 'polibot-recommend' && isTestUser;
  const wideBilling = action.key === 'billing';
  const wideWorkspace = action.key === 'polibot-recommend';
  const desktopWidthClass = compactPolibotStepper
    ? 'lg:w-[min(680px,calc(100vw-340px))]'
    : wideBilling
      ? 'lg:w-[min(1180px,calc(100vw-340px))]'
      : wideWorkspace
      ? 'lg:w-[min(980px,calc(100vw-340px))]'
      : 'lg:w-[min(640px,calc(100vw-340px))]';
  const mobileWidthClass = wideBilling ? 'w-[min(1120px,96vw)]' : 'w-[min(420px,92vw)]';

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
          {action.key === 'polibot-upload' && <PolibotUploadPanel />}
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
          <DarkButton variant="ghost" onClick={() => runPreflight()} disabled={checking || actioning}>
            {checking ? '점검 중...' : '사전 점검'}
          </DarkButton>
          <DarkButton onClick={() => setAutomation(automationRunning ? 'paused' : 'running')} disabled={checking || actioning}>
            {actioning
              ? '처리 중...'
              : automationRunning
                ? <span className="inline-flex items-center justify-center gap-2"><PauseCircle size={18} /> 자동화 중지</span>
                : '자동화 시작'}
          </DarkButton>
        </div>
      </PanelCard>

      {runError && <Notice tone="error">{runError}</Notice>}
    </>
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
        active_time_windows: [{ start: form.first_upload_time || '09:00', end: '23:00' }],
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
          <DarkButton variant="ghost" size="sm" onClick={requestSetup} disabled={requestingSetup}>
            <Settings size={15} />
            {requestingSetup ? '요청 중...' : '관리자에게 셋업 요청'}
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
              <DarkButton variant="ghost" size="sm" onClick={connectThreads} disabled={connectingThreads}>
                <Link2 size={15} />
                {connectingThreads ? '이동 중...' : account?.has_threads_access_token ? '다시 연결' : '승인 후 연결'}
              </DarkButton>
            ) : (
              <DarkButton variant="ghost" size="sm" onClick={requestThreadsRegistration} disabled={requestingThreads}>
                <Link2 size={15} />
                {requestingThreads ? '요청 중...' : activeThreadsRequest ? '요청 업데이트' : '등록 요청'}
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
            Meta 등록이 완료됐어요. Meta 웹 승인 초대를 수락한 뒤 Threads 연결을 마무리해 주세요.
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

      <DarkButton onClick={save} disabled={saving}>{saving ? '저장 중...' : '설정 저장'}</DarkButton>
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
          <DarkButton onClick={runPreview} disabled={previewLoading}>{previewLoading ? '생성 중...' : '예시 글 생성'}</DarkButton>
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
                    <div className="grid gap-2 sm:grid-cols-3">
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
          <DarkButton onClick={analyze} disabled={loading || ocrLoading || samples.length === 0}>{loading ? '저장 중...' : '이 글 학습하기'}</DarkButton>
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
                <DarkButton onClick={() => updateAnonymousLearning(true)} disabled={savingLearning}>
                  {savingLearning ? '저장 중...' : '참여하고 글 품질 높이기'}
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
        className="rounded-xl bg-zinc-100 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {accountCreation.adding ? '추가 중...' : '추가하기'}
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
      id: 'sponsored_monthly_19000',
      product: productsById.sponsored_monthly_19000 || {
        id: 'sponsored_monthly_19000',
        name: 'CUJASA 스폰서 스타터',
        amount: 19000,
        billing_cycle: 'monthly',
        max_accounts: 1
      },
      title: '스폰서 스타터',
      priceText: '19,000원 / 월',
      caption: '가볍게 시작하는 광고 지원 플랜',
      badge: '스폰서',
      buttonLabel: '19,000원으로 시작',
      icon: CreditCard,
      features: ['Threads 계정 1개 운영', '주제 선정, 상품 검색, 글 생성', '예약 업로드와 기본 현황 확인', '스폰서/광고 라벨 노출 가능'],
      testOnly: !productsById.sponsored_monthly_19000
    },
    {
      id: 'monthly_59000',
      product: productsById.monthly_59000,
      title: billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액',
      priceText: '59,000원 / 월',
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
      payments={payments}
      latestWaiting={latestWaiting}
      activeSubscription={activeSubscription}
      cujasaPlans={cujasaPlans}
      busy={busy}
      load={load}
      requestAgreement={requestAgreement}
      startOnetime={startOnetime}
      startMonthly={startMonthly}
    />
  );

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
        <LegacyBetaPlanCard
          icon={Landmark}
          title="프로 영구구매"
          priceText="590,000원"
          caption="가상계좌 결제"
          product={productsById.onetime_590000 ? { ...productsById.onetime_590000, max_accounts: 4 } : null}
          busy={busy === 'onetime_590000'}
          onClick={() => requestAgreement('onetime', productsById.onetime_590000, (snapshot) => startOnetime('onetime_590000', snapshot))}
        />
        <LegacyBetaPlanCard
          icon={CreditCard}
          title={billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액'}
          priceText="59,000원 / 월"
          caption={activeSubscription ? `활성 · 다음 결제 ${formatBillingDate(activeSubscription.nextBillingAt)}` : '가상계좌 결제'}
          product={productsById.monthly_59000}
          busy={busy === 'monthly_59000'}
          onClick={() => requestAgreement('monthly', productsById.monthly_59000, (snapshot) => startMonthly('monthly_59000', snapshot))}
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
      modeLabel: '운영형 3단계 요금제',
      description: 'Threads 포스팅, 쿠팡 실상품 검색, 댓글 링크 운영까지 이어지는 자동화 상품입니다.',
      plans: cujasaPlans,
      comparisonRows: [
        { label: 'Threads 계정', values: ['1개', '2개', '4개'] },
        { label: '스폰서/광고 라벨', values: ['노출 가능', '없음', '없음'] },
        { label: '콘텐츠 생성', values: [true, true, true] },
        { label: '쿠팡 실상품 검색', values: [true, true, true] },
        { label: '예약 업로드', values: [true, true, true] },
        { label: '결제 방식', values: ['가상계좌', '가상계좌', '가상계좌'] }
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
      modeLabel: '운영형 3단계 요금제',
      description: '캠페인 생성, 신청자 정리, 제출물 검수 흐름을 줄이는 월정액 상품입니다.',
      plans: [
        pricingPlan(productsById, 'spread_starter_monthly_49000', { name: 'SPREAD 스타터 월정액', app_product_id: 'spread', amount: 49000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '스타터',
          caption: '작은 캠페인 운영 시작',
          buttonLabel: '스타터 시작',
          features: ['월 캠페인 3개', '신청자/제출물 기본 정리', '가상계좌 월 단위 이용']
        }),
        pricingPlan(productsById, 'spread_basic_monthly_149000', { name: 'SPREAD 베이직 월정액', app_product_id: 'spread', amount: 149000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '베이직',
          caption: '추천/선정 자동화 포함',
          badge: '추천',
          buttonLabel: '베이직 시작',
          features: ['월 캠페인 10개', '신청자 추천/선정 자동화', '운영 현황 확인']
        }),
        pricingPlan(productsById, 'spread_pro_monthly_390000', { name: 'SPREAD 프로 월정액', app_product_id: 'spread', amount: 390000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '프로',
          caption: '운영팀 캠페인 관리용',
          buttonLabel: '프로 시작',
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
      description: '고객 상담 맥락, 보장분석 자료, 상품 추천 흐름을 정리하는 월정액 상품입니다.',
      plans: [
        pricingPlan(productsById, 'polibot_starter_monthly_39000', { name: 'POLIBOT 스타터 월정액', app_product_id: 'polibot', amount: 39000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '스타터',
          caption: '가볍게 상담 추천 시작',
          buttonLabel: '스타터 시작',
          features: ['상담/추천 100회', '지식 업로드 기본', '가상계좌 월 단위 이용']
        }),
        pricingPlan(productsById, 'polibot_basic_monthly_99000', { name: 'POLIBOT 베이직 월정액', app_product_id: 'polibot', amount: 99000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '베이직',
          caption: '고객별 추천 히스토리',
          badge: '추천',
          buttonLabel: '베이직 시작',
          features: ['상담/추천 500회', '고객별 추천 히스토리', '상품 추천 근거 정리']
        }),
        pricingPlan(productsById, 'polibot_pro_monthly_290000', { name: 'POLIBOT 프로 월정액', app_product_id: 'polibot', amount: 290000, billing_cycle: 'monthly', plan: 'monthly', max_accounts: 0 }, {
          title: '프로',
          caption: '팀 단위 상담 운영',
          buttonLabel: '프로 시작',
          features: ['상담/추천 2,000회', '팀 단위 운영', '우선 지원']
        })
      ],
      comparisonRows: [
        { label: '상담/추천 한도', values: ['100회 / 월', '500회 / 월', '2,000회 / 월'] },
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
        pricingPlan(productsById, 'infludex_credit_19000', { name: 'INFLUDEX 라이트 분석 30회', app_product_id: 'infludex', amount: 19000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '라이트 분석',
          caption: '작은 후보군 검토',
          buttonLabel: '30회 충전',
          features: ['후보 분석 30회', '등급/리스크 확인', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'infludex_credit_49000', { name: 'INFLUDEX 베이직 분석 100회', app_product_id: 'infludex', amount: 49000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
          title: '베이직 분석',
          caption: '캠페인 후보 선별용',
          badge: '추천',
          buttonLabel: '100회 충전',
          features: ['후보 분석 100회', '캠페인 후보 비교', '가상계좌 입금 확인 후 반영']
        }),
        pricingPlan(productsById, 'infludex_credit_99000', { name: 'INFLUDEX 프로 분석 250회', app_product_id: 'infludex', amount: 99000, billing_cycle: 'once', plan: 'onetime', max_accounts: 0 }, {
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
  payments,
  latestWaiting,
  activeSubscription,
  cujasaPlans,
  busy,
  load,
  requestAgreement,
  startOnetime,
  startMonthly
}) {
  const [activeProductId, setActiveProductId] = useState('cujasa');
  const productPricing = useMemo(() => buildWorkspacePricingCatalog({ productsById, cujasaPlans, currentUser }), [productsById, cujasaPlans, currentUser]);
  const activePricing = productPricing.find((item) => item.id === activeProductId) || productPricing[0];
  const openPlan = (plan) => {
    if (plan.testOnly) return;
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

        <div className="grid gap-0 border-t border-white/10 lg:grid-cols-3">
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

      <section className="grid gap-3 lg:grid-cols-2">
        <PanelCard title="최근 결제">
          {payments.length > 0 ? (
            <div className="grid gap-3">
              {payments.slice(0, 4).map((payment) => (
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
        <PanelCard title="테스트 안내">
          <Notice>
            이 제품별 요금제 화면은 test1@test.com 전용 테스트입니다. 모든 상품은 Toss 가상계좌 결제 흐름으로 검증할 수 있어요.
          </Notice>
        </PanelCard>
      </section>
    </div>
  );
}

function TestPricingColumn({ plan, index, busy, onClick }) {
  const featured = index === 1;
  return (
    <article className={`flex min-h-[390px] flex-col border-b border-white/10 px-6 py-7 lg:border-b-0 lg:border-l lg:px-7 lg:py-8 lg:first:border-l-0 ${featured ? 'bg-white/[0.07]' : 'bg-[#171717]'}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.08em] text-zinc-500">{index === 0 ? 'Starter' : index === 1 ? 'Growth' : 'Lifetime'}</div>
          <h3 className={`mt-4 text-2xl font-black leading-snug tracking-normal ${plan.testOnly ? 'text-zinc-500' : 'text-zinc-50'}`}>{plan.title}</h3>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-400">{plan.caption}</p>
        </div>
        {plan.badge && (
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${featured ? 'bg-zinc-100 text-zinc-950' : 'bg-white/10 text-zinc-300'}`}>
            {plan.badge}
          </span>
        )}
      </div>
      <div className="mt-9 text-3xl font-black leading-tight tracking-normal text-zinc-50">{plan.priceText}</div>
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
        className={`mt-10 w-full rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${featured ? 'bg-zinc-100 text-zinc-950 hover:bg-white' : 'bg-white/10 text-zinc-50 hover:bg-white/15'}`}
      >
        {busy ? '진행 중...' : plan.testOnly ? '상품 등록 후 활성화' : plan.buttonLabel}
      </button>
      {plan.testOnly && <div className="mt-3 text-center text-xs font-bold text-amber-600">테스트 표시 · 결제 미연동</div>}
    </article>
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

function LegacyBetaPlanCard({ icon: Icon, title, priceText, caption, product, busy, onClick }) {
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

function BetaPlanCard({ icon: Icon, title, priceText, caption, badge, features = [], featured = false, testOnly = false, buttonLabel = '결제하기', product, busy, onClick }) {
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
      <div className={`mt-5 text-2xl font-black ${featured ? 'text-zinc-950' : 'text-zinc-100'}`}>{priceText}</div>
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
        className={`mt-auto w-full rounded-2xl px-4 py-3 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${featured ? 'bg-zinc-950 text-white hover:bg-black' : 'bg-white text-zinc-950 hover:bg-zinc-200'}`}
      >
        {busy ? '진행 중...' : testOnly ? '상품 등록 후 활성화' : buttonLabel}
      </button>
    </div>
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
          <DarkButton variant="ghost" onClick={loadDiagnostics} disabled={diagnosticsLoading}>{diagnosticsLoading ? '진단 중...' : '진단 새로고침'}</DarkButton>
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
              <DarkButton onClick={saveApplicants} disabled={savingApplicants || usage.remaining <= 0}>{savingApplicants ? '정리 중...' : '참여자 선정 정리'}</DarkButton>
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
              <DarkButton onClick={saveReview} disabled={savingReview || usage.remaining <= 0}>{savingReview ? '검수 중...' : '제출물 검수'}</DarkButton>
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
            <DarkButton onClick={save} disabled={saving || usage.remaining <= 0}>{saving ? '등록 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '캠페인 등록'}</DarkButton>
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
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0 || !selectedCampaign}>{saving ? '정리 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '참여자 선정 정리'}</DarkButton>
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
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0 || !selectedCampaign}>{saving ? '검수 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '제출물 검수'}</DarkButton>
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
      const base = { name: file.name, size: file.size, type: file.type, mimeType: file.type };
      if (file.size > 12 * 1024 * 1024) {
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
        {workspace.qualityReport && <PolibotQualityReport report={workspace.qualityReport} dbSummary={workspace.knowledgeDbSummary} />}
        {saving && <Notice>자료를 읽고 상품 후보와 제외된 후보를 정리하고 있어요.</Notice>}
        <div className="grid gap-3">
          <label className={labelClass}>자료 월<input className={inputClass} value={form.month} onChange={(event) => setForm((prev) => ({ ...prev, month: event.target.value }))} placeholder="예: 2026-05" /></label>
          <label className="flex min-w-0 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/25 px-4 py-5 text-sm font-bold text-zinc-300 hover:bg-white/5">
            <span className="inline-flex min-w-0 items-center gap-2">
              <Upload size={17} />
              <span className="min-w-0 truncate">{files.length ? `${files.length}개 자료 선택됨` : 'PDF/PPTX/CSV/JPEG 자료 선택'}</span>
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
          PDF/PPTX/CSV/TXT는 텍스트를 추출해 월별 지식베이스로 저장해요. 12MB 이하 이미지는 OCR 대기 자료로 저장하고, 12MB가 넘는 파일은 파일명과 메모만 저장해요.
        </p>
      </PanelCard>
      {workspace.knowledgeSources?.length > 0 && (
        <PanelCard title="월별 자료 목록">
          <SimpleInfoList items={workspace.knowledgeSources.slice(0, 10).map((item) => {
            const catalogItem = workspace.qualityReport?.catalog?.find((row) => row.sourceId === item.id || row.fileName === item.fileName);
            return `${item.month} · ${item.fileName} · ${(item.companies || [item.company]).filter(Boolean).slice(0, 3).join(', ') || '미분류'} · ${item.productGroup || '종합 보장'} · ${catalogItem?.statusLabel || '품질 확인'}`;
          })} />
        </PanelCard>
      )}
    </>
  );
}

function PolibotQualityReport({ report, dbSummary }) {
  if (!report) return null;
  const countBy = (items = [], key) => items.reduce((acc, item) => {
    const value = item?.[key] || '미분류';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const companyCounts = Object.entries(countBy(report.catalogItems || [], 'company'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const groupCounts = Object.entries(countBy(report.catalogItems || [], 'productGroup'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const items = [
    ['자동 확정 상품', `${report.recommendableProducts || 0}개`],
    ['확정 후 정보부족', `${report.insufficientProducts || 0}개`],
    ['검토 필요 후보', `${report.reviewNeededProducts || 0}개`],
    ['제외된 후보', `${report.excludedPhrases || 0}개`],
    ['이미지/OCR 필요', `${report.ocrNeeded || 0}개`]
  ];
  const dbItems = dbSummary ? [
    ['DB 확정 상품', `${dbSummary.recommendableCatalogItems || 0}개`],
    ['DB 검토 필요', `${dbSummary.reviewNeededCatalogItems || 0}개`],
    ['고품질 근거', `${dbSummary.highQualitySources || 0}개`],
    ['충돌 후보', `${dbSummary.conflictCatalogItems || 0}개`],
    ['개인정보 위험', `${dbSummary.privacyRiskSources || 0}개`],
    ['DB 청크', `${dbSummary.chunks || 0}개`],
    ['카톡 상담 지식', `${dbSummary.conversationInsights || 0}개`]
  ] : [];
  const sourceChannelCounts = dbSummary?.sourceChannelCounts || {};
  const sourceChannelText = [
    sourceChannelCounts.local_ingest ? `로컬 ${sourceChannelCounts.local_ingest}` : '',
    sourceChannelCounts.web_upload ? `웹 ${sourceChannelCounts.web_upload}` : '',
    sourceChannelCounts.admin_upload ? `관리자 ${sourceChannelCounts.admin_upload}` : '',
    sourceChannelCounts.kakao_txt ? `카톡 ${sourceChannelCounts.kakao_txt}` : ''
  ].filter(Boolean).join(' · ');
  const latestJobSummary = dbSummary?.latestJob?.summary || {};
  const latestJobText = dbSummary?.latestJob
    ? [
      latestJobSummary.insertedSources != null ? `저장 ${latestJobSummary.insertedSources}` : '',
      latestJobSummary.duplicateSources ? `중복 파일 ${latestJobSummary.duplicateSources}` : '',
      latestJobSummary.duplicateChunks ? `중복 내용 ${latestJobSummary.duplicateChunks}` : '',
      latestJobSummary.failed ? `실패 ${latestJobSummary.failed}` : ''
    ].filter(Boolean).join(' · ')
    : '';
  return (
    <div className="mb-3 min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-2.5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="shrink-0 text-xs font-black text-zinc-400">자료 품질</div>
        <div className="min-w-0 truncate text-[11px] font-bold text-zinc-600">
          {(report.companies || []).slice(0, 3).join(', ') || '보험사 미분류'}
        </div>
      </div>
      <div className="mt-2 flex min-w-0 gap-2 overflow-x-auto pb-1">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-[104px] rounded-xl bg-black/25 px-3 py-2">
            <div className="text-[10px] font-bold text-zinc-600">{label}</div>
            <div className="mt-0.5 text-sm font-black text-zinc-100">{value}</div>
          </div>
        ))}
      </div>
      {dbSummary && (
        <div className="mt-2 grid gap-2 rounded-xl bg-black/25 px-3 py-2 text-[11px] font-bold leading-relaxed text-zinc-500">
          <div>
            DB 자료 <span className="font-black text-zinc-200">{dbSummary.totalSources || 0}개</span>
            <span className="text-zinc-700"> · </span>
            공통 <span className="font-black text-zinc-200">{dbSummary.globalSources || 0}개</span>
            <span className="text-zinc-700"> · </span>
            내 자료 <span className="font-black text-zinc-200">{dbSummary.userSources || 0}개</span>
            {dbSummary.latestMonth && (
              <>
                <span className="text-zinc-700"> · </span>
                최신 <span className="font-black text-zinc-200">{dbSummary.latestMonth}</span>
              </>
            )}
          </div>
          {dbItems.length > 0 && (
            <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
              {dbItems.map(([label, value]) => (
                <span key={label} className="shrink-0 rounded-full border border-white/10 bg-black/25 px-2 py-1">
                  {label} <span className="font-black text-zinc-200">{value}</span>
                </span>
              ))}
            </div>
          )}
          {sourceChannelText && <div className="text-zinc-600">유입 경로 {sourceChannelText}</div>}
          {latestJobText && <div className="text-zinc-600">최근 처리 {latestJobText}</div>}
        </div>
      )}
      {(companyCounts.length > 0 || groupCounts.length > 0) && (
        <div className="mt-2 line-clamp-2 text-[11px] font-bold leading-relaxed text-zinc-600">
          {companyCounts.length > 0 && <div>후보 보험사별 {companyCounts.map(([name, count]) => `${name} ${count}`).join(' · ')}</div>}
          {groupCounts.length > 0 && <div>후보 상품군별 {groupCounts.map(([name, count]) => `${name} ${count}`).join(' · ')}</div>}
        </div>
      )}
    </div>
  );
}

function PolibotKnowledgeSummary({ report }) {
  if (!report) return null;
  return (
    <div className="rounded-2xl bg-black/25 px-4 py-3 text-sm leading-relaxed text-zinc-400">
      자동 확정 <span className="font-black text-zinc-100">{report.recommendableProducts || 0}개</span>
      <span className="text-zinc-600"> · </span>
      정보부족 <span className="font-black text-zinc-100">{report.insufficientProducts || 0}개</span>
      <span className="text-zinc-600"> · </span>
      OCR 필요 <span className="font-black text-zinc-100">{report.ocrNeeded || 0}개</span>
    </div>
  );
}

function PolibotRecommendPanel({ assistantDraft, reloadCurrentUser, onOpenAction, currentUser }) {
  const toast = useToast();
  const isTestStepper = String(currentUser?.email || '').trim().toLowerCase() === 'test1@test.com';
  const [form, setForm] = useState({
    name: '',
    age: '',
    gender: '',
    needs: '',
    budget: '',
    company: '전체 보험사',
    existingMedicalPlan: '',
    existingPremium: '',
    medicalHistory: '',
    familyHistory: '',
    driving: '',
    renewalPreference: '',
    purpose: ''
  });
  const [workspace, setWorkspace] = useState({});
  const [selectedRecommendation, setSelectedRecommendation] = useState(null);
  const [saveMemo, setSaveMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [testStep, setTestStep] = useState(1);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const usage = workspaceUsage(workspace);
  const catalogCompanies = Array.isArray(workspace.catalog?.companies) ? workspace.catalog.companies : Array.isArray(workspace.qualityReport?.companies) ? workspace.qualityReport.companies : [];
  const companies = ['전체 보험사', ...catalogCompanies];
  const recommendations = Array.isArray(workspace.recommendations) ? workspace.recommendations : [];
  const hasAnalysis = Boolean(workspace.consultationDraft);
  const hasRecommendations = recommendations.length > 0;
  const legacyProgressStep = hasRecommendations ? 3 : hasAnalysis ? 2 : 1;
  const selectedNeeds = useMemo(() => normalizeLines(form.needs), [form.needs]);
  const setNeeds = (needs) => setForm((prev) => ({ ...prev, needs: needs.join(isTestStepper ? ', ' : '\n') }));
  const toggleNeed = (need) => {
    const next = selectedNeeds.includes(need)
      ? selectedNeeds.filter((item) => item !== need)
      : [...selectedNeeds, need];
    setNeeds(next);
  };

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
      needs: Array.isArray(values.needs) ? values.needs.join(isTestStepper ? ', ' : '\n') : values.needs ?? prev.needs,
      budget: values.budget ?? prev.budget,
      company: values.company || prev.company || '전체 보험사',
      existingMedicalPlan: values.existingMedicalPlan ?? prev.existingMedicalPlan,
      existingPremium: values.existingPremium ?? prev.existingPremium,
      medicalHistory: values.medicalHistory ?? prev.medicalHistory,
      familyHistory: values.familyHistory ?? prev.familyHistory,
      driving: values.driving ?? prev.driving,
      renewalPreference: values.renewalPreference ?? prev.renewalPreference,
      purpose: values.purpose ?? prev.purpose
    }));
  }, [assistantDraft, isTestStepper]);

  const save = async () => {
    setSubmitAttempted(true);
    setSaving(true);
    try {
      const next = await api.post('/api/product-workspace/polibot/recommend', form);
      setWorkspace(next);
      await reloadCurrentUser?.();
      setSelectedRecommendation(null);
      if (isTestStepper) setTestStep(3);
      const hasNextRecommendations = Array.isArray(next?.recommendations) && next.recommendations.length > 0;
      toast(
        hasNextRecommendations ? '추천 초안을 만들었어요.' : '추천 보류 조건을 확인해 주세요.',
        hasNextRecommendations ? 'success' : 'info'
      );
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

  if (isTestStepper) {
    return (
      <div className="grid gap-4">
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
          saving={saving}
          save={save}
          submitAttempted={submitAttempted}
          saveMemo={saveMemo}
          setSaveMemo={setSaveMemo}
          setSelectedRecommendation={setSelectedRecommendation}
          onOpenKnowledge={() => onOpenAction?.('polibot-upload')}
        />
        {workspace.qualityReport && (
          <CollapsiblePanel title="자료 상태">
            <PolibotKnowledgeSummary report={workspace.qualityReport} />
            <PolibotQualityReport report={workspace.qualityReport} dbSummary={workspace.knowledgeDbSummary} />
          </CollapsiblePanel>
        )}
        {selectedRecommendation && (
          <PolibotRecommendationModal
            recommendation={selectedRecommendation}
            profile={workspace.customerProfile}
            testMode={isTestStepper}
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
      <PolibotProgressHeader activeStep={legacyProgressStep} usage={usage} />
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] xl:items-start">
      <PanelCard title="1. 고객 조건" className="min-w-0 xl:sticky xl:top-4">
        {assistantDraft?.actionKey === 'polibot-recommend' && (
          <Notice>채팅에서 만든 초안이 들어왔어요. 핵심 조건만 확인하고 바로 추천 초안을 만들면 됩니다.</Notice>
        )}
        {saving && <Notice>고객 조건을 분석하고 확정 상품 DB와 대조하고 있어요.</Notice>}
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
            <label className={labelClass}>월 예산<input className={inputClass} value={form.budget} onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))} placeholder="10만원" /></label>
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
              <PolibotCompanyHint companies={catalogCompanies} selectedCompany={form.company} onOpenKnowledge={() => onOpenAction?.('polibot-upload')} />
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
              <DarkSelect label="가입 목적" value={form.purpose} onChange={(value) => setForm((prev) => ({ ...prev, purpose: value }))} options={[{ value: '', label: '미확인' }, { value: '보장 강화', label: '보장 강화' }, { value: '보험료 절감', label: '보험료 절감' }, { value: '리모델링', label: '리모델링' }, { value: '신규 가입', label: '신규 가입' }]} />
            </div>
          )}
          <DarkButton onClick={save} disabled={saving || usage.remaining <= 0} className="w-full">{saving ? '분석 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}</DarkButton>
          {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
        </div>
      </PanelCard>
      <div className="grid min-w-0 gap-4">
        <PanelCard title="2. 고객 분석" className="min-w-0">
          <PolibotConsultationDraft draft={workspace.consultationDraft} profile={workspace.customerProfile || form} saving={saving} />
        </PanelCard>
        <PanelCard title="3. 상품 추천" className="min-w-0 xl:max-h-[calc(100vh-23rem)] xl:overflow-y-auto">
          {hasRecommendations ? (
            <PolibotRecommendationList
              recommendations={recommendations}
              saveMemo={saveMemo}
              onMemoChange={setSaveMemo}
              onSelect={setSelectedRecommendation}
            />
          ) : (
            <PolibotRecommendationEmptyState
              workspace={workspace}
              hasAnalysis={hasAnalysis}
              catalogCompanies={catalogCompanies}
              onOpenDetails={() => setDetailsOpen(true)}
              onOpenKnowledge={() => onOpenAction?.('polibot-upload')}
            />
          )}
        </PanelCard>
      </div>
      </div>
      {workspace.qualityReport && (
        <CollapsiblePanel title="자료 상태">
          <PolibotKnowledgeSummary report={workspace.qualityReport} />
          <PolibotQualityReport report={workspace.qualityReport} dbSummary={workspace.knowledgeDbSummary} />
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
  saving,
  save,
  submitAttempted,
  saveMemo,
  setSaveMemo,
  setSelectedRecommendation,
  onOpenKnowledge
}) {
  const steps = [
    { id: 1, title: '기본 조건', caption: '고객과 보장 니즈' },
    { id: 2, title: '상세 조건', caption: '실손, 병력, 선호' },
    { id: 3, title: '상품 추천', caption: '초안과 후보 검토' }
  ];
  const canGenerate = !saving && usage.remaining > 0;
  const draftMissing = Array.isArray(workspace.consultationDraft?.missing) ? workspace.consultationDraft.missing : [];
  const notice = workspace.recommendationNotice || '';
  const hardMissingLabels = [
    !form.age && '나이',
    selectedNeeds.length === 0 && '필요 보장',
    !form.budget && '예산'
  ].filter(Boolean);
  const verifyMissingLabels = [
    !form.gender && '성별',
    !form.existingPremium && '현재 보험료',
    !form.existingMedicalPlan && '기존 실손 여부',
    !form.medicalHistory && '병력/고지 이슈'
  ].filter(Boolean);
  const currentMissingLabels = [...hardMissingLabels, ...verifyMissingLabels];
  const localMissing = submitAttempted ? currentMissingLabels : [];
  const missingSet = new Set([
    ...localMissing,
    ...draftMissing.filter((label) => currentMissingLabels.includes(label)),
    ...currentMissingLabels.filter((label) => notice.includes(label))
  ]);
  const isMissing = (label) => missingSet.has(label);
  const badgeForStep = (stepId) => {
    const hardLabels = stepId === 1 ? ['나이', '필요 보장', '예산'].filter(isMissing) : [];
    const verifyLabels = stepId === 1
      ? ['성별'].filter(isMissing)
      : ['현재 보험료', '기존 실손 여부', '병력/고지 이슈'].filter(isMissing);
    if (hardLabels.length) return { label: `필수 ${hardLabels.length}`, tone: 'hard' };
    if (verifyLabels.length) return { label: `확인 ${verifyLabels.length}`, tone: 'verify' };
    return null;
  };
  const fieldClass = (label) => `${inputClass} ${isMissing(label) ? invalidFieldClass : ''}`;
  const invalidPanelClass = 'rounded-2xl border border-red-400/35 bg-red-950/10 p-2.5';
  const premiumHint = polibotBudgetHint({
    budget: form.budget,
    existingPremium: form.existingPremium,
    purpose: form.purpose
  });

  return (
    <div className="grid min-w-0 gap-3">
      <div className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-2.5">
        <div className="grid min-w-0 gap-2">
          <div className="grid min-w-0 gap-1.5 sm:grid-cols-3">
            {steps.map((item) => {
              const active = step === item.id;
              const badge = badgeForStep(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onStepChange(item.id)}
                  className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${active ? 'bg-white text-zinc-950' : 'bg-white/[0.03] text-zinc-500 hover:bg-white/10 hover:text-zinc-200'}`}
                >
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${active ? 'bg-zinc-950 text-white' : 'bg-black/25 text-zinc-500'}`}>{item.id}</span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-black">{item.title}</span>
                      {badge && (
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ${badge.tone === 'hard' ? 'bg-red-500/15 text-red-200' : 'bg-amber-500/15 text-amber-200'}`}>
                          {badge.label}
                        </span>
                      )}
                    </span>
                    <span className={`block truncate text-[11px] font-bold ${active ? 'text-zinc-600' : 'text-zinc-600'}`}>{item.caption}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-black/25 px-3 py-2">
            <div className="text-[10px] font-black text-zinc-600">남은 사용</div>
            <div className="truncate text-xs font-black text-zinc-100">
              {usage.unlimited ? '무제한' : `${usage.remaining}회 / ${usage.limit}`}
            </div>
          </div>
        </div>
      </div>

      {step === 1 && (
        <PanelCard title="1. 기본 조건" className="min-w-0 p-4">
          <div className="grid gap-3">
            {saving && <Notice>고객 조건을 분석하고 확정 상품 DB와 대조하고 있어요.</Notice>}
            <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_76px_92px]">
              <label className={labelClass}>고객명<input className={inputClass} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="이효진" /></label>
              <label className={labelClass}>나이<input type="number" min="0" className={fieldClass('나이')} value={form.age} onChange={(event) => setForm((prev) => ({ ...prev, age: event.target.value }))} placeholder="45" /></label>
              <DarkSelect label="성별" value={form.gender} onChange={(value) => setForm((prev) => ({ ...prev, gender: value }))} options={polibotGenderOptions} invalid={isMissing('성별')} />
            </div>
            <div className="flex min-w-0 gap-1.5 overflow-x-auto">
              {polibotAgeQuickOptions.map((age) => (
                <button
                  key={age}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, age }))}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black transition ${form.age === age ? 'border-white bg-white text-zinc-950' : 'border-white/10 bg-black/20 text-zinc-500 hover:border-white/25 hover:text-zinc-200'}`}
                >
                  {age}세
                </button>
              ))}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-bold text-zinc-300">필요 보장</div>
                <div className="text-[11px] font-bold text-zinc-600">{selectedNeeds.length || 0}개 선택</div>
              </div>
              <div className={isMissing('필요 보장') ? invalidPanelClass : 'grid gap-2'}>
                <div className="flex flex-wrap gap-2">
                  {polibotNeedOptions.map((need) => (
                    <button
                      key={need}
                      type="button"
                      onClick={() => toggleNeed(need)}
                      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-center text-xs font-black leading-none transition ${selectedNeeds.includes(need) ? 'border-white bg-white text-zinc-950 shadow-sm shadow-white/10' : 'border-white/10 bg-black/20 text-zinc-400 hover:border-white/25 hover:text-zinc-200'}`}
                    >
                      {need}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className={`${fieldClass('필요 보장')} text-xs text-zinc-500`}
                value={form.needs}
                onChange={(event) => setForm((prev) => ({ ...prev, needs: event.target.value }))}
                placeholder="암, 뇌, 심장"
              />
            </div>
            <div className="grid gap-2.5">
              <div className="grid gap-2">
                <label className={labelClass}>
                  목표 월 보험료
                  <input
                    inputMode="decimal"
                    className={fieldClass('예산')}
                    value={form.budget}
                    onChange={(event) => setForm((prev) => ({ ...prev, budget: event.target.value }))}
                    placeholder="예: 40"
                  />
                </label>
                <div className="flex min-w-0 gap-1.5 overflow-x-auto">
                  {polibotTargetPremiumQuickOptions.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, budget: amount }))}
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black transition ${parsePolibotPremiumValue(form.budget) === Number(amount) ? 'border-white bg-white text-zinc-950' : 'border-white/10 bg-black/20 text-zinc-500 hover:border-white/25 hover:text-zinc-200'}`}
                    >
                      {amount}만원
                    </button>
                  ))}
                </div>
              </div>
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
                <PolibotCompanyHint companies={catalogCompanies} selectedCompany={form.company} onOpenKnowledge={onOpenKnowledge} />
              </div>
            </div>
          </div>
        </PanelCard>
      )}

      {step === 2 && (
        <PanelCard title="2. 상세 조건" className="min-w-0 p-4">
          <div className="grid gap-3">
            <div className="grid gap-2.5">
              <DarkSelect label="기존 실손 여부" value={form.existingMedicalPlan} onChange={(value) => setForm((prev) => ({ ...prev, existingMedicalPlan: value }))} options={[{ value: '', label: '미확인' }, { value: '있음', label: '있음' }, { value: '없음', label: '없음' }, { value: '확인 필요', label: '확인 필요' }]} invalid={isMissing('기존 실손 여부')} />
              <label className={labelClass}>현재 납입 보험료<input type="number" min="0" className={fieldClass('현재 보험료')} value={form.existingPremium} onChange={(event) => setForm((prev) => ({ ...prev, existingPremium: event.target.value }))} placeholder="예: 30" /></label>
              <DarkSelect label="병력/고지 이슈" value={form.medicalHistory} onChange={(value) => setForm((prev) => ({ ...prev, medicalHistory: value }))} options={[{ value: '', label: '미확인' }, { value: '없음', label: '없음' }, { value: '있음', label: '있음' }, { value: '확인 필요', label: '확인 필요' }]} invalid={isMissing('병력/고지 이슈')} />
              <DarkSelect label="가족력" value={form.familyHistory} onChange={(value) => setForm((prev) => ({ ...prev, familyHistory: value }))} options={polibotFamilyHistoryOptions} />
              <DarkSelect label="운전 여부" value={form.driving} onChange={(value) => setForm((prev) => ({ ...prev, driving: value }))} options={[{ value: '', label: '미확인' }, { value: '운전함', label: '운전함' }, { value: '운전 안함', label: '운전 안함' }]} />
              <DarkSelect label="갱신형 허용" value={form.renewalPreference} onChange={(value) => setForm((prev) => ({ ...prev, renewalPreference: value }))} options={[{ value: '', label: '미확인' }, { value: '허용', label: '허용' }, { value: '비갱신 선호', label: '비갱신 선호' }, { value: '상관 없음', label: '상관 없음' }]} />
            </div>
            <DarkSelect label="가입 목적" value={form.purpose} onChange={(value) => setForm((prev) => ({ ...prev, purpose: value }))} options={[{ value: '', label: '미확인' }, { value: '보장 강화', label: '보장 강화' }, { value: '보험료 절감', label: '보험료 절감' }, { value: '리모델링', label: '리모델링' }, { value: '신규 가입', label: '신규 가입' }]} />
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-bold leading-relaxed text-zinc-500">
              {premiumHint}
            </div>
          </div>
        </PanelCard>
      )}

      {step === 3 && (
        <div className="grid min-w-0 gap-3">
          <PanelCard title="3. 상품 추천" className="min-w-0 p-4">
            {hasRecommendations ? (
              <PolibotRecommendationList
                recommendations={recommendations}
                saveMemo={saveMemo}
                onMemoChange={setSaveMemo}
                onSelect={setSelectedRecommendation}
                saving={saving}
                canGenerate={canGenerate}
                usage={usage}
                onGenerate={save}
                showGenerate
                testMode
              />
            ) : (
              <div className="grid gap-3">
                <PolibotRecommendationEmptyState
                  workspace={workspace}
                  hasAnalysis={hasAnalysis}
                  catalogCompanies={catalogCompanies}
                  onOpenDetails={() => onStepChange(2)}
                  onOpenKnowledge={onOpenKnowledge}
                  showDetailAction={false}
                />
                <PolibotGenerateButton saving={saving} canGenerate={canGenerate} usage={usage} onGenerate={save} />
              </div>
            )}
          </PanelCard>
        </div>
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
      <SimpleInfoList items={[
        `필요 보장: ${(draft.needs || profileNeeds || []).join(', ') || '미입력'}`,
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

function PolibotCompanyHint({ companies = [], selectedCompany = '전체 보험사', onOpenKnowledge }) {
  if (!companies.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-xs leading-relaxed text-zinc-500">
        보험사 자료가 아직 분류되지 않았어요.{' '}
        <button type="button" onClick={onOpenKnowledge} className="font-black text-zinc-200 underline decoration-white/20 underline-offset-4 hover:text-white">
          자료 확인
        </button>
        에서 상품 자료를 먼저 올려주세요.
      </div>
    );
  }
  const preview = companies.slice(0, 5);
  return (
    <div className="grid gap-2 rounded-2xl bg-black/20 px-3 py-2">
      <div className="text-[11px] font-bold leading-relaxed text-zinc-500">
        {selectedCompany === '전체 보험사'
          ? `자료에서 확인된 보험사 ${companies.length}개 전체를 대상으로 봅니다.`
          : `${selectedCompany} 자료 안에서만 추천 후보를 찾습니다.`}
      </div>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto">
        {preview.map((company) => (
          <span key={company} className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black ${selectedCompany === company ? 'border-white bg-white text-zinc-950' : 'border-white/10 text-zinc-500'}`}>
            {company}
          </span>
        ))}
        {companies.length > preview.length && (
          <span className="shrink-0 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-black text-zinc-600">+{companies.length - preview.length}</span>
        )}
      </div>
    </div>
  );
}

function PolibotGenerateButton({ saving, canGenerate, usage, onGenerate }) {
  return (
    <div className="grid min-w-0 gap-2 rounded-2xl border border-white/10 bg-black/20 p-2.5">
      <DarkButton size="sm" onClick={onGenerate} disabled={!canGenerate}>
        {saving ? '분석 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : '추천 초안 만들기'}
      </DarkButton>
      {usage.remaining <= 0 && <Notice>사용 가능 횟수가 남아 있지 않아요. 결제 또는 권한 조정 후 다시 실행할 수 있어요.</Notice>}
    </div>
  );
}

function PolibotRecommendationList({ recommendations, saveMemo, onMemoChange, onSelect, saving, canGenerate, usage, onGenerate, showGenerate = false, testMode = false }) {
  const recommendationState = recommendations.some((item) => (item.cautions || []).length > 0 || item.recommendationStatus === 'needs_review')
    ? '확인 필요 추천'
    : '추천 후보';
  return (
    <div className="grid gap-3">
      <div className="rounded-2xl bg-black/25 px-4 py-3">
        <div className="text-sm font-black text-zinc-100">{testMode ? recommendationState : '추천 후보'} {recommendations.length}개</div>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">카드를 눌러 근거와 주의 조건을 확인한 뒤 고객목록에 저장하세요.</p>
      </div>
      <div className="grid gap-2">
        {recommendations.map((item) => (
          <button key={item.id} type="button" onClick={() => onSelect(item)} className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-left transition hover:border-white/20 hover:bg-white/5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">{item.type === 'bundle' ? '조합 추천' : '단품 추천'}</div>
                <div className="mt-1 break-keep text-sm font-black text-zinc-100">{item.name}</div>
                {!testMode && <div className="mt-1 text-[11px] font-bold text-zinc-600">확신도 {item.confidence?.level || '보통'} · 점수 {item.score || '-'}</div>}
              </div>
              <ChevronRight size={18} className="mt-1 shrink-0 text-zinc-600" />
            </div>
            <div className="mt-3 grid gap-1 text-xs leading-relaxed text-zinc-500">
              {item.coverageGap && <div>핵심 보완: {item.coverageGap}</div>}
              {testMode && <div>보험료: {item.premium || '보험료 자료 없음'}</div>}
              {testMode && item.additionalBudgetMemo && <div>예산 기준: {item.additionalBudgetMemo}</div>}
              {item.feedback && <div className="text-zinc-400">피드백: {item.feedback}{item.feedbackReason ? ` · ${item.feedbackReason}` : ''}</div>}
              {((item.cautions || []).length > 0 || !testMode) && (
                <div className="rounded-xl border border-amber-400/20 bg-amber-950/10 px-3 py-2 font-black text-amber-100/90">
                  주의 조건: {(item.cautions || [])[0] || '고지사항과 기존 보험 중복 여부 확인'}
                </div>
              )}
              {!testMode && (item.confidence?.reasons || []).slice(0, 2).map((reason) => (
                <div key={reason}>확인 메모: {reason}</div>
              ))}
              {testMode && item.confidence?.level === '낮음' && <div className="text-zinc-600">자료 신뢰도 확인 필요</div>}
            </div>
          </button>
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
      <div className="max-w-[70%] text-right text-xs font-black leading-relaxed text-zinc-200">{value}</div>
    </div>
  );
}

function PolibotRecommendationModal({ recommendation, profile, onClose, onSave, onFeedback, testMode = false }) {
  const [feedback, setFeedback] = useState(recommendation.feedback || '');
  const [feedbackReason, setFeedbackReason] = useState(recommendation.feedbackReason || '');
  const [feedbackMemo, setFeedbackMemo] = useState(recommendation.feedbackMemo || '');
  const [savingFeedback, setSavingFeedback] = useState(false);
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
        <div className="flex items-start justify-between gap-3">
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
              ['검토 이유', recommendation.headline || recommendation.reason || '고객 조건과 근거 자료가 맞는 조합이에요.'],
              ['확인 조건', (recommendation.cautions || [])[0] || '고지사항과 기존 보험 중복 여부를 확인해 주세요.'],
              ['보류 여부', recommendation.confidence?.level === '낮음' ? '확신도가 낮아 추가 확인 후 검토가 필요해요.' : '즉시 검토 가능한 추천 초안이에요.']
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
            <AccountInfoRow label="필요 보장" value={(profile?.needs || []).join(', ') || '미입력'} />
            <AccountInfoRow label="보완 포인트" value={recommendation.coverageGap || '-'} />
            <AccountInfoRow label="보험료 메모" value={recommendation.premium || '-'} />
            {testMode && <AccountInfoRow label="예산 기준" value={recommendation.additionalBudgetMemo || '-'} />}
            <AccountInfoRow label="주의 조건" value={(recommendation.cautions || []).join(', ') || '추가 확인 필요'} />
            {!testMode && <AccountInfoRow label="추천 확신도" value={`${recommendation.confidence?.level || '보통'}${recommendation.confidence?.reasons?.length ? ` · ${recommendation.confidence.reasons.join(', ')}` : ''}`} />}
            {testMode && recommendation.confidence?.level === '낮음' && <AccountInfoRow label="자료 신뢰도" value="확인 필요" />}
          </div>
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
                    {(item.disclosureMemo || item.reductionMemo) && (
                      <div>고지/감액: {[item.disclosureMemo, item.reductionMemo].filter(Boolean).join(' · ')}</div>
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
              <SimpleInfoList items={recommendation.excludedCandidates.map((item) => `${item.name} · ${item.reason}`)} />
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
              className="rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm font-black text-zinc-200 hover:bg-white/5 disabled:opacity-40"
            >
              {savingFeedback ? '피드백 저장 중...' : '피드백 저장'}
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
  const candidateCount = savedCandidates.length || rows.split(/\n|\r/).map((line) => line.trim()).filter(Boolean).filter((line, index) => !(index === 0 && /url|handle|category|followers|팔로워|카테고리/i.test(line))).length;

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
          <p className="mt-3 text-xs leading-relaxed text-zinc-600">CSV, TXT, DOCX 지원</p>
        </div>
        <label className={labelClass}>
          후보 목록
          <textarea
            className={inputClass}
            rows="7"
            value={rows}
            onChange={(event) => setRows(event.target.value)}
          />
        </label>
        <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm text-zinc-500">
          {parsing ? '파일 분석 중...' : `현재 후보 ${candidateCount}개 · 캠페인 선정 기준으로 S/A/B/C/D 링크 분석을 실행해요.`}
        </div>
        <label className={`${labelClass} mt-3`}>파일명<input className={inputClass} value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="infludex_candidates.csv" /></label>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <DarkButton onClick={save} disabled={saving || parsing || (!rows.trim() && candidateFiles.length === 0 && savedCandidates.length === 0)}>{saving ? '저장 중...' : '후보 저장'}</DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={saving || parsing || (savedCandidates.length === 0 && !rows.trim() && !fileName)}>새로 올리기</DarkButton>
        </div>
      </PanelCard>
      {savedCandidates.length > 0 && (
        <PanelCard title="저장된 후보">
          <div className="grid gap-2">
            {savedCandidates.slice(0, 8).map((item) => {
              const followers = Number(item.followerCount || 0);
              const reactions = Number(item.avgLikes || 0) + Number(item.avgComments || 0);
              const engagement = followers > 0 && reactions > 0 ? `반응률 ${((reactions / followers) * 100).toFixed(2)}%` : '지표 보강 필요';
              return (
                <div key={item.id || item.handle || item.url} className="rounded-2xl bg-black/25 px-4 py-3">
                  <div className="text-sm font-black text-zinc-200">{infludexCandidateLabel(item)}</div>
                  <div className="mt-1 text-xs font-bold text-zinc-500">{[item.displayName || item.description, item.category, followers ? `팔로워 ${followers.toLocaleString('ko-KR')}` : '', engagement].filter(Boolean).join(' · ')}</div>
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
  const [scoreHelpOpen, setScoreHelpOpen] = useState(false);
  const usage = workspaceUsage(workspace);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  const results = sortInfludexResults(Array.isArray(workspace.infludexResults) ? workspace.infludexResults : []);
  const scoredResults = results.filter((item) => item.analysisStatus !== 'data_missing' && item.grade);
  const missingResults = results.filter((item) => item.analysisStatus === 'data_missing' || !item.grade);
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
      toast('링크 분석을 완료했어요.', 'success');
    } catch (err) {
      toast(err.message || '링크 분석에 실패했어요.', 'error');
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
      <PanelCard title="링크 분석">
        <ProductUsageStrip usage={usage} />
        <div className="mb-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
          캠페인 선정 기준으로 카테고리 적합도, 반응률, 댓글 비중, 팔로워 규모, 최근 활동성, 광고/협찬 리스크를 합산해 S/A/B/C/D 등급을 매겨요.
        </div>
        {results.length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">전체</div>
              <div className="mt-1 text-xl font-black text-zinc-100">{results.length}</div>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">분석 가능</div>
              <div className="mt-1 text-xl font-black text-emerald-300">{scoredResults.length}</div>
            </div>
            <div className="rounded-2xl bg-black/25 px-3 py-4 text-center">
              <div className="text-xs font-black text-zinc-600">데이터 부족</div>
              <div className="mt-1 text-xl font-black text-amber-300">{missingResults.length}</div>
            </div>
            <button
              type="button"
              onClick={() => setScoreHelpOpen((prev) => !prev)}
              className="rounded-2xl bg-black/25 px-3 py-4 text-center transition hover:bg-white/5"
            >
              <div className="text-xs font-black text-zinc-600">기준</div>
              <div className="mt-1 text-sm font-black text-zinc-200">보기</div>
            </button>
          </div>
        )}
        {scoreHelpOpen && (
          <div className="mb-3 rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-xs leading-relaxed text-zinc-500">
            <div className="font-black text-zinc-300">S/A/B/C/D는 팔로워와 반응 지표가 있을 때만 매겨요.</div>
            <div className="mt-1">지표가 없는 후보는 낮은 점수로 처리하지 않고 “데이터 부족”으로 분리합니다.</div>
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
          <DarkButton onClick={analyze} disabled={analyzing || candidates.length === 0 || usage.remaining <= 0}>
            {analyzing ? '분석 중...' : usage.remaining <= 0 ? '남은 횟수 없음' : `후보 ${candidates.length}개 분석`}
          </DarkButton>
          <DarkButton variant="ghost" onClick={reset} disabled={analyzing || (candidates.length === 0 && results.length === 0)}>초기화</DarkButton>
        </div>
      </PanelCard>
      <PanelCard title="분석 결과">
        {results.length === 0 ? (
          <Notice>후보를 저장하고 링크 분석을 실행하면 결과가 표시돼요.</Notice>
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
                  <span>반응률 {item.engagementRate ?? 0}%</span>
                  <span>댓글 비중 {item.commentShare ?? 0}%</span>
                  {item.recentPostAt && <span>최근 {item.recentPostAt}</span>}
                  {item.adMemo && <span className="text-amber-400">광고 메모 있음</span>}
                </div>
                <div className="mt-2 text-xs leading-relaxed text-zinc-600">{(item.gradeReason || item.reasons || []).join(' · ')}</div>
                {item.riskFlags?.length > 0 && <div className="mt-2 text-[11px] font-bold text-amber-400">{item.riskFlags.map(infludexRiskLabel).join(' · ')}</div>}
              </div>
            ))}
            {missingResults.length > 0 && (
              <div className="mt-2 rounded-3xl border border-amber-400/20 bg-amber-400/5 p-3">
                <div className="mb-2 text-sm font-black text-amber-200">데이터 부족 후보 {missingResults.length}개</div>
                <div className="grid gap-2">
                  {missingResults.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-black/25 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-zinc-200">{infludexCandidateLabel(item)}</div>
                          <div className="mt-0.5 truncate text-xs text-zinc-500">{[item.displayName || item.description, item.category].filter(Boolean).join(' · ') || '설명 보강 필요'}</div>
                        </div>
                        <span className="shrink-0 rounded-full border border-amber-400/20 px-2.5 py-1 text-[11px] font-black text-amber-200">데이터 부족</span>
                      </div>
                      {item.contactMemo && <div className="mt-2 text-xs font-bold text-zinc-500">문의 {item.contactMemo}</div>}
                      <div className="mt-2 text-[11px] font-bold text-amber-300">{(item.riskFlags || []).map(infludexRiskLabel).join(' · ') || '팔로워/반응 지표 보강 필요'}</div>
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
  const results = sortInfludexResults(Array.isArray(workspace.infludexResults) ? workspace.infludexResults : []);

  useEffect(() => {
    api.get('/api/product-workspace/infludex')
      .then((data) => setWorkspace(data || {}))
      .catch((err) => toast(err.message || '다운로드 데이터를 불러오지 못했어요.', 'error'));
  }, [toast]);

  const downloadCsv = () => {
    const header = ['analysisStatus', 'url', 'handle', 'displayName', 'category', 'grade', 'score', 'followers', 'avgLikes', 'avgComments', 'engagementRate', 'commentShare', 'recentPostAt', 'contactMemo', 'adMemo', 'scoreBreakdown', 'riskFlags', 'reasons'];
    const rows = results.map((item) => [
      item.analysisStatus || 'scored',
      item.url,
      item.handle,
      item.displayName || item.description,
      item.category,
      item.grade,
      item.score,
      item.followerCount,
      item.avgLikes,
      item.avgComments,
      item.engagementRate,
      item.commentShare,
      item.recentPostAt,
      item.contactMemo,
      item.adMemo,
      item.scoreBreakdown ? Object.entries(item.scoreBreakdown).map(([key, value]) => `${key}:${value}`).join(' | ') : '',
      item.riskFlags?.map(infludexRiskLabel).join(' | '),
      (item.gradeReason || item.reasons)?.join(' | ')
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
            <DarkButton type="button" variant="ghost" size="sm" className="h-full min-h-11 w-full justify-center whitespace-nowrap px-3" onClick={saveHandle} disabled={savingHandle || !account?.id}>
              <CheckCircle2 size={15} />
              {savingHandle ? '저장 중...' : '저장'}
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
            onClick={threadsOAuthReady ? connectThreads : requestThreadsRegistration}
            disabled={connecting || requestingThreads || savingHandle || !account?.id}
          >
            <Link2 size={15} />
            {connecting ? '이동 중...' : requestingThreads ? '요청 중...' : actionLabel}
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
            Meta 등록이 완료됐습니다. Meta 웹 승인 초대를 수락한 뒤 연결을 마무리해 주세요.
          </Notice>
        )}
        {connected && (
          <DarkButton type="button" variant="ghost" size="sm" onClick={() => reloadAccounts?.()}>
            <RefreshCw size={15} />
            연결 상태 새로고침
          </DarkButton>
        )}
      </div>
    </details>
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
          <DarkButton type="button" variant="ghost" size="sm" onClick={accountCreation?.open} disabled={!accountCreation?.canAdd || accountCreation?.adding}>
            <Plus size={15} />
            {accountCreation?.adding ? '추가 중...' : '새 채널 추가'}
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
          <DarkButton type="button" variant="ghost" size="sm" onClick={requestSetup} disabled={requestingSetup}>
            <Settings size={15} />
            {requestingSetup ? '요청 중...' : '관리자 셋업 요청'}
          </DarkButton>
        </div>
      </details>

      <DarkButton type="button" onClick={save} disabled={saving}>
        <CheckCircle2 size={16} />
        {saving ? '저장 중...' : '설정 저장'}
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
              <DarkButton type="button" onClick={runAuvibot} disabled={running}>
                {running ? '처리 중...' : '자동화 시작'}
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
    <div className="grid gap-2 sm:grid-cols-2">
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

function sublogId() {
  return crypto?.randomUUID?.() || `sublog-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
  const accountStorageKey = useMemo(() => {
    const accountKey = String(currentUser?.email || currentUser?.userId || 'unknown').trim().toLowerCase() || 'unknown';
    return `${sublogStorageKeyPrefix}:${accountKey}`;
  }, [currentUser?.email, currentUser?.userId]);
  const skipNextStorageWriteRef = useRef(false);
  const [items, setItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(accountStorageKey) || '[]');
    } catch {
      return [];
    }
  });
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

  useEffect(() => {
    skipNextStorageWriteRef.current = true;
    try {
      setItems(JSON.parse(localStorage.getItem(accountStorageKey) || '[]'));
    } catch {
      setItems([]);
    }
    const savedReminderDays = Number(localStorage.getItem(`${accountStorageKey}:reminder_days`));
    setReminderDays(Number.isFinite(savedReminderDays) && savedReminderDays >= 0 ? savedReminderDays : 3);
  }, [accountStorageKey]);

  useEffect(() => {
    if (skipNextStorageWriteRef.current) {
      skipNextStorageWriteRef.current = false;
      return;
    }
    localStorage.setItem(accountStorageKey, JSON.stringify(items));
  }, [accountStorageKey, items]);

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
  const save = (event) => {
    event.preventDefault();
    const amount = Number(String(form.amount).replace(/,/g, ''));
    const name = form.name.trim();
    if (!name || !Number.isFinite(amount) || amount <= 0) return;
    const now = new Date().toISOString();
    const payload = { ...form, name, amount, billingDay: Math.min(31, Math.max(1, Number(form.billingDay) || 1)), memo: form.memo.trim(), updatedAt: now };
    setItems((current) => editingId
      ? current.map((item) => item.id === editingId ? { ...item, ...payload } : item)
      : [{ id: sublogId(), ...payload, createdAt: now }, ...current]);
    closeForm();
  };
  const edit = (item) => {
    setEditingId(item.id);
    setForm({ name: item.name, amount: String(item.amount), currency: item.currency, billingDay: item.billingDay, category: item.category, memo: item.memo || '' });
    setFormOpen(true);
  };
  const remove = (item) => {
    if (window.confirm(`${item.name} 구독을 삭제할까요?`)) setItems((current) => current.filter((row) => row.id !== item.id));
  };
  const applyPreset = (preset) => setForm({ ...form, ...preset, amount: String(preset.amount), billingDay: form.billingDay || 1, memo: '' });
  const addSample = () => setItems((current) => [
    { id: sublogId(), name: 'ChatGPT Plus', amount: 20, currency: 'USD', billingDay: 12, category: 'AI', memo: '업무 보조', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    { id: sublogId(), name: 'YouTube Premium', amount: 14900, currency: 'KRW', billingDay: 21, category: '영상', memo: '광고 없이 보기', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ...current
  ]);
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
            <DarkButton type="button" variant="ghost" onClick={addSample}>예시로 보기</DarkButton>
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
                  <button type="button" onClick={() => remove(item)} className="rounded-full px-2 py-1 text-xs font-black text-zinc-500 hover:bg-white/10 hover:text-red-200">삭제</button>
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
                <DarkButton type="submit">{editingId ? '저장하기' : '구독 추가'}</DarkButton>
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
  if (searchable) {
    return (
      <label className={labelClass}>
        {label}
        <SearchableSelect
          value={value}
          onChange={onChange}
          options={options}
          placeholder={options.find((option) => option.value === value)?.label || '선택'}
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
      <select className={`${inputClass} ${invalid ? invalidFieldClass : ''}`} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
      : tone === 'warning'
        ? 'border-amber-400/20 bg-amber-400/10 text-amber-200'
        : 'border-white/10 bg-white/[0.03] text-zinc-400';
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm leading-relaxed ${className}`}>
      {children}
    </div>
  );
}
