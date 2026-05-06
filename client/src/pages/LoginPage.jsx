import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.js';
import { CURRENT_PRODUCT, JASAIN_BRAND } from '../config/products.js';

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ buyerName: '', username: '', password: '', passwordConfirm: '' });
  const [mode, setMode] = useState('login');
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
    } catch (err) {
      setError(err.message || '로그인 정보를 확인하세요.');
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
    } catch (err) {
      setError(err.message || '회원가입 정보를 확인하세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-panel px-5">
      <form onSubmit={mode === 'login' ? submit : submitRegister} className="w-full max-w-sm rounded border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded bg-coupang text-white">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{JASAIN_BRAND.name} {mode === 'login' ? '로그인' : '회원가입'}</h1>
            <p className="text-sm text-slate-500">{CURRENT_PRODUCT.name} · {CURRENT_PRODUCT.description}</p>
          </div>
        </div>
        {mode === 'login' ? (
          <>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">아이디 또는 이메일</span>
              <input className="rounded border border-line px-3 py-2" type="text" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
            </label>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">비밀번호</span>
              <input className="rounded border border-line px-3 py-2" type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
            </label>
          </>
        ) : (
          <>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">고객명</span>
              <input
                className="rounded border border-line px-3 py-2"
                type="text"
                autoComplete="name"
                value={registerForm.buyerName}
                placeholder="예: 홍길동"
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, buyerName: e.target.value }))}
              />
            </label>
            <label className="mt-6 grid gap-1 text-sm">
              <span className="font-medium">아이디</span>
              <input
                className="rounded border border-line px-3 py-2"
                type="text"
                autoComplete="username"
                value={registerForm.username}
                placeholder="영문/숫자 3자 이상"
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </label>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">비밀번호</span>
              <input
                className="rounded border border-line px-3 py-2"
                type="password"
                autoComplete="new-password"
                value={registerForm.password}
                placeholder="8자 이상"
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <label className="mt-4 grid gap-1 text-sm">
              <span className="font-medium">비밀번호 확인</span>
              <input
                className="rounded border border-line px-3 py-2"
                type="password"
                autoComplete="new-password"
                value={registerForm.passwordConfirm}
                onChange={(e) => setRegisterForm((prev) => ({ ...prev, passwordConfirm: e.target.value }))}
              />
            </label>
            <div className="mt-4 rounded border border-blue-100 bg-blue-50 p-3 text-xs leading-relaxed text-blue-700">
              가입하면 무료 체험 계정이 자동으로 생성되고, 실제 Threads 업로드 3회까지 사용할 수 있습니다.
            </div>
          </>
        )}
        {error ? <div className="mt-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        <button disabled={busy} className="mt-5 w-full rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-50">
          {busy ? '확인 중' : mode === 'login' ? '로그인' : '무료로 시작하기'}
        </button>
        <button
          type="button"
          onClick={() => { setMode((prev) => prev === 'login' ? 'register' : 'login'); setError(''); }}
          className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-coupang"
        >
          {mode === 'login' ? '아이디가 없나요? 회원가입' : '이미 계정이 있나요? 로그인'}
        </button>
      </form>
    </div>
  );
}
