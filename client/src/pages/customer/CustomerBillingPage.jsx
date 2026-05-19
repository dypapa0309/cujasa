import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import BillingAgreementModal, { BILLING_AGREEMENT_VERSION } from '../../components/BillingAgreementModal.jsx';

const pendingSubscriptionKey = 'cujasa_pending_subscription';

function price(value) {
  return `${Number(value || 0).toLocaleString()}원`;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('ko-KR') : '-';
}

function billingTitle(billing) {
  if (billing?.plan === 'onetime' && billing?.status === 'paid') return '영구 이용 중';
  if (billing?.status === 'active') return `${formatDate(billing.paidUntil)}까지 이용 가능`;
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
    script.onerror = () => reject(new Error('Toss 결제 모듈을 불러오지 못했습니다.'));
    document.head.appendChild(script);
  });
}

async function requestTossPayment(toss) {
  if (toss.clientKey === 'test_ck_dev_placeholder') {
    throw new Error('TOSS_CLIENT_KEY를 설정한 뒤 결제를 진행할 수 있습니다.');
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
    throw new Error('TOSS_CLIENT_KEY를 설정한 뒤 자동결제를 등록할 수 있습니다.');
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

export default function CustomerBillingPage({ currentUser }) {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [billing, setBilling] = useState(null);
  const [payments, setPayments] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [busy, setBusy] = useState('');
  const [redirectHandled, setRedirectHandled] = useState(false);
  const [agreementIntent, setAgreementIntent] = useState(null);
  const latestWaiting = payments.find((payment) => payment.status === 'waiting_for_deposit');
  const activeSubscription = subscriptions.find((subscription) => subscription.status === 'active');

  const productsById = useMemo(() => Object.fromEntries(products.map((product) => [product.id, product])), [products]);

  const load = async () => {
    const [{ products: nextProducts }, status] = await Promise.all([
      api.get('/api/billing/products'),
      api.get('/api/billing/status')
    ]);
    setProducts(nextProducts);
    setBilling(status.billing);
    setPayments(status.payments || []);
    setSubscriptions(status.subscriptions || []);
  };

  useEffect(() => {
    load().catch(() => toast('결제 정보를 불러오지 못했습니다.', 'error'));
  }, []);

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
          toast(message || '결제가 완료되지 않았습니다.', 'error');
          return;
        }
        if (paymentKey && orderId && amount) {
          await api.post('/api/billing/toss/success', { paymentKey, orderId, amount: Number(amount) });
          toast('결제 요청이 확인됐습니다.', 'success');
        } else if (authKey) {
          const pending = JSON.parse(localStorage.getItem(pendingSubscriptionKey) || '{}');
          await api.post('/api/billing/billing-auth', {
            productId: 'monthly_59000',
            subscriptionId: pending.subscriptionId,
            authKey,
            customerKey: customerKey || pending.customerKey
          });
          localStorage.removeItem(pendingSubscriptionKey);
          toast('월정액 자동결제가 등록됐습니다.', 'success');
        }
        await load();
      } catch (err) {
        toast(err.message || '결제 처리에 실패했습니다.', 'error');
      } finally {
        setBusy('');
        window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash || '#tab=billing'}`);
      }
    };
    finish();
  }, [redirectHandled]);

  const startOnetime = async (agreementSnapshot) => {
    setBusy('onetime');
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', {
        productId: 'onetime_590000',
        agreementAccepted: true,
        agreementVersion: BILLING_AGREEMENT_VERSION,
        agreementSnapshot
      });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '결제를 시작하지 못했습니다.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const startMonthly = async (agreementSnapshot) => {
    setBusy('monthly');
    try {
      const payload = await api.post('/api/billing/checkout/virtual-account', {
        productId: 'monthly_59000',
        agreementAccepted: true,
        agreementVersion: BILLING_AGREEMENT_VERSION,
        agreementSnapshot
      });
      await requestTossPayment(payload.toss);
    } catch (err) {
      toast(err.message || '월정액 가상계좌 결제를 시작하지 못했습니다.', 'error');
      await load().catch(() => {});
    } finally {
      setBusy('');
    }
  };

  const openAgreement = (type, productId) => {
    const product = productsById[productId];
    setAgreementIntent({
      type,
      product: productId === 'monthly_59000' && product ? { ...product, amount: 129000 } : product
    });
  };

  const confirmAgreement = async (snapshot) => {
    const intent = agreementIntent;
    setAgreementIntent(null);
    if (intent?.type === 'onetime') await startOnetime(snapshot);
    if (intent?.type === 'monthly') await startMonthly(snapshot);
  };

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-gray-400">내 결제 상태</div>
            <h2 className="mt-1 text-xl font-black">
              {billingTitle(billing)}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {currentUser.email} · Threads 계정 {billing?.maxAccounts ?? currentUser.maxAccounts ?? 2}개
            </p>
          </div>
          <button onClick={() => load().catch(() => {})} className="rounded-xl border border-gray-200 p-2 text-gray-400 hover:text-gray-700" title="새로고침">
            <RefreshCw size={18} />
          </button>
        </div>
        {billing?.status === 'past_due' && (
          <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
            자동화 실행이 잠시 중지됐습니다. 월결제를 연장하거나 영구구매로 전환해주세요.
          </div>
        )}
        {billing?.paidUntil && billing?.status !== 'past_due' && (
          <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            이용 가능 기간 {formatDate(billing.paidUntil)}까지
          </div>
        )}
      </div>

      {latestWaiting && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-amber-800 font-black">
            <Landmark size={18} />
            입금 대기 중
          </div>
          <div className="mt-3 grid gap-1 text-sm text-amber-800">
            <span>주문번호 {latestWaiting.orderId}</span>
            <span>{productsById[latestWaiting.productId]?.name || 'CUJASA 베이직'} · {price(latestWaiting.amount)}</span>
            {latestWaiting.virtualAccount && (
              <span>계좌 {latestWaiting.virtualAccount.bankCode || '은행'} {latestWaiting.virtualAccount.accountNumber}</span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4">
        <PlanCard
          icon={Landmark}
          title="프로 영구구매"
          priceText="590,000원"
          originalPriceText="990,000원"
          caption="가상계좌 결제"
          product={productsById.onetime_590000}
          busy={busy === 'onetime'}
          onClick={() => openAgreement('onetime', 'onetime_590000')}
        />
        <PlanCard
          icon={CreditCard}
          title={billing?.status === 'past_due' ? '월결제 연장하기' : '베이직 월정액'}
          priceText="129,000원 / 월"
          caption={activeSubscription ? `활성 · 다음 결제 ${formatDate(activeSubscription.nextBillingAt)}` : '가상계좌 결제'}
          product={productsById.monthly_59000 ? { ...productsById.monthly_59000, amount: 129000 } : null}
          busy={busy === 'monthly'}
          onClick={() => openAgreement('monthly', 'monthly_59000')}
        />
      </div>

      {agreementIntent && (
        <BillingAgreementModal
          product={agreementIntent.product}
          flow={agreementIntent.type}
          busy={Boolean(busy)}
          onCancel={() => setAgreementIntent(null)}
          onConfirm={confirmAgreement}
        />
      )}

    </div>
  );
}

function PlanCard({ icon: Icon, title, priceText, originalPriceText, caption, product, busy, onClick }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-coupang">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-black">{title}</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
              <ShieldCheck size={12} />
              계정 {product?.max_accounts ?? 2}개
            </span>
          </div>
          <div className="mt-1 grid gap-1 leading-tight">
            {originalPriceText && <span className="text-sm font-black text-gray-400 line-through">{originalPriceText}</span>}
            <span className="text-2xl font-black">{priceText}</span>
          </div>
          <div className="mt-1 text-sm text-gray-400">{caption}</div>
        </div>
      </div>
      <button onClick={onClick} disabled={busy || !product}
        className="mt-4 w-full rounded-xl bg-coupang py-3 text-sm font-black text-white disabled:opacity-50">
        {busy ? '진행 중...' : '결제하기'}
      </button>
    </div>
  );
}
