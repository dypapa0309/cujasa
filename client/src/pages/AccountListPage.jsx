import { useState } from 'react';
import { api } from '../lib/api.js';
import AccountCard from '../components/AccountCard.jsx';
import AccountSettingsPage from './AccountSettingsPage.jsx';

export default function AccountListPage({ accounts, reloadAccounts, setSelectedAccountId }) {
  const [editing, setEditing] = useState(null);
  const create = async () => {
    const projects = await api.get('/api/projects');
    const project = projects[0];
    if (!project) {
      alert('프로젝트가 없습니다. 관리자에게 문의하세요.');
      return;
    }
    const account = await api.post('/api/accounts', {
      project_id: project.id,
      name: '새 쿠팡 계정',
      target_audience: '타깃을 입력하세요',
      content_scope: '다룰 주제 범위를 입력하세요',
      tone: '친근하고 짧게',
      cta_style: '댓글 유도형'
    });
    setSelectedAccountId(account.id);
    setEditing(account);
    await reloadAccounts();
  };
  if (editing) return <AccountSettingsPage selectedAccount={editing} reloadAccounts={reloadAccounts} />;
  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <button onClick={create} className="rounded bg-coupang px-4 py-2 font-medium text-white">계정 생성</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => <AccountCard key={account.id} account={account} onSelect={setEditing} />)}
      </div>
    </div>
  );
}
