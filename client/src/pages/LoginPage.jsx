import { useState } from 'react';
import { ChevronRight, Lock, UserPlus } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.js';
import { CURRENT_PRODUCT, PRODUCTS, productById } from '../config/products.js';

const inputClass = 'w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-700 outline-none focus:border-white/30';
const labelClass = 'grid gap-2 text-sm font-bold text-zinc-300';

export default function LoginPage({ onLogin }) {
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get('mode') === 'register' ? 'register' : 'login';
  const requestedProduct = productById(params.get('product'))?.id || CURRENT_PRODUCT.id;
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
              {PRODUCTS.map((product) => (
                <div
                  key={product.id}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${registerForm.productId === product.id ? 'bg-white/10 text-white' : 'text-zinc-500'}`}
                >
                  {product.name}
                </div>
              ))}
            </div>
            <div className="mt-auto border-t border-white/10 pt-4 text-[11px] leading-relaxed text-zinc-600">
              <div>개인정보처리방침 · 사업자정보</div>
              <div className="mt-1">© 2026 JASAIN</div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-screen items-center justify-center px-5 py-10">
          <div className="w-full max-w-5xl">
            <div className="mx-auto mb-8 flex w-full max-w-3xl items-center justify-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-zinc-400">
              {mode === 'login' ? <Lock size={14} /> : <UserPlus size={14} />}
              {mode === 'login' ? 'JASAIN 계정으로 계속하기' : 'JASAIN 워크스페이스 시작하기'}
            </div>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
              <section className="text-center lg:text-left">
                <h1 className="text-4xl font-semibold tracking-normal text-zinc-100 sm:text-6xl">
                  무엇을 자동화할까요?
                </h1>
                <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-zinc-500 lg:mx-0">
                  로그인하면 CUJASA, DEXOR, SPREAD를 한 워크스페이스에서 선택하고 작업을 이어갈 수 있어요.
                </p>
              </section>

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
                    <label className={labelClass}>사용할 솔루션<select className={inputClass} value={registerForm.productId} onChange={(e) => setRegisterForm((prev) => ({ ...prev, productId: e.target.value }))}>{PRODUCTS.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.supportLabel}</option>)}</select></label>
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

                {error ? <div className="mt-4 rounded-2xl border border-white/10 bg-black/40 p-3 text-sm font-bold text-zinc-200">{error}</div> : null}
                <button disabled={busy} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-zinc-950 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60">
                  {busy ? '확인 중' : mode === 'login' ? '로그인' : '무료로 시작하기'}
                  <ChevronRight size={18} />
                </button>
              </form>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ensureBetaHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('tab') === 'beta') return;
  window.history.replaceState({ tab: 'beta' }, '', `${window.location.pathname}${window.location.search}#tab=beta`);
}
