import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import SettingsForm from '../components/SettingsForm.jsx';

export default function AccountSettingsPage({ selectedAccount, reloadAccounts }) {
  const toast = useToast();
  const [form, setForm] = useState(selectedAccount || {});
  const [saving, setSaving] = useState(false);

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

  if (!selectedAccount) return <div className="rounded border border-line bg-white p-5">계정을 먼저 선택하세요.</div>;
  return <SettingsForm form={form} setForm={setForm} onSubmit={submit} saving={saving} />;
}
