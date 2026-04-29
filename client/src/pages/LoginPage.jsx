import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.js';
import { CURRENT_PRODUCT, JASAIN_BRAND } from '../config/products.js';

export default function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' });
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

  return (
    <div className="grid min-h-screen place-items-center bg-panel px-5">
      <form onSubmit={submit} className="w-full max-w-sm rounded border border-line bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded bg-coupang text-white">
            <ShieldCheck size={21} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{JASAIN_BRAND.name} 로그인</h1>
            <p className="text-sm text-slate-500">{CURRENT_PRODUCT.name} · {CURRENT_PRODUCT.description}</p>
          </div>
        </div>
        <label className="mt-6 grid gap-1 text-sm">
          <span className="font-medium">이메일</span>
          <input className="rounded border border-line px-3 py-2" type="email" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
        </label>
        <label className="mt-4 grid gap-1 text-sm">
          <span className="font-medium">비밀번호</span>
          <input className="rounded border border-line px-3 py-2" type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
        </label>
        {error ? <div className="mt-4 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        <button disabled={busy} className="mt-5 w-full rounded bg-coupang px-4 py-2 font-medium text-white disabled:opacity-50">
          {busy ? '확인 중' : '로그인'}
        </button>
      </form>
    </div>
  );
}
