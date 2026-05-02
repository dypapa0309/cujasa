import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import SettingsForm from '../components/SettingsForm.jsx';

export default function AccountSettingsPage({ selectedAccount, reloadAccounts }) {
  const toast = useToast();
  const [form, setForm] = useState(selectedAccount || {});
  const [saving, setSaving] = useState(false);
  const [connectingThreads, setConnectingThreads] = useState(false);

  useEffect(() => { setForm(selectedAccount || {}); }, [selectedAccount]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const saved = await api.patch(`/api/accounts/${form.id}`, form);
      setForm(saved);
      await reloadAccounts?.();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const connectThreads = async () => {
    if (!selectedAccount?.id) return;
    setConnectingThreads(true);
    try {
      const payload = await api.get(`/api/auth/threads/start?accountId=${selectedAccount.id}`);
      if (payload?.url) window.location.href = payload.url;
    } catch (err) {
      toast(err.message || 'Threads 연결을 시작하지 못했습니다.', 'error');
      setConnectingThreads(false);
    }
  };

  if (!selectedAccount) return <div className="rounded border border-line bg-white p-5">계정을 먼저 선택하세요.</div>;
  return (
    <div className="grid gap-4">
      <div className="rounded border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Threads OAuth 연결</div>
            <div className={`mt-1 text-xs font-medium ${selectedAccount.threads_access_token ? 'text-emerald-600' : 'text-rose-500'}`}>
              {selectedAccount.threads_access_token ? '연결됨' : '미연결'} · {selectedAccount.account_handle || '핸들 미입력'}
            </div>
          </div>
          <button
            type="button"
            onClick={connectThreads}
            disabled={connectingThreads}
            className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {connectingThreads ? '연결 이동 중...' : selectedAccount.threads_access_token ? '다시 연결하기' : 'Threads 연결하기'}
          </button>
        </div>
      </div>
      <SettingsForm form={form} setForm={setForm} onSubmit={submit} saving={saving} />
    </div>
  );
}
