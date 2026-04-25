import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import SettingsForm from '../components/SettingsForm.jsx';

export default function AccountSettingsPage({ selectedAccount, reloadAccounts }) {
  const [form, setForm] = useState(selectedAccount || {});
  useEffect(() => { setForm(selectedAccount || {}); }, [selectedAccount]);
  const submit = async (e) => {
    e.preventDefault();
    const saved = await api.patch(`/api/accounts/${form.id}`, form);
    setForm(saved);
    await reloadAccounts?.();
  };
  if (!selectedAccount) return <div className="rounded border border-line bg-white p-5">계정을 먼저 선택하세요.</div>;
  return <SettingsForm form={form} setForm={setForm} onSubmit={submit} />;
}
