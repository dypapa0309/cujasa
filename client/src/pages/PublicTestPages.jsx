import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, MessageCircle, Phone } from 'lucide-react';
import { PRODUCTS, productById } from '../config/products.js';
import { api } from '../lib/api.js';

const productTone = {
  cujasa: { label: 'AUTO', disk: 'bg-[#3f6f61]', tab: 'bg-[#17201d]', screen: 'bg-[#f3f6f4]' },
  dexor: { label: 'DATA', disk: 'bg-[#2563eb]', tab: 'bg-[#93c5fd]', screen: 'bg-[#0f172a]' },
  spread: { label: 'CAMP', disk: 'bg-[#16a34a]', tab: 'bg-[#c8d6d2]', screen: 'bg-[#eef3ef]' },
  polibot: { label: 'POLI', disk: 'bg-[#3f6470]', tab: 'bg-[#9ab8c0]', screen: 'bg-[#f3f6f4]' },
  infludex: { label: 'INFL', disk: 'bg-[#f97316]', tab: 'bg-[#fed7aa]', screen: 'bg-[#431407]' },
  sublog: { label: 'COST', disk: 'bg-[#0891b2]', tab: 'bg-[#a5f3fc]', screen: 'bg-[#083344]' },
  auvibot: { label: 'SHOT', disk: 'bg-[#db2777]', tab: 'bg-[#fbcfe8]', screen: 'bg-[#500724]' }
};

const STORE_PRODUCT_IDS = ['cujasa', 'polibot'];
const STORE_PRODUCTS = PRODUCTS.filter((product) => STORE_PRODUCT_IDS.includes(product.id));
const CONTACT_PHONE = '010-4803-7079';
const CONTACT_PHONE_LINK = '01048037079';

const launchNotes = [
  '반복되는 운영 업무를 제품별로 나누어 자동화해요.',
  '초기 설정 후 콘텐츠 생성, 예약, 상담 준비까지 한곳에서 관리해요.',
  '상황에 맞는 상품을 고르고 도입 절차를 바로 시작할 수 있어요.'
];

const productCopy = {
  cujasa: {
    line: '쿠팡 파트너스 Threads 자동화',
    description: '주제 선정, 상품 매칭, 글 작성, 예약 업로드를 매일 자동으로 준비해요.',
    cta: 'CUJASA 시작하기'
  },
  dexor: {
    line: '블로그 후보 분석 자동화',
    description: '후보 블로그의 등급과 적합도를 빠르게 비교해 캠페인 선정 시간을 줄여요.',
    cta: 'DEXOR 분석하기'
  },
  spread: {
    line: '추천 캠페인 운영 자동화',
    description: '캠페인 신청자, 제출물, 진행 상태를 한 화면에서 정리해요.',
    cta: 'SPREAD 시작하기'
  },
  polibot: {
    line: '보험 상담 정리 자동화',
    description: '고객 정보와 보장분석 자료를 정리해 상담 근거를 빠르게 만들어요.',
    cta: 'POLIBOT 시작하기'
  },
  infludex: {
    line: '인플루언서 후보 분석',
    description: '인스타그램 후보의 적합도와 리스크를 보고 협업 대상을 좁힙니다.',
    cta: 'INFLUDEX 분석하기'
  },
  sublog: {
    line: '구독 비용 관리',
    description: '반복 결제일, 담당자, 비용을 정리해 놓치는 구독을 줄여요.',
    cta: 'SUBLOG 둘러보기'
  },
  auvibot: {
    line: '상품 쇼츠 생산 자동화',
    description: '상품 정보에서 쇼츠 문구와 업로드 준비까지 반복 제작을 줄여요.',
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
  return `https://jasain.kr/${search ? `?${search}` : ''}#tab=beta`;
}

const purchaseCatalog = {
  cujasa: {
    title: '쿠팡 파트너스 자동화를 매일 운영해요',
    intro: 'Threads 계정 연결, 쿠팡 상품 매칭, 글 생성, 예약 업로드를 한곳에서 관리해요.',
    points: ['Threads 계정별 자동 예약', '쿠팡 파트너스 링크 연결', '설정 및 재연결 지원'],
    plans: [
      { id: 'monthly_59000', name: '베이직 월정액', price: '99,000원 / 월', badge: '추천', features: ['Threads 계정 2개', '매일 자동 예약', '초기 설정 지원'] },
      { id: 'onetime_590000', name: '프로 1년 이용', price: '590,000원', originalPrice: '990,000원', discount: '40% 할인', badge: '1년 이용', features: ['Threads 계정 4개', '일시불 이용', '1년 운영 설정'] }
    ]
  },
  dexor: {
    title: '블로그 후보를 빠르게 분석해요',
    intro: '후보 블로그의 등급, 적합도, 검토 우선순위를 계산해 선정 시간을 줄여요.',
    points: ['블로그 등급 분석', '캠페인 적합도 비교', '후보 우선순위 정리'],
    plans: [
      { id: 'dexor_credit_5000', name: '라이트 분석', price: '5,000원', badge: '10회', features: ['블로그 분석 10회', '소량 테스트', '가상계좌 충전'] },
      { id: 'dexor_credit_10000', name: '베이직 분석', price: '10,000원', badge: '추천', features: ['블로그 분석 25회', '반복 검토', '낮은 회당 비용'] },
      { id: 'dexor_credit_50000', name: '프로 분석', price: '50,000원', badge: '대량', features: ['블로그 분석 150회', '대량 후보 선별', '운영팀용'] }
    ]
  },
  spread: {
    title: '추천 캠페인 운영을 정리해요',
    intro: '신청자 관리, 제출물 확인, 캠페인 진행 상태를 한곳에서 보는 운영 자동화예요.',
    points: ['캠페인별 신청자 정리', '제출물 상태 관리', '운영 리포트'],
    plans: [
      { id: 'spread_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['기본 캠페인 운영', '신청자 정리', '제출물 확인'] },
      { id: 'spread_basic_monthly_149000', name: '베이직', price: '149,000원 / 월', badge: '추천', features: ['반복 캠페인 운영', '운영 현황 관리', '리포트'] },
      { id: 'spread_pro_monthly_390000', name: '프로', price: '390,000원 / 월', badge: '팀', features: ['팀 단위 운영', '대량 캠페인', '우선 지원'] }
    ]
  },
  polibot: {
    title: '보험 상담과 추천 근거를 정리해요',
    intro: '고객 정보, 보장분석 자료, 추천 근거를 정리해 상담자가 빠르게 판단할 수 있게 해요.',
    points: ['고객 상담 요약', '보장분석 자료 정리', '추천 근거 생성'],
    plans: [
      { id: 'polibot_basic_monthly_99000', name: '베이직', price: '8,900원 / 월', badge: '추천', features: ['월 보장분석 50회', '고객별 히스토리', '추천 근거 정리'] },
      { id: 'polibot_lifetime_590000', name: '프로 1년 이용', price: '590,000원', originalPrice: '990,000원', discount: '40% 할인', badge: '1년 이용', features: ['1년 이용', '팀 운영', '우선 지원'] }
    ]
  },
  infludex: {
    title: '인플루언서 후보를 숫자로 비교해요',
    intro: '인스타그램 후보의 적합도와 리스크를 분석해 협업 대상을 빠르게 좁혀요.',
    points: ['후보 등급 분석', '캠페인 적합도 확인', '리스크 신호 체크'],
    plans: [
      { id: 'infludex_credit_5000', name: '라이트 분석', price: '5,000원', badge: '30회', features: ['후보 분석 30회', '등급/리스크 확인', '가상계좌 충전'] },
      { id: 'infludex_credit_10000', name: '베이직 분석', price: '10,000원', badge: '추천', features: ['후보 분석 100회', '캠페인 후보 비교', '반복 선별'] },
      { id: 'infludex_credit_50000', name: '프로 분석', price: '50,000원', badge: '대량', features: ['후보 분석 250회', '대량 후보 검토', '운영팀용'] }
    ]
  },
  sublog: {
    title: '구독 비용을 놓치지 않게 정리해요',
    intro: '반복 결제되는 서비스의 결제일, 담당자, 비용을 한 화면에서 관리해요.',
    points: ['구독 비용 목록화', '다가오는 결제 확인', '중복 구독 점검'],
    plans: [
      { id: 'sublog_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['구독 목록 설정', '결제일 정리', '운영 상담'] }
    ]
  },
  auvibot: {
    title: '상품 쇼츠 제작을 자동화해요',
    intro: '상품 정보에서 쇼츠 문구, 장면 구성, 업로드 준비까지 반복 제작을 줄여요.',
    points: ['상품별 쇼츠 초안', '후킹 문구 생성', '업로드 준비 관리'],
    plans: [
      { id: 'auvibot_starter_monthly_49000', name: '스타터', price: '49,000원 / 월', badge: '시작', features: ['상품 쇼츠 초안', '운영 설정', '도입 상담'] }
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
  if (typeof window === 'undefined') return Promise.reject(new Error('브라우저에서만 결제를 시작할 수 있어요.'));
  if (window.TossPayments) return Promise.resolve(window.TossPayments);
  const existing = document.querySelector('script[data-toss-payments]');
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.TossPayments), { once: true });
      existing.addEventListener('error', () => reject(new Error('Toss 결제 스크립트를 불러오지 못했어요.')), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.tosspayments.com/v2/standard';
    script.async = true;
    script.dataset.tossPayments = 'true';
    script.onload = () => resolve(window.TossPayments);
    script.onerror = () => reject(new Error('Toss 결제 스크립트를 불러오지 못했어요.'));
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
    <div className={`border border-[#c7d2cc] bg-white shadow-[0_14px_36px_rgba(23,32,29,0.08)] ${className}`}>
      {children}
    </div>
  );
}

function ContactBox({ compact = false, embedded = false }) {
  const content = (
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-mono text-xs font-black uppercase tracking-[0.14em] text-[#6b7a75]">Contact</div>
          <div className="mt-1 break-keep font-mono text-lg font-black text-[#2f5d50]">상담이 필요하면 바로 연락해요</div>
          <div className="mt-1 font-mono text-sm font-black text-[#17201d]">{CONTACT_PHONE}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={`tel:${CONTACT_PHONE_LINK}`} className="inline-flex items-center justify-center gap-2 border border-[#c7d2cc] bg-[#17201d] px-4 py-3 font-mono text-sm font-black text-white">
            <Phone size={16} />
            전화상담
          </a>
          <a href={`sms:${CONTACT_PHONE_LINK}`} className="inline-flex items-center justify-center gap-2 border border-[#c7d2cc] bg-[#eef3ef] px-4 py-3 font-mono text-sm font-black text-[#2f5d50]">
            <MessageCircle size={16} />
            문자상담
          </a>
        </div>
      </div>
  );
  if (embedded) return <div className="border-t border-[#d8ded9] pt-4">{content}</div>;
  return (
    <DotFrame className={compact ? 'p-4' : 'p-5'}>
      {content}
    </DotFrame>
  );
}

function DosProductDisk({ product, index = 0, compact = false }) {
  const ribbonClass = product.id === 'polibot' ? 'bg-[#4d6f8f]' : 'bg-[#b85c4b]';
  const lidClass = product.id === 'polibot' ? 'bg-[#dce7ee]' : 'bg-[#f1ded8]';
  const boxClass = product.id === 'polibot' ? 'bg-[#edf4f7]' : 'bg-[#fff4ee]';
  return (
    <div className={`min-w-0 overflow-hidden border border-[#c7d2cc] bg-white shadow-[0_8px_22px_rgba(23,32,29,0.07)] ${compact ? 'p-3' : 'p-4'}`}>
      <div className={`h-7 border border-[#c7d2cc] ${lidClass}`} />
      <div className={`grid ${compact ? 'min-h-28 grid-cols-[20px_minmax(0,1fr)]' : 'min-h-40 grid-cols-[28px_minmax(0,1fr)]'} border-x border-b border-[#c7d2cc] ${boxClass}`}>
        <div className={ribbonClass} />
        <div className="flex min-w-0 flex-col justify-between p-4">
          <span className={`h-2.5 w-2.5 shrink-0 ${ribbonClass}`} />
          <div className="mt-5">
            <div className={`break-words font-mono font-black leading-tight text-[#17201d] ${compact ? 'text-base' : 'text-xl'}`}>{product.name}</div>
            {!compact && (
              <p className="mt-1 break-keep text-sm font-semibold leading-5 text-[#5f6f69]">{copyFor(product).line}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PublicTestPage2() {
  return (
    <div className="min-h-screen bg-[#f3f6f4] text-[#17201d]">
      <header className="relative border-b border-[#d8ded9] bg-white/95 px-4 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/jasain_logo.png" alt="JASAIN" className="h-10 w-10 border border-[#c7d2cc] bg-white object-cover" />
            <div>
              <div className="font-mono text-lg font-black leading-none text-[#2f5d50]">JASAIN STORE</div>
              <div className="font-mono text-[11px] font-black uppercase text-[#5f6f69]">Automation products</div>
            </div>
          </a>
          <nav className="hidden items-center gap-2 md:flex">
            <a href="#programs" className="border border-[#c7d2cc] bg-[#eef3ef] px-3 py-2 text-xs font-black text-[#2f5d50]">상품 보기</a>
            <a href="#buy" className="border border-[#c7d2cc] bg-[#f3f6f4] px-3 py-2 text-xs font-black text-[#5f6f69]">도입 절차</a>
            <a href="https://jasain.kr" className="border border-[#c7d2cc] bg-[#17201d] px-3 py-2 text-xs font-black text-white">로그인</a>
          </nav>
        </div>
      </header>

      <main className="relative">
        <section className="px-4 py-8 md:py-10">
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end">
            <div>
              <DotFrame className="inline-flex px-3 py-2 text-xs font-black uppercase text-[#2f5d50]">
                JASAIN AUTOMATION STORE
              </DotFrame>
              <h1 className="mt-5 max-w-3xl break-keep font-mono text-3xl font-black leading-[1.1] text-[#2f5d50] sm:text-4xl md:text-5xl">
                업무에 맞는 자동화 상품을 골라봐요
              </h1>
              <p className="mt-4 max-w-2xl break-keep text-base font-bold leading-7 text-[#5f6f69]">
                CUJASA는 쿠팡 파트너스 콘텐츠 운영을, POLIBOT은 보험 상담 준비와 추천 근거 정리를 도와줘요.
              </p>
              <div className="mt-5 grid max-w-xl gap-2">
                {launchNotes.map((note) => (
                  <div key={note} className="flex items-start gap-2 text-sm font-bold leading-6 text-[#17201d]">
                    <span className="mt-2 h-2 w-2 shrink-0 border border-[#c7d2cc] bg-[#17201d]" />
                    {note}
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#programs" className="inline-flex items-center gap-2 border border-[#c7d2cc] bg-[#17201d] px-5 py-3 font-mono text-sm font-black text-white shadow-[0_10px_24px_rgba(23,32,29,0.12)]">
                  상품 보기
                  <ArrowRight size={17} />
                </a>
              </div>
              <div className="mt-5 max-w-2xl">
                <ContactBox compact />
              </div>
            </div>
            <DotFrame className="p-3">
              <div className="border border-[#d8ded9] bg-[#f8faf9] p-3">
                <div className="grid gap-3">
                  {STORE_PRODUCTS.map((product, index) => (
                    <DosProductDisk key={product.id} product={product} index={index} compact />
                  ))}
                </div>
              </div>
            </DotFrame>
          </div>
        </section>

        <section id="programs" className="border-y border-[#d8ded9] bg-[#e8efea] px-4 py-9">
          <div className="mx-auto max-w-6xl">
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-[#6b7a75]">Products</div>
                <h2 className="mt-2 font-mono text-2xl font-black text-[#2f5d50] md:text-4xl">필요한 상품을 확인해요</h2>
              </div>
              <p className="max-w-xl break-keep text-sm font-black leading-6 text-[#5f6f69]">운영 목적에 맞는 상품을 선택하면 결제와 초기 설정 안내를 바로 진행할 수 있어요.</p>
            </div>
            <div className="mt-7 grid gap-5 md:grid-cols-2">
              {STORE_PRODUCTS.map((product, index) => (
                <a key={product.id} href={productHref(product)} className="group block">
                  <DosProductDisk product={product} index={index} />
                  <div className="mt-4 min-h-40 border border-[#c7d2cc] bg-white p-4 shadow-[0_10px_24px_rgba(23,32,29,0.08)]">
                    <div className="break-words font-mono text-xl font-black text-[#2f5d50]">{product.name}</div>
                    <p className="mt-1 break-keep font-mono text-[11px] font-black uppercase text-[#6b7a75]">{copyFor(product).line}</p>
                    <p className="mt-3 min-h-16 break-keep text-sm font-black leading-6 text-[#17201d]">{copyFor(product).description}</p>
                    <div className="mt-4 inline-flex items-center gap-2 border border-[#c7d2cc] bg-[#17201d] px-3 py-2 font-mono text-xs font-black text-white group-hover:bg-[#2f5d50]">
                      {copyFor(product).cta}
                      <ArrowRight size={15} />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section id="buy" className="px-4 py-9">
          <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-[1fr_1fr_1fr]">
            {['상품 선택', '초기 설정', '자동 운영'].map((step, index) => (
              <DotFrame key={step} className="p-5">
                <div className="font-mono text-sm font-black text-[#2f5d50]">STEP 0{index + 1}</div>
                <h3 className="mt-3 font-mono text-2xl font-black text-[#17201d]">{step}</h3>
                <p className="mt-3 break-keep text-sm font-black leading-6 text-[#5f6f69]">
                  {index === 0 ? '필요한 업무에 맞는 상품을 선택해요.' : index === 1 ? '계정, 권한, 운영 기준을 연결해요.' : '설정한 기준에 따라 생성, 예약, 실행을 진행해요.'}
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
  const requestedProduct = productById(productId);
  const product = STORE_PRODUCTS.find((item) => item.id === requestedProduct?.id) || STORE_PRODUCTS[0];
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
      setError('결제가 완료되지 않았어요. 다시 시도하거나 문의해 주세요.');
      return;
    }
    if (paymentStatus !== 'success') return;
    const paymentKey = params.get('paymentKey');
    const orderId = params.get('orderId');
    const amount = params.get('amount');
    if (!paymentKey || !orderId || !amount) {
      setMessage('가상계좌 발급 화면에서 돌아왔어요. 입금 확인 후 설정 절차가 진행돼요.');
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
          ? '결제가 확인됐어요. 입력한 이메일과 비밀번호로 jasain.kr에 로그인해 사용할 수 있어요.'
          : '가상계좌가 발급됐어요. 입금 확인 후 상품 권한과 설정 안내가 진행돼요.');
      })
      .catch((checkoutError) => {
        if (cancelled) return;
        setError(checkoutError.message || '결제 확인 중 문제가 발생했어요. 문의해 주세요.');
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
        setMessage(`개발 환경 결제 요청이 생성됐어요. 상품 ${payload.toss.orderName}, 금액 ${formatWon(payload.toss.amount)}.`);
      }
    } catch (checkoutError) {
      setError(checkoutError.message || '결제를 시작하지 못했어요. 입력 정보를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f3f6f4] text-[#17201d]">
      <header className="relative border-b border-[#d8ded9] bg-white/95 px-4 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/jasain_logo.png" alt="JASAIN" className="h-10 w-10 border border-[#c7d2cc] bg-white object-cover" />
            <div>
              <div className="font-mono text-lg font-black leading-none text-[#2f5d50]">{product.name}</div>
              <div className="font-mono text-[11px] font-black uppercase text-[#5f6f69]">{copyFor(product).line}</div>
            </div>
          </a>
          <a href="/#programs" className="border border-[#c7d2cc] bg-[#eef3ef] px-3 py-2 font-mono text-xs font-black text-[#2f5d50]">
            다른 상품 보기
          </a>
          <a href={appLoginHref(product.id, form.email)} className="hidden border border-[#c7d2cc] bg-[#17201d] px-3 py-2 font-mono text-xs font-black text-white sm:inline-flex">
            이미 구매했어요
          </a>
        </div>
      </header>

      <main className="relative px-4 py-8">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section>
            <DotFrame className="p-4">
              <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
                <DosProductDisk product={product} index={STORE_PRODUCTS.findIndex((item) => item.id === product.id)} />
                <div>
                  <div className="inline-flex border border-[#c7d2cc] bg-[#eef3ef] px-3 py-1 font-mono text-xs font-black text-[#2f5d50]">
                    {product.name} 구매 안내
                  </div>
                  <h1 className="mt-4 break-keep font-mono text-3xl font-black leading-tight text-[#2f5d50] md:text-4xl">{catalog.title}</h1>
                  <p className="mt-4 break-keep text-base font-bold leading-7 text-[#5f6f69]">{catalog.intro}</p>
                  <div className="mt-5 grid gap-2">
                    {catalog.points.map((point) => (
                      <div key={point} className="flex items-center gap-2 font-mono text-sm font-black text-[#17201d]">
                        <span className="h-3 w-3 border border-[#c7d2cc] bg-[#17201d]" />
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
                    className={`min-h-48 border border-[#c7d2cc] p-4 text-left shadow-[0_10px_24px_rgba(23,32,29,0.08)] transition ${active ? 'bg-[#17201d] text-white' : 'bg-white text-[#17201d] hover:-translate-y-0.5'}`}
                  >
                    <div className={`inline-flex border px-2 py-1 font-mono text-[11px] font-black ${active ? 'border-[#0f1720] bg-[#f3f6f4] text-[#2f5d50]' : 'border-[#c7d2cc] bg-[#eef3ef] text-[#2f5d50]'}`}>{plan.badge}</div>
                    <div className="mt-4 font-mono text-xl font-black">{plan.name}</div>
                    <div className="mt-2 grid gap-1 font-mono">
                      {plan.originalPrice && <span className={`text-sm font-black line-through ${active ? 'text-[#166534]' : 'text-[#6b7a75]'}`}>{plan.originalPrice}</span>}
                      {plan.discount && <span className={`text-sm font-black ${active ? 'text-white' : 'text-[#9ab8c0]'}`}>{plan.discount}</span>}
                      <span className="text-xl font-black">{plan.price}</span>
                    </div>
                    <div className={`mt-4 grid gap-2 text-sm font-black leading-5 ${active ? 'text-white' : 'text-[#5f6f69]'}`}>
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
              <div className="font-mono text-sm font-black text-[#2f5d50]">결제 정보</div>
              <h2 className="mt-2 font-mono text-2xl font-black text-[#17201d]">{selectedPlan?.name}</h2>
              <div className="mt-1 font-mono text-xl font-black text-[#2f5d50]">{selectedPlan?.price}</div>
              <p className="mt-3 break-keep text-sm font-black leading-6 text-[#5f6f69]">
                구매하기를 누르면 토스페이먼츠 가상계좌 결제창으로 이동해요. 입력한 이메일과 비밀번호가 jasain.kr 로그인 계정이 되고, 입금 확인 후 상품 권한과 설정 절차가 진행돼요.
              </p>
              <div className="mt-4">
                <ContactBox compact embedded />
              </div>

              <form onSubmit={startCheckout} className="mt-5 grid gap-3">
                <label className="grid gap-1 font-mono text-xs font-black text-[#17201d]">
                  이름
                  <input className="border border-[#c7d2cc] bg-white px-3 py-2 text-sm text-[#17201d] outline-none focus:border-[#2f5d50]" value={form.buyerName} onChange={(event) => updateForm('buyerName', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black text-[#17201d]">
                  연락처
                  <input className="border border-[#c7d2cc] bg-white px-3 py-2 text-sm text-[#17201d] outline-none focus:border-[#2f5d50]" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black text-[#17201d]">
                  이메일
                  <input type="email" className="border border-[#c7d2cc] bg-white px-3 py-2 text-sm text-[#17201d] outline-none focus:border-[#2f5d50]" value={form.email} onChange={(event) => updateForm('email', event.target.value)} required />
                </label>
                <label className="grid gap-1 font-mono text-xs font-black text-[#17201d]">
                  비밀번호
                  <input type="password" minLength={6} className="border border-[#c7d2cc] bg-white px-3 py-2 text-sm text-[#17201d] outline-none focus:border-[#2f5d50]" value={form.password} onChange={(event) => updateForm('password', event.target.value)} required />
                </label>
                {error && <div className="border border-[#f87171] bg-[#450a0a] p-3 text-sm font-black text-[#fecaca]">{error}</div>}
                {(message || confirming) && (
                  <div className="grid gap-3 border border-[#c7d2cc] bg-[#eef3ef] p-3 text-sm font-black text-[#17201d]">
                    <div>{confirming ? '결제 결과를 확인하고 있어요.' : message}</div>
                    {!confirming && (
                      <a href={appLoginHref(product.id, form.email)} className="inline-flex items-center justify-center gap-2 border border-[#c7d2cc] bg-[#17201d] px-4 py-2 font-mono text-xs font-black text-white">
                        jasain.kr에서 로그인하기
                        <ArrowRight size={15} />
                      </a>
                    )}
                  </div>
                )}
                <button type="submit" disabled={busy || confirming} className="mt-2 inline-flex items-center justify-center gap-2 border border-[#c7d2cc] bg-[#17201d] px-5 py-3 font-mono text-sm font-black text-white shadow-[0_10px_24px_rgba(23,32,29,0.12)] disabled:cursor-wait disabled:opacity-60">
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
