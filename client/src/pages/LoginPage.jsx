import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BarChart3, CalendarClock, CheckCircle2, ChevronRight, Link2, PenLine, Search, ShieldCheck, X } from 'lucide-react';
import { api, getDeviceContext, setAuthToken } from '../lib/api.js';
import { CURRENT_PRODUCT, PRODUCTS, productById, productIdFromPath } from '../config/products.js';

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/30';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';
const infludexMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_INFLUDEX_BETA !== 'true';

function isProductRegistrationOpen(product = null) {
  if (!product?.id) return false;
  if (product?.status === 'preparing' || product?.status === 'inactive') return false;
  if (product?.id === 'infludex') return !infludexMaintenanceEnabled;
  return true;
}

const productDetailContent = {
  cujasa: {
    headline: '쿠팡 파트너스, 이제 자동으로',
    intro: '주제 선정, 상품 검색, 글 작성, 예약 업로드, 성과 확인을 한곳에서 관리합니다.',
    previewTitle: 'CUJASA 운영 현황',
    rows: [['오늘의 추천 주제', '봄철 집정리 아이템', '준비 완료'], ['상품 자동 매칭', '쿠팡 실상품 8개', '연결됨'], ['Threads 예약 큐', '오후 8:30 발행', '대기 중']],
    bestFor: ['쿠팡 파트너스 글을 매일 올려야 하는 운영자', 'Threads 계정을 여러 개 관리하는 팀', '상품 검색과 링크 삽입 시간을 줄이고 싶은 계정'],
    outputs: ['주제별 포스팅 초안', '쿠팡 실상품과 추적 링크', '예약 큐와 클릭 성과'],
    whyTitle: '왜 쿠자사를 써야 하나',
    problems: [
      { title: '매일 상품을 다시 찾음', body: '주제에 맞는 쿠팡 상품을 검색하고 링크를 붙이는 시간이 계속 쌓입니다.' },
      { title: '글쓰기와 업로드가 끊김', body: '콘텐츠 작성, 예약, Threads 업로드가 수동이면 운영 리듬이 쉽게 무너집니다.' },
      { title: '성과 확인이 흩어짐', body: '어떤 주제와 상품이 반응을 만드는지 한 화면에서 보기 어렵습니다.' }
    ],
    flowTitle: '주제 선정부터 업로드까지',
    flow: [
      { icon: Search, title: '주제 선정', body: '계정별 타깃과 톤에 맞는 운영 주제를 잡습니다.' },
      { icon: Link2, title: '상품 매칭', body: '쿠팡 상품과 파트너스 추적 링크를 콘텐츠에 연결합니다.' },
      { icon: PenLine, title: '콘텐츠 작성', body: 'Threads에 맞는 짧은 문장과 상품 구성을 생성합니다.' },
      { icon: CalendarClock, title: '예약 업로드', body: '큐에 넣은 콘텐츠를 운영 시간표에 맞춰 발행합니다.' },
      { icon: BarChart3, title: '성과 확인', body: '클릭과 포스팅 성과를 계정별로 확인합니다.' }
    ],
    plans: [
      { title: '베이직 월정액', price: '129,000원 / 월', badge: '추천', featured: true, features: ['Threads 계정 2개', '광고 없는 운영', '셋업·재연결 지원'] },
      { title: '프로 1년 이용', price: '590,000원', originalPrice: '990,000원', discount: '40% 할인', badge: '1년 이용', features: ['Threads 계정 4개', '일시불 이용', '1년 운영 셋업'] }
    ]
  },
  dexor: {
    headline: '블로그 후보 선정, 데이터로 빠르게',
    intro: '블로그 등급, 키워드 적합도, 운영 지표를 한 화면에서 보고 캠페인 후보를 빠르게 좁힙니다.',
    previewTitle: 'DEXOR 분석 현황',
    rows: [['후보 블로그', '인테리어 리뷰 채널', '분석 완료'], ['적합도 점수', 'A등급 · 87점', '추천'], ['검토 큐', '12개 후보 비교', '진행 중']],
    bestFor: ['블로그 체험단 후보를 빠르게 걸러야 하는 팀', '선정 기준을 운영자마다 다르게 두고 싶지 않은 조직', '후보 수가 많아 엑셀 검토가 느린 캠페인'],
    outputs: ['블로그 등급과 적합도', '후보 우선순위', '캠페인별 비교 기준'],
    whyTitle: '왜 덱서를 써야 하나',
    problems: [
      { title: '후보 검토 시간이 김', body: '블로그 지표와 콘텐츠 성향을 직접 확인하면 선정 시간이 길어집니다.' },
      { title: '기준이 사람마다 다름', body: '운영자별 판단 차이로 캠페인 후보 품질이 흔들릴 수 있습니다.' },
      { title: '대량 비교가 어려움', body: '여러 후보를 같은 기준으로 정렬하고 비교하는 화면이 필요합니다.' }
    ],
    flowTitle: '후보 입력부터 선정까지',
    flow: [
      { icon: Search, title: '후보 수집', body: '검토할 블로그 후보를 입력하거나 목록으로 정리합니다.' },
      { icon: BarChart3, title: '지표 분석', body: '등급, 적합도, 운영 신호를 같은 기준으로 계산합니다.' },
      { icon: CheckCircle2, title: '후보 선정', body: '캠페인 조건에 맞는 후보를 우선순위로 정렬합니다.' }
    ],
    plans: [
      { title: '라이트 충전', price: '5,000원', badge: '10회', features: ['블로그 분석 10회', '테스트용 분석', '가상계좌 충전'] },
      { title: '베이직 충전', price: '10,000원', badge: '추천', featured: true, features: ['블로그 분석 25회', '반복 검토용', '낮은 회당 비용'] },
      { title: '프로 충전', price: '50,000원', badge: '대량 검토', features: ['블로그 분석 150회', '캠페인 후보 대량 선별', '운영팀용'] }
    ]
  },
  spread: {
    headline: '추천 캠페인 운영을 한 화면에서',
    intro: '캠페인 생성, 신청자 정리, 제출물 확인, 운영 리포트를 한곳에서 관리합니다.',
    previewTitle: 'SPREAD 캠페인 현황',
    rows: [['진행 캠페인', '신제품 리뷰 모집', '모집 중'], ['신청자 정리', '42명 후보', '분류 완료'], ['제출물 검수', '18건 대기', '확인 필요']],
    bestFor: ['추천 캠페인을 반복 운영하는 브랜드', '신청자와 제출물 상태가 여러 채널에 흩어진 팀', '무료로 캠페인 운영 자동화를 먼저 검증하려는 운영자'],
    outputs: ['캠페인 초안', '신청자 정리 목록', '제출물 상태와 운영 리포트'],
    whyTitle: '왜 스프레드를 써야 하나',
    problems: [
      { title: '신청자 정리가 반복됨', body: '신청자 정보, 조건, 제출 상태를 수동으로 맞추는 시간이 큽니다.' },
      { title: '제출물 확인이 흩어짐', body: '링크와 상태가 여러 채널에 분산되면 마감 관리가 어려워집니다.' },
      { title: '성과 보고가 늦어짐', body: '캠페인별 현황을 매번 다시 정리하면 운영 속도가 떨어집니다.' }
    ],
    flowTitle: '캠페인 생성부터 리포트까지',
    flow: [
      { icon: PenLine, title: '캠페인 생성', body: '모집 조건과 안내 문구를 정리합니다.' },
      { icon: Search, title: '신청자 정리', body: '후보 정보를 기준별로 분류하고 검토합니다.' },
      { icon: CheckCircle2, title: '제출물 확인', body: '제출 링크와 상태를 한 화면에서 관리합니다.' },
      { icon: BarChart3, title: '운영 리포트', body: '캠페인 결과와 누락 항목을 빠르게 확인합니다.' }
    ],
    plans: [
      { title: '무료 운영', price: '무료', badge: '오픈', featured: true, features: ['캠페인 초안 생성', '신청자 기본 정리', '제출물 검수'] },
      { title: '운영 확장', price: '무료', badge: '테스트', features: ['추천/선정 자동화', '운영 현황 확인', '워크스페이스 제공'] },
      { title: '팀 운영', price: '무료', badge: '상담', features: ['팀 단위 캠페인', '운영 리포트', '셋업 지원'] }
    ]
  },
  polibot: {
    headline: '보험 상담과 추천을 구조화',
    intro: '고객 상담 맥락, 보장분석 자료, 추천 근거를 정리해 상담자가 다음 액션을 빠르게 판단하게 합니다.',
    previewTitle: 'POLIBOT 상담 현황',
    rows: [['고객 프로필', '30대 직장인', '입력 완료'], ['보장 분석', '실손·암 진단비 확인', '검토 완료'], ['추천 근거', '부족 보장 3건', '작성됨']],
    bestFor: ['보험 상담 내용을 구조화해야 하는 설계사', '고객별 추천 근거를 남겨야 하는 팀', '상담 이력과 보장분석 자료를 함께 보는 조직'],
    outputs: ['고객 프로필 요약', '부족 보장 체크', '추천 근거와 상담 히스토리'],
    whyTitle: '왜 폴리봇을 써야 하나',
    problems: [
      { title: '상담 맥락이 길어짐', body: '고객 정보와 기존 보장을 매번 다시 정리하면 상담 속도가 느려집니다.' },
      { title: '추천 근거가 약해짐', body: '근거가 문서화되지 않으면 고객 설득과 내부 검토가 어려워집니다.' },
      { title: '히스토리 관리가 어려움', body: '고객별 상담 이력과 추천 결과를 이어서 보기 위한 구조가 필요합니다.' }
    ],
    flowTitle: '프로필 입력부터 추천 근거까지',
    flow: [
      { icon: PenLine, title: '고객 정보 입력', body: '나이, 직업, 기존 보장 등 상담 맥락을 정리합니다.' },
      { icon: Search, title: '보장 분석', body: '부족한 보장과 확인이 필요한 항목을 구분합니다.' },
      { icon: CheckCircle2, title: '상품 추천', body: '추천 방향과 근거를 상담자가 확인할 수 있게 정리합니다.' }
    ],
    plans: [
      { title: '베이직', price: '79,000원 / 월', badge: '추천', featured: true, features: ['월 보장분석 50회', '고객별 히스토리', '추천 근거 정리'] },
      { title: '프로 1년 이용', price: '590,000원', originalPrice: '990,000원', discount: '40% 할인', badge: '1년 이용', features: ['상담/추천 1년 이용', '팀 단위 운영', '우선 지원'] }
    ]
  },
  infludex: {
    headline: '인플루언서 후보를 빠르게 분석',
    intro: '인스타그램 후보의 등급, 적합도, 리스크를 후보 1명 단위로 분석해 캠페인 선정 시간을 줄입니다.',
    previewTitle: 'INFLUDEX 분석 현황',
    rows: [['후보 계정', '@daily.creator', '분석 완료'], ['캠페인 적합도', 'B+ · 78점', '검토'], ['리스크 신호', '급성장 패턴 확인', '주의']],
    bestFor: ['인스타그램 후보를 대량 검토하는 캠페인 팀', '팔로워 수만으로 선정하기 어려운 브랜드', '협업 전 리스크 신호를 먼저 확인하려는 운영자'],
    outputs: ['후보별 등급', '캠페인 적합도', '리스크 체크 결과'],
    whyTitle: '왜 인플루덱스를 써야 하나',
    problems: [
      { title: '후보 계정 검토가 느림', body: '팔로워 수만으로는 캠페인 적합도와 리스크를 판단하기 어렵습니다.' },
      { title: '비교 기준이 흔들림', body: '후보를 같은 기준으로 점수화해야 선정 품질이 일정해집니다.' },
      { title: '리스크 발견이 늦음', body: '협업 전 계정 신호를 미리 확인해야 운영 리스크를 줄일 수 있습니다.' }
    ],
    flowTitle: '계정 입력부터 리스크 확인까지',
    flow: [
      { icon: Search, title: '계정 입력', body: '검토할 인스타그램 후보 계정을 등록합니다.' },
      { icon: BarChart3, title: '등급 분석', body: '적합도와 운영 신호를 기준별로 계산합니다.' },
      { icon: ShieldCheck, title: '리스크 확인', body: '주의가 필요한 계정 신호를 검토합니다.' }
    ],
    plans: [
      { title: '라이트 분석', price: '5,000원', badge: '30회', features: ['후보 분석 30회', '등급/리스크 확인', '가상계좌 충전'] },
      { title: '베이직 분석', price: '10,000원', badge: '추천', featured: true, features: ['후보 분석 100회', '캠페인 후보 비교', '반복 선별용'] },
      { title: '프로 분석', price: '50,000원', badge: '대량 검토', features: ['후보 분석 250회', '대량 후보 등급 분석', '운영팀용'] }
    ]
  },
  sublog: {
    headline: '구독 비용을 놓치지 않게 관리',
    intro: '반복 결제되는 도구, 서비스, 계정 비용과 갱신 시점을 한 화면에서 확인합니다.',
    previewTitle: 'SUBLOG 비용 현황',
    rows: [['다가오는 결제', '디자인 툴 · 5월 25일', '예정'], ['비용 분류', '마케팅/운영/개발', '정리됨'], ['절감 후보', '중복 구독 2건', '확인 필요']],
    bestFor: ['구독형 SaaS 지출이 늘어난 팀', '결제일과 담당자를 한곳에 묶고 싶은 운영자', '중복 구독과 불필요한 비용을 줄이고 싶은 조직'],
    outputs: ['구독 비용 목록', '다가오는 결제 일정', '절감 후보'],
    whyTitle: '왜 서브로그를 써야 하나',
    problems: [
      { title: '반복 결제를 놓침', body: '소액 구독이 많아질수록 갱신일과 담당자 확인이 어려워집니다.' },
      { title: '비용 분류가 흐려짐', body: '서비스별 목적과 비용 센터가 정리되지 않으면 지출 판단이 늦어집니다.' },
      { title: '중복 구독을 찾기 어려움', body: '비슷한 도구가 여러 계정으로 결제되면 절감 기회를 놓칩니다.' }
    ],
    flowTitle: '구독 등록부터 절감 후보까지',
    flow: [
      { icon: PenLine, title: '구독 등록', body: '서비스명, 결제일, 금액, 담당자를 정리합니다.' },
      { icon: CalendarClock, title: '갱신 알림', body: '다가오는 결제와 확인이 필요한 항목을 표시합니다.' },
      { icon: BarChart3, title: '비용 분석', body: '카테고리별 지출과 절감 후보를 확인합니다.' }
    ],
    plans: [
      { title: '개인 관리', price: '준비 중', badge: '소규모', features: ['기본 구독 관리', '결제일 확인', '비용 분류'] },
      { title: '팀 관리', price: '준비 중', badge: '추천', featured: true, features: ['팀 구독 관리', '담당자 지정', '절감 후보 확인'] },
      { title: '운영 관리', price: '준비 중', badge: '확장', features: ['조직 단위 비용 관리', '리포트', '우선 지원'] }
    ]
  },
  auvibot: {
    headline: '상품 쇼츠 생산을 자동화',
    intro: '상품 정보, 이미지, 스크립트, 업로드 준비를 연결해 쇼츠 제작 시간을 줄입니다.',
    previewTitle: 'AUVIBOT 제작 현황',
    rows: [['상품 소스', '생활용품 12개', '수집 완료'], ['스크립트 생성', '후킹 문구 36개', '작성됨'], ['업로드 큐', '오후 7:00 예약', '대기 중']],
    bestFor: ['상품 쇼츠를 반복 제작하는 커머스 계정', '상품별 후킹 문구를 빠르게 뽑아야 하는 팀', '업로드 큐와 성과를 함께 관리하려는 운영자'],
    outputs: ['상품별 쇼츠 초안', '후킹 문구와 장면 구성', '예약 큐와 성과 기록'],
    whyTitle: '왜 오비봇을 써야 하나',
    problems: [
      { title: '상품 영상 제작이 반복됨', body: '상품마다 소재 정리, 문구 작성, 영상 구성을 반복하면 시간이 많이 듭니다.' },
      { title: '업로드 리듬이 끊김', body: '쇼츠 운영은 꾸준한 생산과 예약이 유지되어야 합니다.' },
      { title: '성과 비교가 어려움', body: '어떤 상품과 후킹 문구가 반응을 만드는지 정리해야 다음 제작이 쉬워집니다.' }
    ],
    flowTitle: '상품 수집부터 쇼츠 큐까지',
    flow: [
      { icon: Search, title: '상품 수집', body: '제작할 상품 정보를 정리합니다.' },
      { icon: PenLine, title: '스크립트 생성', body: '짧은 쇼츠용 후킹 문구와 장면 구성을 만듭니다.' },
      { icon: CalendarClock, title: '예약 큐', body: '생성된 초안을 업로드 일정에 맞춰 관리합니다.' },
      { icon: BarChart3, title: '성과 확인', body: '반응이 좋은 상품과 문구를 다음 제작에 반영합니다.' }
    ],
    plans: [
      { title: '스타터', price: '준비 중', badge: '테스트', features: ['상품 쇼츠 초안', '기본 스크립트', '예약 큐'] },
      { title: '베이직', price: '준비 중', badge: '추천', featured: true, features: ['반복 생성', '성과 확인', '운영 셋업'] },
      { title: '프로', price: '준비 중', badge: '확장', features: ['대량 상품 운영', '리포트', '우선 지원'] }
    ]
  }
};

function detailForProduct(productId) {
  return productDetailContent[productId] || productDetailContent.cujasa;
}

export default function LoginPage({ onLogin }) {
  const params = new URLSearchParams(window.location.search);
  const pathProduct = productIdFromPath(window.location.pathname);
  const requestedMode = params.get('mode') === 'register' ? 'register' : 'login';
  const registrationProducts = PRODUCTS.filter(isProductRegistrationOpen);
  const fallbackProduct = registrationProducts[0] || CURRENT_PRODUCT || PRODUCTS.find((product) => product?.id) || { id: 'cujasa', name: 'CUJASA', supportLabel: '쿠팡 파트너스 자동화', description: '쿠팡 파트너스 자동화 콘솔' };
  const requestedProductConfig = productById(params.get('product')) || productById(pathProduct);
  const requestedProduct = isProductRegistrationOpen(requestedProductConfig)
    ? requestedProductConfig.id
    : fallbackProduct.id;
  const requestedEmail = String(params.get('email') || '').trim();
  const [form, setForm] = useState({ email: requestedEmail, password: '' });
  const [registerForm, setRegisterForm] = useState({
    buyerName: '',
    phone: '',
    productId: requestedProduct,
    username: '',
    password: '',
    passwordConfirm: '',
    privacyConsent: false
  });
  const [mode, setMode] = useState(requestedMode);
  const [previewProductId, setPreviewProductId] = useState(requestedProduct);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [coreHealthStatus, setCoreHealthStatus] = useState(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [businessInfoOpen, setBusinessInfoOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(true);
  const formRef = useRef(null);
  const previewProduct = productById(previewProductId) || fallbackProduct;
  const coreDegraded = coreHealthStatus && coreHealthStatus.status !== 'ok';

  useEffect(() => {
    let cancelled = false;
    api.get('/api/core/health')
      .then((health) => {
        if (!cancelled) setCoreHealthStatus(health);
      })
      .catch(() => {
        if (!cancelled) setCoreHealthStatus({ status: 'degraded', message: '현재 데이터베이스 연결이 지연되고 있습니다.' });
      });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/api/auth/login', { ...form, device: getDeviceContext() });
      setAuthToken(result.token);
      onLogin(result);
      ensureBetaHash();
    } catch (err) {
      setError(err.message || '로그인 정보를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    if (coreDegraded) {
      setError('현재 데이터베이스 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.post('/api/auth/register', registerForm);
      setAuthToken(result.token);
      onLogin(result);
      ensureBetaHash();
    } catch (err) {
      setError(err.message || '회원가입 정보를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const toggleMode = () => {
    setMode((prev) => prev === 'login' ? 'register' : 'login');
    setError('');
  };

  const focusAuthPanel = () => {
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const openRegister = (productId = previewProductId) => {
    const targetProduct = isProductRegistrationOpen(productById(productId)) ? productId : fallbackProduct.id;
    setMode('register');
    setPreviewProductId(targetProduct);
    setRegisterForm((prev) => ({ ...prev, productId: targetProduct }));
    setError('');
    setDetailOpen(false);
    focusAuthPanel();
  };

  const openLogin = () => {
    setMode('login');
    setError('');
    setDetailOpen(false);
    focusAuthPanel();
  };

  const selectPreviewProduct = (productId) => {
    setPreviewProductId(productId);
    if (mode === 'register') {
      setRegisterForm((prev) => ({ ...prev, productId }));
    }
  };

  return (
    <div className="min-h-screen bg-[#111111] text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[292px_minmax(0,1fr)]">
        <aside className="hidden border-r border-white/10 bg-[#191919] px-4 py-5 lg:block">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-2">
              <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white">
                <img src="/jasain_logo.png" alt="JASAIN" className="h-full w-full object-cover" />
              </div>
              <div>
                <div className="text-sm font-black">JASAIN</div>
                <div className="text-xs text-zinc-500">워크스페이스 로그인</div>
              </div>
            </div>
            <div className="mt-10 grid gap-2 px-2">
              <div className="text-xs font-black uppercase tracking-wide text-zinc-500">Solutions</div>
              {PRODUCTS.map((product) => {
                const unavailable = !isProductRegistrationOpen(product);
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={unavailable}
                    onClick={() => {
                      selectPreviewProduct(product.id);
                      setDetailOpen(true);
                    }}
                    className={`rounded-xl px-3 py-2 text-left text-sm font-bold outline-none transition ${unavailable ? 'cursor-not-allowed text-zinc-700' : previewProduct.id === product.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300 focus:bg-white/5 focus:text-zinc-300'}`}
                  >
                    {product.name}
                    {unavailable ? <span className="ml-2 text-[10px] text-zinc-600">준비중</span> : null}
                  </button>
                );
              })}
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="text-sm font-black text-zinc-100">{previewProduct.name}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{previewProduct.supportLabel}</div>
                <p className="mt-3 text-xs leading-relaxed text-zinc-400">{previewProduct.description}</p>
                <button type="button" onClick={() => setDetailOpen(true)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 hover:bg-white/10">
                  {previewProduct.name} 상세 보기
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
            <div className="mt-auto border-t border-white/10 pt-4 text-[11px] leading-relaxed text-zinc-600">
              <div className="flex flex-wrap gap-x-2 gap-y-1">
                <button type="button" onClick={() => setPrivacyOpen((prev) => !prev)} className="font-bold hover:text-zinc-300">
                  개인정보처리방침
                </button>
                <span>·</span>
                <button type="button" onClick={() => setBusinessInfoOpen((prev) => !prev)} className="font-bold hover:text-zinc-300">
                  사업자정보
                </button>
              </div>
              <div className="mt-1">© 2026 JASAIN</div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen items-center justify-center px-5 py-10">
          <div ref={formRef} className="w-full max-w-[420px]">
            <AuthPanel
              mode={mode}
              previewProduct={previewProduct}
              form={form}
              registerForm={registerForm}
              registrationProducts={registrationProducts}
              error={error}
              busy={busy}
              coreDegraded={coreDegraded}
              setForm={setForm}
              setRegisterForm={setRegisterForm}
              setPreviewProductId={setPreviewProductId}
              submit={submit}
              submitRegister={submitRegister}
              toggleMode={toggleMode}
            />
          </div>
        </main>
      </div>
      <ProductDetailDrawer product={previewProduct} open={detailOpen} onClose={() => setDetailOpen(false)} onRegister={openRegister} onLogin={openLogin} />
      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
      {businessInfoOpen && <BusinessInfoModal onClose={() => setBusinessInfoOpen(false)} />}
    </div>
  );
}

function ProductDetailDrawer({ product, open, onClose, onRegister, onLogin }) {
  const detail = detailForProduct(product?.id);

  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${open ? 'pointer-events-auto bg-black/45 opacity-100 lg:bg-transparent' : 'pointer-events-none bg-black/0 opacity-0'}`} onMouseDown={onClose}>
      <aside
        className={`absolute inset-y-0 right-0 w-full max-w-[520px] overflow-y-auto rounded-l-[28px] border-l border-white/10 bg-[#191919] p-4 shadow-2xl shadow-black/50 transition-all duration-300 ease-out lg:inset-y-4 lg:right-4 lg:w-[500px] lg:rounded-[28px] lg:border lg:p-5 ${open ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0 lg:translate-x-8'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 -mx-4 -mt-4 border-b border-white/10 bg-[#191919]/95 px-4 py-4 backdrop-blur lg:-mx-5 lg:-mt-5 lg:px-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="inline-flex rounded-full border border-red-500/25 bg-red-500/10 px-3 py-1 text-xs font-black text-red-200">
                {product?.name || 'JASAIN'}
              </div>
              <h2 className="mt-3 text-2xl font-black text-zinc-50">{detail.headline}</h2>
            </div>
            <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-zinc-100">
              <X size={18} />
            </button>
          </div>
          <p className="mt-3 text-sm font-bold leading-6 text-zinc-500">
            {detail.intro}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onRegister(product?.id)} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100">
              무료 시작
              <ArrowRight size={16} />
            </button>
            <button type="button" onClick={onLogin} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-black text-zinc-200 hover:bg-white/10">
              로그인
            </button>
          </div>
        </div>

        <div className="grid gap-4 py-5">
          <ProductConsolePreview detail={detail} />

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mt-3 grid gap-2">
                {detail.bestFor.map((item) => (
                  <div key={item} className="flex gap-2 text-xs font-bold leading-5 text-zinc-400">
                    <CheckCircle2 className="mt-0.5 shrink-0 text-red-200" size={14} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mt-3 grid gap-2">
                {detail.outputs.map((item) => (
                  <div key={item} className="flex gap-2 text-xs font-bold leading-5 text-zinc-400">
                    <CheckCircle2 className="mt-0.5 shrink-0 text-red-200" size={14} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-black/20 p-5">
            <div className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Why {product?.name || 'JASAIN'}</div>
            <h3 className="mt-2 text-xl font-black text-zinc-50">{detail.whyTitle}</h3>
            <div className="mt-4 grid gap-3">
              {detail.problems.map((item, index) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs font-black text-red-200">0{index + 1}</div>
                  <div className="mt-3 text-sm font-black text-zinc-100">{item.title}</div>
                  <p className="mt-1 text-xs font-bold leading-5 text-zinc-500">{item.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#202020] p-5">
            <div className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Automation Flow</div>
            <h3 className="mt-2 text-xl font-black text-zinc-50">{detail.flowTitle}</h3>
            <div className="mt-4 grid gap-2">
              {detail.flow.map((item) => (
                <div key={item.title} className="flex gap-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-zinc-950">
                    <item.icon size={16} />
                  </div>
                  <div>
                    <div className="text-sm font-black text-zinc-100">{item.title}</div>
                    <p className="mt-1 text-xs font-bold leading-5 text-zinc-500">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-3">
            {detail.plans.map((plan) => (
              <article key={plan.title} className={`rounded-[24px] border p-4 ${plan.featured ? 'border-white/20 bg-zinc-100 text-zinc-950' : 'border-white/10 bg-black/20 text-zinc-100'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${plan.featured ? 'bg-zinc-950 text-white' : 'bg-white/10 text-zinc-300'}`}>{plan.badge}</div>
                    <h3 className="mt-3 text-lg font-black">{plan.title}</h3>
                  </div>
                  <div className="grid gap-1 text-right leading-tight">
                    {plan.originalPrice && <span className="text-sm font-black text-zinc-500 line-through">{plan.originalPrice}</span>}
                    {plan.discount && <span className="text-xs font-black text-rose-500">{plan.discount}</span>}
                    <span className="text-lg font-black">{plan.price}</span>
                  </div>
                </div>
                <div className={`mt-4 flex flex-wrap gap-2 text-xs font-bold ${plan.featured ? 'text-zinc-700' : 'text-zinc-400'}`}>
                  {plan.features.map((feature) => (
                    <span key={feature} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${plan.featured ? 'bg-zinc-950/5' : 'bg-white/[0.04]'}`}>
                      <CheckCircle2 size={13} />
                      {feature}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

function ProductConsolePreview({ detail }) {
  return (
    <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#191919] shadow-2xl shadow-black/30">
      <div className="border-b border-white/10 bg-[#202020] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.12em] text-zinc-500">Workspace Preview</div>
            <div className="mt-1 text-lg font-black text-zinc-50">{detail.previewTitle}</div>
          </div>
          <div className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-200">자동화 정상</div>
        </div>
      </div>
      <div className="grid gap-0">
        <div className="divide-y divide-white/10">
          {detail.rows.map(([title, value, status]) => (
            <div key={title} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="text-sm font-black text-zinc-100">{title}</div>
                <div className="mt-1 text-xs font-bold text-zinc-500">{value}</div>
              </div>
              <div className="text-xs font-black text-zinc-400">{status}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AuthPanel({
  mode,
  previewProduct,
  form,
  registerForm,
  registrationProducts,
  error,
  busy,
  coreDegraded,
  setForm,
  setRegisterForm,
  setPreviewProductId,
  submit,
  submitRegister,
  toggleMode
}) {
  return (
    <form onSubmit={mode === 'login' ? submit : submitRegister} className="rounded-[28px] border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xl font-black text-zinc-100">{mode === 'login' ? '워크스페이스 로그인' : `${previewProduct?.name || 'JASAIN'} 시작하기`}</div>
          <div className="mt-1 text-xs text-zinc-500">{mode === 'login' ? '기존 계정으로 로그인해요.' : '계정을 만들고 바로 시작해요.'}</div>
        </div>
        <button type="button" onClick={toggleMode} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-400 hover:bg-white/10 hover:text-white">
          {mode === 'login' ? '회원가입' : '로그인'}
        </button>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-3">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-red-500/10 text-red-200">
            <ShieldCheck size={18} />
          </div>
          <div>
            <div className="text-sm font-black text-zinc-100">{previewProduct?.name || 'JASAIN'} 체험 계정</div>
            <p className="mt-1 text-xs font-bold leading-5 text-zinc-500">가입 후 선택한 솔루션을 바로 확인합니다.</p>
          </div>
        </div>
      </div>

      {mode === 'login' ? (
        <div className="mt-5 grid gap-4">
          <label className={labelClass}>아이디 또는 이메일<input className={inputClass} type="text" autoComplete="username" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} /></label>
          <label className={labelClass}>비밀번호<input className={inputClass} type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} /></label>
        </div>
      ) : (
        <div className="mt-5 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>고객명<input className={inputClass} type="text" autoComplete="name" value={registerForm.buyerName} placeholder="예: 홍길동" onChange={(e) => setRegisterForm((prev) => ({ ...prev, buyerName: e.target.value }))} /></label>
            <label className={labelClass}>연락처<input className={inputClass} type="tel" autoComplete="tel" value={registerForm.phone} placeholder="01012345678" onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))} /></label>
          </div>
          <label className={labelClass}>사용할 솔루션<select className={inputClass} value={registerForm.productId} onChange={(e) => { setRegisterForm((prev) => ({ ...prev, productId: e.target.value })); setPreviewProductId(e.target.value); }}>{registrationProducts.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.supportLabel}</option>)}</select></label>
          <label className={labelClass}>아이디<input className={inputClass} type="text" autoComplete="username" value={registerForm.username} placeholder="영문/숫자 3자 이상" onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>비밀번호<input className={inputClass} type="password" autoComplete="new-password" value={registerForm.password} placeholder="8자 이상" onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))} /></label>
            <label className={labelClass}>비밀번호 확인<input className={inputClass} type="password" autoComplete="new-password" value={registerForm.passwordConfirm} onChange={(e) => setRegisterForm((prev) => ({ ...prev, passwordConfirm: e.target.value }))} /></label>
          </div>
          <label className="flex items-start gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-zinc-500">
            <input className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black text-zinc-100" type="checkbox" checked={registerForm.privacyConsent} onChange={(e) => setRegisterForm((prev) => ({ ...prev, privacyConsent: e.target.checked }))} />
            <span>개인정보 수집 및 이용에 동의해요. 고객명, 연락처, 아이디, 비밀번호 암호화값, 선택 솔루션, 서비스 이용 기록은 회원가입, 계정 보호, 무료체험 제공, 상담 응대, 결제 및 서비스 운영 목적으로 처리됩니다.</span>
          </label>
        </div>
      )}

      {error ? <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-3 text-sm font-bold text-zinc-200">{error}</div> : null}
      <button disabled={busy || (mode === 'register' && (coreDegraded || !registerForm.privacyConsent))} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? '확인 중' : mode === 'login' ? '로그인' : '무료로 시작하기'}
        <ChevronRight size={18} />
      </button>
    </form>
  );
}

function ensureBetaHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('tab') === 'beta') return;
  window.history.replaceState({ tab: 'beta' }, '', `${window.location.pathname}${window.location.search}#tab=beta`);
}

function PrivacyModal({ onClose }) {
  useEscapeClose(onClose);

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
  useEscapeClose(onClose);

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
          <InfoRow label="사업자명" value="이상한 회사" />
          <InfoRow label="대표" value="이상빈" />
          <InfoRow label="사업자등록번호" value="876-28-01550" />
          <InfoRow label="이메일" value="dypapa0309@gmail.com" />
          <InfoRow label="개인정보처리책임자" value="이상빈" />
          <InfoRow label="주소" value="상동로 87 가나베스트타운 803-102" />
        </div>
      </div>
    </div>
  );
}

function useEscapeClose(onClose) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
}

function PolicySection({ title, children }) {
  return (
    <section>
      <div className="text-sm font-black text-zinc-200">{title}</div>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">{children}</p>
    </section>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl bg-black/25 px-4 py-3">
      <span className="shrink-0 text-xs font-bold text-zinc-600">{label}</span>
      <span className="text-right text-sm font-bold text-zinc-200">{value}</span>
    </div>
  );
}
