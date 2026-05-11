import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import AccountCard from '../components/AccountCard.jsx';
import AccountSettingsPage from './AccountSettingsPage.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

export default function AccountListPage({ accounts, reloadAccounts, setSelectedAccountId, currentUser, accountSettingsOpenId, onAccountSettingsOpened }) {
  const [editing, setEditing] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [adminRows, setAdminRows] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [accountActionId, setAccountActionId] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [customerFilter, setCustomerFilter] = useState('');
  const isAdmin = !currentUser || currentUser.type === 'admin';
  const maxAccounts = currentUser?.maxAccounts ?? 999;
  const atLimit = !isAdmin && accounts.length >= maxAccounts;
  const sourceAccounts = isAdmin && showArchived ? adminRows : accounts;
  const accountOwners = [...new Map(sourceAccounts
    .filter((account) => account.owner)
    .map((account) => [account.owner.id, account.owner])).values()]
    .sort((a, b) => String(a.buyerName || a.username || a.email).localeCompare(String(b.buyerName || b.username || b.email)));
  const customers = (adminUsers.length > 0 ? adminUsers : accountOwners)
    .filter((customer) => customer?.id)
    .sort((a, b) => String(a.buyerName || a.buyer_name || a.username || a.email).localeCompare(String(b.buyerName || b.buyer_name || b.username || b.email)));
  const customerOptions = customers.map((customer) => {
    const buyerName = customer.buyerName || customer.buyer_name || '';
    const label = [buyerName || customer.username || customer.email, customer.username ? `ID ${customer.username}` : ''].filter(Boolean).join(' · ');
    return {
      value: customer.id,
      label,
      searchText: [label, customer.email, buyerName, customer.username].filter(Boolean).join(' ')
    };
  });
  const displayAccounts = customerFilter
    ? sourceAccounts.filter((account) => account.owner?.id === customerFilter)
    : sourceAccounts;

  const loadAdminRows = async () => {
    if (!isAdmin || !showArchived) return;
    setAdminRows(await api.get('/api/accounts?includeArchived=1'));
  };

  const loadAdminUsers = async () => {
    if (!isAdmin) return;
    setAdminUsers(await api.get('/api/admin/users'));
  };

  useEffect(() => {
    loadAdminRows().catch(console.error);
  }, [showArchived, isAdmin]);

  useEffect(() => {
    loadAdminUsers().catch(console.error);
  }, [isAdmin]);

  useEffect(() => {
    if (!accountSettingsOpenId) return;
    const account = displayAccounts.find((item) => item.id === accountSettingsOpenId);
    if (account) {
      setEditing(account);
      onAccountSettingsOpened?.();
    }
  }, [accountSettingsOpenId, displayAccounts, onAccountSettingsOpened]);

  const create = async () => {
    if (creatingAccount) return;
    if (isAdmin && !customerFilter) {
      alert('계정을 생성할 구매자를 먼저 선택해주세요.');
      return;
    }
    setCreatingAccount(true);
    try {
      const existingProjectId = sourceAccounts.find((account) => account.project_id)?.project_id
        || accounts.find((account) => account.project_id)?.project_id;
      let projectId = existingProjectId;
      if (!projectId) {
        const projects = await api.get('/api/projects');
        projectId = projects[0]?.id;
      }
      if (!projectId) {
        alert('프로젝트가 없습니다. 관리자에게 문의하세요.');
        return;
      }
      const account = await api.post('/api/accounts', {
        project_id: projectId,
        owner_user_id: isAdmin ? customerFilter : undefined,
        name: '새 쿠팡 계정',
        target_audience: '타깃을 입력하세요',
        content_scope: '다룰 주제 범위를 입력하세요',
        tone: '친근하고 짧게',
        cta_style: '댓글 유도형'
      });
      setSelectedAccountId(account.id);
      setEditing(account);
      await reloadAccounts();
      if (showArchived) await loadAdminRows();
    } catch (error) {
      if (error?.status === 401) {
        alert('로그인이 만료됐어요. 다시 로그인한 뒤 계정을 생성해주세요.');
      } else {
        alert(error?.message || '계정 생성에 실패했습니다.');
      }
    } finally {
      setCreatingAccount(false);
    }
  };
  const refreshRows = async () => {
    await reloadAccounts?.();
    if (showArchived) await loadAdminRows();
  };
  const archive = async (account) => {
    if (!window.confirm(`${account.name} 계정을 보관 처리할까요? 예약/게시/분석 기록은 보관됩니다.`)) return;
    setAccountActionId(account.id);
    try {
      await api.delete(`/api/accounts/${account.id}`);
      await refreshRows();
    } finally {
      setAccountActionId('');
    }
  };
  const hardDelete = async (account) => {
    if (!window.confirm(`${account.name} 계정을 완전 삭제할까요? 이 작업은 보관 계정에서만 가능하며 되돌릴 수 없습니다.`)) return;
    setAccountActionId(account.id);
    try {
      await api.delete(`/api/accounts/${account.id}?hard=true`);
      await refreshRows();
    } finally {
      setAccountActionId('');
    }
  };
  if (editing) return <AccountSettingsPage selectedAccount={editing} reloadAccounts={reloadAccounts} />;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        {!isAdmin && (
          <div className="text-sm text-slate-500">
            계정 <span className="font-semibold">{accounts.length}</span> / {maxAccounts}
            {atLimit && <span className="ml-2 text-xs text-red-500 font-medium">한도 도달 — 추가 계정은 문의해주세요</span>}
          </div>
        )}
        {isAdmin && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SearchableSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              options={customerOptions}
              placeholder="전체 고객"
              searchPlaceholder="고객명 또는 ID 검색"
              clearable
              className="w-56"
            />
            <label className="flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm text-slate-600">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              보관 계정 보기
            </label>
          </div>
        )}
        {(isAdmin || !atLimit) && (
          <button
            onClick={create}
            disabled={creatingAccount}
            className={`${isAdmin ? '' : 'ml-auto'} rounded bg-coupang px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {creatingAccount ? '생성 중...' : isAdmin && customerFilter ? '선택 고객 계정 생성' : '계정 생성'}
          </button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {displayAccounts.map((account) => (
          <div key={account.id} className="grid gap-2">
            <AccountCard account={account} onSelect={setEditing} />
            {isAdmin && (
              <div className="flex gap-2">
                {account.status === 'archived' ? (
                  <button
                    type="button"
                    onClick={() => hardDelete(account)}
                    disabled={accountActionId === account.id}
                    className="flex-1 rounded border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 disabled:opacity-50"
                  >
                    {accountActionId === account.id ? '처리 중...' : '완전 삭제'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => archive(account)}
                    disabled={accountActionId === account.id}
                    className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-700 disabled:opacity-50"
                  >
                    {accountActionId === account.id ? '처리 중...' : '보관'}
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
