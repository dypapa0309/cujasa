import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';

export default function CustomerSettingsPage({ account, reloadAccounts }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    if (!account) return;
    setForm({
      threads_access_token: account.threads_access_token || '',
      daily_post_min: account.daily_post_min ?? 2,
      daily_post_max: account.daily_post_max ?? 4,
      active_time_windows: account.active_time_windows?.length
        ? account.active_time_windows
        : [{ start: '09:00', end: '22:00' }],
    });
  }, [account?.id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/accounts/${account.id}`, form);
      await reloadAccounts();
      toast('저장됐습니다.', 'success');
    } catch {
      toast('저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const updateWindow = (i, key, val) => {
    setForm((p) => ({
      ...p,
      active_time_windows: p.active_time_windows.map((w, idx) => idx === i ? { ...w, [key]: val } : w)
    }));
  };

  if (!form) return null;

  return (
    <div className="grid gap-5">

      {/* Threads 연결 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-800 mb-1">Threads 계정 연결</h3>
        <p className="text-xs text-gray-400 mb-4">Threads 액세스 토큰을 입력하면 자동 포스팅이 활성화됩니다</p>

        <div className="relative">
          <input
            type={showToken ? 'text' : 'password'}
            value={form.threads_access_token}
            onChange={(e) => setForm((p) => ({ ...p, threads_access_token: e.target.value }))}
            placeholder="Threads 액세스 토큰 입력"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-16 text-sm focus:outline-none focus:border-coupang transition-colors"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
          >
            {showToken ? '숨기기' : '보기'}
          </button>
        </div>

        {!form.threads_access_token && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
            토큰이 없으면 포스팅이 실제로 올라가지 않습니다. 담당자에게 문의하거나 직접 발급해주세요.
          </div>
        )}
      </div>

      {/* 하루 포스팅 수 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-800 mb-4">하루 포스팅 수</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="text-gray-500 font-medium">최소</span>
            <input
              type="number" min="1" max="10"
              value={form.daily_post_min}
              onChange={(e) => setForm((p) => ({ ...p, daily_post_min: Number(e.target.value) }))}
              className="border border-gray-200 rounded-xl px-4 py-3 text-center font-bold text-lg focus:outline-none focus:border-coupang"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="text-gray-500 font-medium">최대</span>
            <input
              type="number" min="1" max="10"
              value={form.daily_post_max}
              onChange={(e) => setForm((p) => ({ ...p, daily_post_max: Number(e.target.value) }))}
              className="border border-gray-200 rounded-xl px-4 py-3 text-center font-bold text-lg focus:outline-none focus:border-coupang"
            />
          </label>
        </div>
        <p className="text-xs text-gray-400 mt-3">설정 범위 안에서 매일 랜덤하게 올라갑니다</p>
      </div>

      {/* 업로드 시간대 */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="font-bold text-gray-800 mb-1">업로드 시간대</h3>
        <p className="text-xs text-gray-400 mb-4">이 시간대 안에서 랜덤하게 발행됩니다</p>
        <div className="grid gap-3">
          {form.active_time_windows.map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <input type="time" value={w.start}
                onChange={(e) => updateWindow(i, 'start', e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-coupang" />
              <span className="text-gray-400 text-sm">~</span>
              <input type="time" value={w.end}
                onChange={(e) => updateWindow(i, 'end', e.target.value)}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-coupang" />
            </div>
          ))}
        </div>
      </div>

      {/* 저장 버튼 */}
      <button
        onClick={save}
        disabled={saving}
        className="w-full bg-coupang hover:bg-coupang-dark text-white font-black py-4 rounded-2xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {saving && <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
        {saving ? '저장 중...' : '저장하기'}
      </button>
    </div>
  );
}
