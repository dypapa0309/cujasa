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
                        ? '가입하면 CUJASA 무료 체험 계정이 준비돼요. 실제 Threads 업로드 기준 5회까지 체험할 수 있어요.'
                        : '가입하면 선택한 솔루션이 JASAIN 계정에 연결돼요. 로그인 후 워크스페이스에서 바로 확인할 수 있어요.'}
                    </div>
                    <label className="flex items-start gap-2 rounded-2xl border border-white/10 bg-black/25 p-3 text-xs leading-relaxed text-zinc-500">
                      <input className="mt-0.5 h-4 w-4 rounded border-white/20 bg-black text-zinc-100" type="checkbox" checked={registerForm.privacyConsent} onChange={(e) => setRegisterForm((prev) => ({ ...prev, privacyConsent: e.target.checked }))} />
                      <span>개인정보 수집 및 이용에 동의해요. 연락처는 가입 확인, 서비스 안내, 상담 응대 목적으로 사용해요.</span>
                    </label>
                  </div>
                )}

                {coreDegraded ? (
                  <div className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-500/10 p-3 text-sm font-bold leading-relaxed text-amber-50">
                    현재 데이터베이스 연결이 지연되고 있습니다. 관리자 로그인은 계속 시도할 수 있고, 고객 로그인/회원가입은 DB 복구 후 정상화됩니다.
                  </div>
                ) : null}
                {error ? <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-3 text-sm font-bold text-zinc-200">{error}</div> : null}
                <button disabled={busy || (mode === 'register' && coreDegraded)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">
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
