import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { PRODUCTS, productById } from '../config/products.js';
import { api } from '../lib/api.js';

const productTone = {
  cujasa: { label: 'AUTO', disk: 'bg-[#ef4444]', tab: 'bg-[#fde047]', screen: 'bg-[#111827]' },
  dexor: { label: 'DATA', disk: 'bg-[#2563eb]', tab: 'bg-[#93c5fd]', screen: 'bg-[#0f172a]' },
  spread: { label: 'CAMP', disk: 'bg-[#16a34a]', tab: 'bg-[#bbf7d0]', screen: 'bg-[#052e16]' },
  polibot: { label: 'POLI', disk: 'bg-[#7c3aed]', tab: 'bg-[#ddd6fe]', screen: 'bg-[#1e1b4b]' },
  infludex: { label: 'INFL', disk: 'bg-[#f97316]', tab: 'bg-[#fed7aa]', screen: 'bg-[#431407]' },
  sublog: { label: 'COST', disk: 'bg-[#0891b2]', tab: 'bg-[#a5f3fc]', screen: 'bg-[#083344]' },
  auvibot: { label: 'SHOT', disk: 'bg-[#db2777]', tab: 'bg-[#fbcfe8]', screen: 'bg-[#500724]' }
};

const launchNotes = [
  '필요한 자동화만 골라 바로 시작',
  '셋팅 후 반복 업무를 매일 자동 실행',
  '계정, 콘텐츠, 예약 상태를 한곳에서 관리'
];

const productCopy = {
  cujasa: {
    line: '쿠팡 파트너스 Threads 자동화',
    description: '주제 선정, 상품 매칭, 글 작성, 예약 업로드까지 매일 이어지게 합니다.',
    cta: 'CUJASA 시작하기'
  },
  dexor: {
    line: '블로그 후보 분석 자동화',
    description: '후보 블로그의 등급과 적합도를 빠르게 비교해 캠페인 선정 시간을 줄입니다.',
    cta: 'DEXOR 분석하기'
  },
  spread: {
    line: '추천 캠페인 운영 자동화',
    description: '캠페인 신청자, 제출물, 진행 상태를 한 화면에서 정리합니다.',
    cta: 'SPREAD 시작하기'
  },
  polibot: {
    line: '보험 상담 정리 자동화',
    description: '고객 정보와 보장분석 자료를 정리해 상담 근거를 빠르게 만듭니다.',
    cta: 'POLIBOT 시작하기'
  },
  infludex: {
    line: '인플루언서 후보 분석',
    description: '인스타그램 후보의 적합도와 리스크를 보고 협업 대상을 좁힙니다.',
    cta: 'INFLUDEX 분석하기'
  },
  sublog: {
    line: '구독 비용 관리',
    description: '반복 결제일, 담당자, 비용을 정리해 놓치는 구독을 줄입니다.',
    cta: 'SUBLOG 둘러보기'
  },
  auvibot: {
    line: '상품 쇼츠 생산 자동화',
    description: '상품 정보에서 쇼츠 문구와 업로드 준비까지 반복 제작 흐름을 만듭니다.',
    cta: 'AUVIBOT 보기'
  }
};

function copyFor(product) {
  return productCopy[product.id] || {
    line: product.supportLabel,
    description: product.description,
    cta: `${product.name} 시작하기`
  };
}

function productHref(product) {
  return `/store/${product?.id || 'cujasa'}`;
}

function appLoginHref(productId = 'cujasa', email = '') {
  const params = new URLSearchParams();
  if (productId && productId !== 'cujasa') params.set('product', productId);
  if (email) params.set('email', email);
  const search = params.toString();
  return `https://app.jasain.kr/${search ? `?${search}` : ''}#tab=beta`;
}

const purchaseCatalog = {
  cujasa: {
    title: '쿠팡 파트너스 자동화를 매일 이어가세요',
    intro: 'Threads 계정 연결, 쿠팡 상품 매칭, 글 생성, 예약 업로드를 한 흐름으로 묶어 운영합니다.',
    points: ['Threads 계정별 자동 예약', '쿠팡 파트너스 링크 연결', '셋팅 및 재연결 지원'],
    plans: [
      { id: 'monthly_59000', name: '베이직 월정액', price: '129,000원 / 월', badge: '추천', features: ['Threads 계정 2개', '매일 자동 예약', '초기 셋팅 지원'] },
      { id: 'onetime_590000', name: '프로 영구구매', price: '590,000원', badge: '장기 운영', features: ['Threads 계정 4개', '일시불 이용', '장기 운영 셋팅'] }
    ]
  },
  dexor: {
    title: '블로그 후보를 빠르게 분석하세요',
    intro: '후보 블로그의 등급, 적합도, 검토 우선순위를 계산해 선정 시간을 줄입니다.',
    points: ['블로그 등급 분석', '캠페인 적합도 비교', '후보 우선순위 정리'],
    plans: [
      { id: 'dexor_credit_5000', name: '라이트 분석', price: '5,000원', badge: '10회', features: ['블로그 분석 10회', '소량 테스트', '가상계좌 충전'] },
      { id: 'dexor_credit_10000', name: '베이직 분석', price: '10,000원', badge: '추천', features: ['블로그 분석 25회', '반복 검토', '낮은 회당 비용'] },
      { id: 'dexor_credit_50000', name: '프로 분석', price: '50,000원', badge: '대량', features: ['블로그 분석 150회', '대량 후보 선별', '운영팀용'] }
    ]
  },
  spread: {
    title: '추천 캠페인 운영을 정리하세요',
    intro: '신청자 관리, 제출물 확인, 캠페인 진행 상태를 한곳에서 보는 운영 자동화입니다.',
    points: ['캠페인별 신청자 정리', '제출물 상태 관리', '운영 리포트'],
    plans: [
      { id: 'spread_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['기본 캠페인 운영', '신청자 정리', '제출물 확인'] },
      { id: 'spread_basic_monthly_149000', name: '베이직', price: '149,000원 / 월', badge: '추천', features: ['반복 캠페인 운영', '운영 현황 관리', '리포트'] },
      { id: 'spread_pro_monthly_390000', name: '프로', price: '390,000원 / 월', badge: '팀', features: ['팀 단위 운영', '대량 캠페인', '우선 지원'] }
    ]
  },
  polibot: {
    title: '보험 상담과 추천 근거를 구조화하세요',
    intro: '고객 정보, 보장분석 자료, 추천 근거를 정리해 상담자가 빠르게 판단하게 합니다.',
    points: ['고객 상담 요약', '보장분석 자료 정리', '추천 근거 생성'],
    plans: [
      { id: 'polibot_basic_monthly_99000', name: '베이직', price: '79,000원 / 월', badge: '추천', features: ['월 보장분석 100회', '고객별 히스토리', '추천 근거 정리'] },
      { id: 'polibot_lifetime_590000', name: '프로 영구구매', price: '590,000원', badge: '장기', features: ['장기 이용', '팀 운영', '우선 지원'] }
    ]
  },
  infludex: {
    title: '인플루언서 후보를 숫자로 비교하세요',
    intro: '인스타그램 후보의 적합도와 리스크를 분석해 협업 대상을 빠르게 좁힙니다.',
    points: ['후보 등급 분석', '캠페인 적합도 확인', '리스크 신호 체크'],
    plans: [
      { id: 'infludex_credit_5000', name: '라이트 분석', price: '5,000원', badge: '30회', features: ['후보 분석 30회', '등급/리스크 확인', '가상계좌 충전'] },
      { id: 'infludex_credit_10000', name: '베이직 분석', price: '10,000원', badge: '추천', features: ['후보 분석 100회', '캠페인 후보 비교', '반복 선별'] },
      { id: 'infludex_credit_50000', name: '프로 분석', price: '50,000원', badge: '대량', features: ['후보 분석 250회', '대량 후보 검토', '운영팀용'] }
    ]
  },
  sublog: {
    title: '구독 비용을 놓치지 않게 정리하세요',
    intro: '반복 결제되는 서비스의 결제일, 담당자, 비용을 한 화면에서 관리합니다.',
    points: ['구독 비용 목록화', '다가오는 결제 확인', '중복 구독 점검'],
    plans: [
      { id: 'sublog_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['구독 목록 셋팅', '결제일 정리', '운영 상담'] }
    ]
  },
  auvibot: {
    title: '상품 쇼츠 제작 흐름을 자동화하세요',
    intro: '상품 정보에서 쇼츠 문구, 장면 구성, 업로드 준비까지 반복 제작을 줄입니다.',
    points: ['상품별 쇼츠 초안', '후킹 문구 생성', '업로드 준비 관리'],
    plans: [
      { id: 'auvibot_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['상품 쇼츠 초안', '운영 셋팅', '도입 상담'] }
    ]
  }
};

function catalogFor(productId) {
  return purchaseCatalog[productId] || purchaseCatalog.cujasa;
}

function formatWon(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function loadTossPaymentsScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저에서만 결제를 시작할 수 있습니다.'));
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  const existing = document.querySelector('script[data-toss-payments]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.TossPayments), { once: true });
      existing.addEventListener('error', () => reject(new Error('Toss 결제 스크립트를 불러오지 못했습니다.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.tosspayments.com/v2/standard';
    script.async = true;
    script.dataset.tossPayments = 'true';
    script.onload = () => resolve(window.TossPayments);
    script.onerror = () => reject(new Error('Toss 결제 스크립트를 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
}

async function requestPublicTossPayment(toss) {
  if (toss.clientKey === 'test_ck_dev_placeholder') return { dev: true };
  const TossPayments = await loadTossPaymentsScript();
  const tossPayments = TossPayments(toss.clientKey);
  const payment = tossPayments.payment({ customerKey: toss.customerKey });
  return payment.requestPayment({
    method: toss.method,
    amount: { currency: 'KRW', value: Number(toss.amount) },
    orderId: toss.orderId,
    orderName: toss.orderName,
    successUrl: toss.successUrl,
    failUrl: toss.failUrl
  });
}

function DotFrame({ children, className = '' }) {
  return (
    <div className={`border-2 border-[#111111] bg-[#fffdf2] shadow-[6px_6px_0_#111111] ${className}`}>
      {children}
    </div>
  );
}

function PixelFloppy({ product, index = 0, compact = false }) {
  const tone = productTone[product.id] || productTone.cujasa;
  const diskCode = product.name.slice(0, 8).toUpperCase();
  return (
    <div className="relative aspect-[1.05/1] w-full min-w-0 overflow-hidden border-2 border-[#111111] bg-[#111111] p-1 shadow-[5px_5px_0_rgba(17,17,17,0.28)]">
      <div className={`h-full border-2 border-[#111111] ${tone.disk}`}>
        <div className={`grid grid-cols-[1fr_42%] border-b-2 border-[#111111] bg-[#f9fafb] ${compact ? 'h-6' : 'h-10'}`}>
          <div className="border-r-2 border-[#111111] bg-[#f8fafc]" />
          <div className={tone.screen} />
        </div>
        <div className={compact ? 'p-1.5' : 'p-3'}>
          <div className={`border-2 border-[#111111] bg-[#fffdf2] ${compact ? 'p-1' : 'p-2'}`}>
            <div className="flex items-center justify-between border-b-2 border-dotted border-[#111111] pb-1">
              <span className="font-mono text-[9px] font-black uppercase leading-none text-[#111111]">{tone.label}</span>
              <span className="font-mono text-[9px] font-black leading-none text-[#111111]">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className={compact ? 'mt-1 h-7 min-w-0 overflow-hidden' : 'mt-2 h-12 min-w-0 overflow-hidden'}>
              <div className={`max-w-full truncate font-mono font-black leading-none text-[#111111] ${compact ? 'text-[11px]' : 'text-lg'}`}>{diskCode}</div>
              {!compact && <p className="mt-1 truncate text-[11px] font-bold leading-4 text-[#2f2f2f]">{copyFor(product).line}</p>}
            </div>
          </div>
        </div>
        <div className={`absolute left-1/2 -translate-x-1/2 border-2 border-[#111111] bg-[#e5e7eb] ${compact ? 'bottom-1.5 h-4 w-9' : 'bottom-3 h-8 w-16'}`}>
          <div className={`mx-auto bg-[#111111] ${compact ? 'mt-0.5 h-2 w-5' : 'mt-1 h-4 w-9'}`} />
        </div>
        <div className={`absolute border-2 border-[#111111] ${tone.tab} ${compact ? 'right-1.5 top-9 h-3 w-5' : 'right-3 top-14 h-4 w-8'}`} />
      </div>
    </div>
  );
}

export function PublicTestPage2() {
  return (
    <div className="min-h-screen bg-[#f4e9c7] text-[#111111] [image-rendering:pixelated]">
      <div className="pointer-events-none fixed inset-0 opacity-[0.18]" style={{ backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
      <header className="relative border-b-2 border-[#111111] bg-[#fffdf2] px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <a href="/test-page-2" className="flex items-center gap-3">
            <img src="/jasain_logo.png" alt="JASAIN" className="h-10 w-10 border-2 border-[#111111] bg-white object-cover" />
            <div>
              <div className="font-mono text-lg font-black leading-none">JASAIN.EXE</div>
              <div className="font-mono text-[11px] font-black uppercase text-[#6b5d3d]">자동화 상점</div>
            </div>
          </a>
          <nav className="hidden items-center gap-2 md:flex">
            <a href="#programs" className="border-2 border-[#111111] bg-[#facc15] px-3 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#111111]">제품 보기</a>
            <a href="#buy" className="border-2 border-[#111111] bg-[#8dd8ff] px-3 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#111111]">시작 절차</a>
            <a href="https://app.jasain.kr" className="border-2 border-[#111111] bg-[#fffdf2] px-3 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#111111]">이미 구매했어요</a>
          </nav>
        </div>
      </header>

      <main className="relative">
        <section className="px-4 py-10 md:py-14">
          <div className="mx-auto grid max-w-7xl gap-7 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-end">
            <div>
              <DotFrame className="inline-flex px-3 py-2 font-mono text-xs font-black uppercase text-[#111111]">
                JASAIN automation shop
              </DotFrame>
              <h1 className="mt-5 max-w-4xl break-keep font-mono text-4xl font-black leading-[1.02] text-[#111111] sm:text-5xl md:text-7xl">
                필요한 자동화를 고르고 운영을 시작하세요
              </h1>
              <p className="mt-5 max-w-2xl text-base font-black leading-7 text-[#5f5133] md:text-lg">
                쿠팡 파트너스 포스팅, 블로그 후보 분석, 캠페인 운영처럼 매일 반복되는 일을 제품별로 나눠 자동화합니다.
              </p>
              <div className="mt-6 grid max-w-xl gap-2">
                {launchNotes.map((note) => (
                  <div key={note} className="flex items-center gap-2 font-mono text-sm font-black text-[#111111]">
                    <span className="h-3 w-3 border-2 border-[#111111] bg-[#ef4444]" />
                    {note}
                  </div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#programs" className="inline-flex items-center gap-2 border-2 border-[#111111] bg-[#111111] px-5 py-3 font-mono text-sm font-black text-[#fffdf2] shadow-[5px_5px_0_#facc15]">
                  제품 고르기
                  <ArrowRight size={17} />
                </a>
              </div>
            </div>
            <DotFrame className="p-3">
              <div className="border-2 border-[#111111] bg-[#1f2937] p-3">
                <div className="grid grid-cols-3 gap-2">
                  {PRODUCTS.slice(0, 6).map((product, index) => (
                    <PixelFloppy key={product.id} product={product} index={index} compact />
                  ))}
                </div>
              </div>
            </DotFrame>
          </div>
        </section>

        <section id="programs" className="border-y-2 border-[#111111] bg-[#f8d86a] px-4 py-10">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div>
                <div className="font-mono text-xs font-black uppercase tracking-[0.18em] text-[#6b4f00]">Product shelf</div>
                <h2 className="mt-2 font-mono text-3xl font-black md:text-5xl">자동화 제품을 선택하세요</h2>
              </div>
              <p className="max-w-xl text-sm font-black leading-6 text-[#6b4f00]">각 제품은 목적이 다릅니다. 지금 가장 시간을 많이 쓰는 업무부터 자동화하세요.</p>
            </div>
            <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PRODUCTS.map((product, index) => (
                <a key={product.id} href={productHref(product)} className="group block">
                  <PixelFloppy product={product} index={index} />
                  <div className="mt-4 min-h-40 border-2 border-[#111111] bg-[#fffdf2] p-3 shadow-[4px_4px_0_#111111]">
                    <div className="truncate font-mono text-xl font-black">{product.name}</div>
                    <p className="mt-1 truncate font-mono text-[11px] font-black uppercase text-[#8a6a00]">{copyFor(product).line}</p>
                    <p className="mt-2 min-h-16 break-keep text-sm font-black leading-5 text-[#5f5133]">{copyFor(product).description}</p>
                    <div className="mt-3 inline-flex items-center gap-2 border-2 border-[#111111] bg-[#111111] px-3 py-2 font-mono text-xs font-black text-[#fffdf2] group-hover:bg-[#ef4444]">
                      {copyFor(product).cta}
                      <ArrowRight size={15} />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="buy" className="px-4 py-10">
          <div className="mx-auto grid max-w-7xl gap-4 md:grid-cols-[1fr_1fr_1fr]">
            {['제품 선택', '초기 셋팅', '자동 운영'].map((step, index) => (
              <DotFrame key={step} className="p-5">
                <div className="font-mono text-sm font-black text-[#ef4444]">STEP 0{index + 1}</div>
                <h3 className="mt-3 font-mono text-2xl font-black">{step}</h3>
                <p className="mt-3 text-sm font-black leading-6 text-[#5f5133]">
                  {index === 0 ? '내 업무에 맞는 자동화 제품을 고릅니다.' : index === 1 ? '계정, 권한, 운영 기준을 연결합니다.' : '정해진 기준에 따라 예약과 실행이 이어집니다.'}
                </p>
              </DotFrame>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export function ProductPurchasePage({ productId = 'cujasa' }) {
  const product = productById(productId) || productById('cujasa') || PRODUCTS[0];
  const catalog = catalogFor(product?.id);
  const [selectedPlanId, setSelectedPlanId] = useState(catalog.plans[0]?.id || '');
  const [form, setForm] = useState({ buyerName: '', phone: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const selectedPlan = useMemo(
    () => catalog.plans.find((plan) => plan.id === selectedPlanId) || catalog.plans[0],
    [catalog.plans, selectedPlanId]
  );

  const updateForm = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    if (paymentStatus === 'fail') {
      setError('결제가 완료되지 않았습니다. 다시 시도하거나 문의해주세요.');
      return;
    }
    if (paymentStatus !== 'success') return;
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    if (!paymentKey || !orderId || !amount) {
      setMessage('가상계좌 발급 화면에서 돌아왔습니다. 입금 후 확인되면 셋팅 절차가 진행됩니다.');
      return;
    }
    let cancelled = false;
    setConfirming(true);
    setError('');
    api.post('/api/public/checkout/toss/success', { paymentKey, orderId, amount })
      .then((payload) => {
        if (cancelled) return;
        const status = payload?.payment?.status;
        setMessage(status === 'paid'
          ? '결제가 확인되었습니다. 입력한 이메일과 비밀번호로 app.jasain.kr에 로그인해 사용할 수 있습니다.'
          : '가상계좌가 발급되었습니다. 입금 확인 후 상품 권한과 셋팅 안내가 진행됩니다.');
      })
      .catch((checkoutError) => {
        if (cancelled) return;
        setError(checkoutError.message || '결제 확인 중 문제가 발생했습니다. 문의해주세요.');
      })
      .finally(() => {
        if (!cancelled) setConfirming(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startCheckout = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = await api.post('/api/public/checkout/virtual-account', {
        ...form,
        productId: selectedPlan.id
      });
      const result = await requestPublicTossPayment(payload.toss);
      if (result?.dev) {
        setMessage(`개발 환경 결제 요청이 생성됐습니다. 상품 ${payload.toss.orderName}, 금액 ${formatWon(payload.toss.amount)}.`);
      }
    } catch (checkoutError) {
      setError(checkoutError.message || '결제를 시작하지 못했습니다. 입력 정보를 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f4e9c7] text-[#111111]">
      <div className="pointer-events-none fixed inset-0 opacity-[0.14]" style={{ backgroundImage: 'radial-gradient(#111 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
      <header className="relative border-b-2 border-[#111111] bg-[#fffdf2] px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <a href="/test-page-2" className="flex items-center gap-3">
            <img src="/jasain_logo.png" alt="JASAIN" className="h-10 w-10 border-2 border-[#111111] bg-white object-cover" />
            <div>
              <div className="font-mono text-lg font-black leading-none">{product.name}</div>
              <div className="font-mono text-[11px] font-black uppercase text-[#6b5d3d]">{copyFor(product).line}</div>
            </div>
          </a>
          <a href="/test-page-2#programs" className="border-2 border-[#111111] bg-[#facc15] px-3 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#111111]">
            다른 제품 보기
          </a>
          <a href={appLoginHref(product.id, form.email)} className="hidden border-2 border-[#111111] bg-[#fffdf2] px-3 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#111111] sm:inline-flex">
            이미 구매했어요
          </a>
        </div>
      </header>

      <main className="relative px-4 py-10">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section>
            <DotFrame className="p-4">
              <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                <PixelFloppy product={product} index={PRODUCTS.findIndex((item) => item.id === product.id)} />
                <div>
                  <div className="inline-flex border-2 border-[#111111] bg-[#facc15] px-3 py-1 font-mono text-xs font-black">
                    {product.name} 구매 안내
                  </div>
                  <h1 className="mt-4 break-keep font-mono text-4xl font-black leading-tight md:text-5xl">{catalog.title}</h1>
                  <p className="mt-4 break-keep text-base font-black leading-7 text-[#5f5133]">{catalog.intro}</p>
                  <div className="mt-5 grid gap-2">
                    {catalog.points.map((point) => (
                      <div key={point} className="flex items-center gap-2 font-mono text-sm font-black">
                        <span className="h-3 w-3 border-2 border-[#111111] bg-[#ef4444]" />
                        {point}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </DotFrame>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {catalog.plans.map((plan) => {
                const active = selectedPlan?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`min-h-56 border-2 border-[#111111] p-4 text-left shadow-[5px_5px_0_#111111] transition ${active ? 'bg-[#111111] text-[#fffdf2]' : 'bg-[#fffdf2] text-[#111111] hover:-translate-y-0.5'}`}
                  >
                    <div className={`inline-flex border-2 px-2 py-1 font-mono text-[11px] font-black ${active ? 'border-[#fffdf2] bg-[#facc15] text-[#111111]' : 'border-[#111111] bg-[#facc15]'}`}>{plan.badge}</div>
                    <div className="mt-4 font-mono text-2xl font-black">{plan.name}</div>
                    <div className="mt-2 font-mono text-xl font-black">{plan.price}</div>
                    <div className={`mt-4 grid gap-2 text-sm font-black leading-5 ${active ? 'text-[#fffdf2]' : 'text-[#5f5133]'}`}>
                      {plan.features.map((feature) => (
                        <span key={feature} className="flex items-center gap-2">
                          <Check size={15} />
                          {feature}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <aside>
            <DotFrame className="sticky top-5 p-5">
              <div className="font-mono text-sm font-black text-[#ef4444]">가상계좌 결제</div>
              <h2 className="mt-2 font-mono text-2xl font-black">{selectedPlan?.name}</h2>
              <div className="mt-1 font-mono text-xl font-black">{selectedPlan?.price}</div>
              <p className="mt-3 break-keep text-sm font-black leading-6 text-[#5f5133]">
                구매하기를 누르면 토스페이먼츠 가상계좌 결제창으로 이동합니다. 입력한 이메일과 비밀번호가 app.jasain.kr 로그인 계정이 되고, 입금 확인 후 상품 권한과 셋팅 절차가 진행됩니다.
              </p>

              <form onSubmit={startCheckout} className="mt-5 grid gap-3">
                <label className="grid gap-1 font-mono text-xs font-black">
                  이름
                  <input className="border-2 border-[#111111] bg-white px-3 py-2 text-sm outline-none" value={form.buyerName} onChange={(event) => updateForm('buyerName', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black">
                  연락처
                  <input className="border-2 border-[#111111] bg-white px-3 py-2 text-sm outline-none" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black">
                  이메일
                  <input type="email" className="border-2 border-[#111111] bg-white px-3 py-2 text-sm outline-none" value={form.email} onChange={(event) => updateForm('email', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black">
                  비밀번호
                  <input type="password" minLength={6} className="border-2 border-[#111111] bg-white px-3 py-2 text-sm outline-none" value={form.password} onChange={(event) => updateForm('password', event.target.value)} required />
                </label>
                {error && <div className="border-2 border-[#111111] bg-[#fee2e2] p-3 text-sm font-black text-[#7f1d1d]">{error}</div>}
                {(message || confirming) && (
                  <div className="grid gap-3 border-2 border-[#111111] bg-[#dcfce7] p-3 text-sm font-black text-[#14532d]">
                    <div>{confirming ? '결제 결과를 확인하고 있습니다.' : message}</div>
                    {!confirming && (
                      <a href={appLoginHref(product.id, form.email)} className="inline-flex items-center justify-center gap-2 border-2 border-[#111111] bg-[#111111] px-4 py-2 font-mono text-xs font-black text-[#fffdf2] shadow-[3px_3px_0_#16a34a]">
                        app.jasain.kr에서 로그인하기
                        <ArrowRight size={15} />
                      </a>
                    )}
                  </div>
                )}
                <button type="submit" disabled={busy || confirming} className="mt-2 inline-flex items-center justify-center gap-2 border-2 border-[#111111] bg-[#111111] px-5 py-3 font-mono text-sm font-black text-[#fffdf2] shadow-[5px_5px_0_#facc15] disabled:cursor-wait disabled:opacity-60">
                  {busy ? '결제창 준비 중' : '구매하기'}
                  <ArrowRight size={17} />
                </button>
              </form>
            </DotFrame>
          </aside>
        </div>
      </main>
    </div>
  );
}
