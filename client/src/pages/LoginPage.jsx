import { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.js';
import { CURRENT_PRODUCT, PRODUCTS, productById } from '../config/products.js';

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/30';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';
const spreadMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_SPREAD_BETA !== 'true';
const infludexMaintenanceEnabled = import.meta.env.PROD && import.meta.env.VITE_ENABLE_INFLUDEX_BETA !== 'true';

function isProductRegistrationOpen(product = null) {
  if (!product?.id) return false;
  if (product?.status === 'preparing' || product?.status === 'inactive') return false;
  if (product?.id === 'spread') return !spreadMaintenanceEnabled;
  if (product?.id === 'infludex') return !infludexMaintenanceEnabled;
  return true;
}

export default function LoginPage({ onLogin }) {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('mode') === 'register' ? 'register' : 'login';
  const registrationProducts = PRODUCTS.filter(isProductRegistrationOpen);
  const fallbackProduct = registrationProducts[0] || CURRENT_PRODUCT || PRODUCTS.find((product) => product?.id) || { id: 'cujasa', name: 'CUJASA', supportLabel: '쿠팡 파트너스 자동화', description: '쿠팡 파트너스 자동화 콘솔' };
  const requestedProductConfig = productById(params.get('product'));
  const requestedProduct = isProductRegistrationOpen(requestedProductConfig)
    ? requestedProductConfig.id
    : fallbackProduct.id;
  const [form, setForm] = useState({ email: '', password: '' });
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
      const result = await api.post('/api/auth/login', form);
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
                    onClick={() => selectPreviewProduct(product.id)}
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
          <div className="w-full max-w-[420px]">
              <form onSubmit={mode === 'login' ? submit : submitRegister} className="rounded-[28px] border border-white/10 bg-[#191919] p-5 shadow-2xl shadow-black/40">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xl font-black text-zinc-100">{mode === 'login' ? '로그인' : '회원가입'}</div>
                    <div className="mt-1 text-xs text-zinc-500">{mode === 'login' ? '이어서 작업할 계정으로 들어가요.' : '처음 사용할 솔루션을 선택해요.'}</div>
                  </div>
                  <button type="button" onClick={toggleMode} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-400 hover:bg-white/10 hover:text-white">
                    {mode === 'login' ? '회원가입' : '로그인'}
                  </button>
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
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-zinc-500">
                      {registerForm.productId === CURRENT_PRODUCT.id
                        ? '가입하면 CUJASA 체험 계정이 준비돼요. 설정을 마치면 바로 자동화를 확인할 수 있어요.'
                        : '가입하면 선택한 솔루션이 JASAIN 계정에 연결돼요. 로그인 후 워크스페이스에서 바로 확인할 수 있어요.'}
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
          </div>
        </main>
      </div>
      {privacyOpen && <PrivacyModal onClose={() => setPrivacyOpen(false)} />}
      {businessInfoOpen && <BusinessInfoModal onClose={() => setBusinessInfoOpen(false)} />}
    </div>
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
