import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

export default function AdminUsersPage({ accounts, openAccountSettings }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [misassignments, setMisassignments] = useState({ separable: [], needsReview: [], healthy: [] });
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ buyerName: '', email: '', password: '', maxAccounts: 2 });
  const [creating, setCreating] = useState(false);
  const [buyerNameDrafts, setBuyerNameDrafts] = useState({});
  const [accountDrafts, setAccountDrafts] = useState({});

  const load = async () => {
    const [nextUsers, nextProducts, nextConflicts, nextMisassignments] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/products'),
      api.get('/api/admin/account-conflicts'),
      api.get('/api/admin/account-misassignments'),
    ]);
    setUsers(nextUsers);
    setProducts(nextProducts);
    setConflicts(nextConflicts);
    setMisassignments(nextMisassignments);
    setBuyerNameDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, user.buyer_name || user.buyerName || ''])));
  };

  useEffect(() => {
    load().catch(() => toast('구매자 목록을 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const createUser = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/api/admin/users', { ...form, buyer_name: form.buyerName });
      await load();
      setForm({ buyerName: '', email: '', password: '', maxAccounts: 2 });
      setShowCreate(false);
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '생성에 실패했습니다.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const assignAccount = async (userId, accountId) => {
    try {
      await api.post(`/api/admin/users/${userId}/accounts`, { accountId });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '할당에 실패했습니다.', 'error');
    }
  };

  const createAndAssignAccount = async (user) => {
    const draft = accountDrafts[user.id] || {};
    const name = String(draft.name || '').trim();
    const accountHandle = String(draft.account_handle || '').trim();
    const trackingCode = String(draft.coupang_tracking_code || '').trim();
    if (!name) {
      toast('Threads 계정 이름을 입력해주세요.', 'error');
      return;
    }
    if ((user.accounts?.length || 0) >= user.max_accounts) {
      toast(`계정 한도 초과 (최대 ${user.max_accounts}개)`, 'error');
      return;
    }
    try {
      const account = await api.post('/api/accounts', {
        name,
        account_handle: accountHandle,
        platform: 'threads',
        project_id: '00000000-0000-0000-0000-000000000001',
        coupang_tracking_code: trackingCode
      });
      await api.post(`/api/admin/users/${user.id}/accounts`, { accountId: account.id });
      setAccountDrafts((prev) => ({ ...prev, [user.id]: { name: '', account_handle: '', coupang_tracking_code: '' } }));
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || 'Threads 계정 생성/할당에 실패했습니다.', 'error');
    }
  };

  const unassignAccount = async (userId, accountId) => {
    if (!confirm('계정 할당을 해제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/users/${userId}/accounts/${accountId}`);
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('해제에 실패했습니다.', 'error');
    }
  };

  const assignProduct = async (userId, productId) => {
    try {
      await api.post(`/api/admin/users/${userId}/products`, { productId });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '제품 권한 추가에 실패했습니다.', 'error');
    }
  };

  const saveProductSettings = async (userId, productId, settings) => {
    try {
      await api.patch(`/api/admin/users/${userId}/products/${productId}/settings`, settings);
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '제품 설정 저장에 실패했습니다.', 'error');
    }
  };

  const updateBuyerName = async (user, buyerName) => {
    const next = String(buyerName || '').trim();
    if (next === (user.buyer_name || user.buyerName || '')) {
      toast('이미 저장된 값입니다.', 'info');
      return;
    }
    try {
      await api.patch(`/api/admin/users/${user.id}`, { buyerName: next, buyer_name: next });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('구매자명 저장에 실패했습니다.', 'error');
    }
  };

  const updateAccountTrackingCode = async (account, trackingCode) => {
    const next = String(trackingCode || '').trim();
    if (next === (account.coupang_tracking_code || '')) return;
    try {
      await api.patch(`/api/accounts/${account.id}`, { coupang_tracking_code: next });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || 'Tracking Code 저장에 실패했습니다.', 'error');
    }
  };

  const connectThreads = async (account) => {
    try {
      const payload = await api.get(`/api/auth/threads/start?accountId=${account.id}`);
      if (payload?.url) window.location.href = payload.url;
    } catch (err) {
      toast(err.message || 'Threads 연결을 시작하지 못했습니다.', 'error');
    }
  };

  const disconnectThreads = async (accountId) => {
    if (!confirm('이 계정의 Threads 연결을 해제하고 고객에게 다시 연결 요청할까요?')) return;
    try {
      await api.post(`/api/admin/accounts/${accountId}/disconnect-threads`, {});
      await load();
      toast('Threads 연결을 해제했습니다.', 'success');
    } catch (err) {
      toast(err.message || 'Threads 연결 해제에 실패했습니다.', 'error');
    }
  };

  const cleanupMisassignments = async (mode) => {
    if (mode === 'apply' && !confirm('확정 분리 가능 계정의 고객 할당만 해제합니다. 진행할까요?')) return;
    try {
      const result = await api.post('/api/admin/account-misassignments/cleanup', { mode });
      await load();
      toast(mode === 'apply' ? `${result.unassigned || 0}개 할당을 해제했습니다.` : `해제 후보 ${result.targets?.length || 0}개를 확인했습니다.`, 'success');
    } catch (err) {
      toast(err.message || '잘못 배정 정리에 실패했습니다.', 'error');
    }
  };

  const unassignSuspectedAccount = async (row) => {
    if (!confirm(`${row.userEmail}에서 ${row.accountName} 계정을 해제할까요?`)) return;
    try {
      await api.post('/api/admin/account-misassignments/unassign', { userId: row.userId, accountId: row.accountId });
      await load();
      toast('계정 할당을 해제했습니다.', 'success');
    } catch (err) {
      toast(err.message || '계정 해제에 실패했습니다.', 'error');
    }
  };

  const reassignSuspectedAccount = async (row) => {
    if (!row.recommendedOwner?.userId) return;
    if (!confirm(`${row.accountName} 계정을 ${row.recommendedOwner.userEmail} 고객에게 옮길까요?`)) return;
    try {
      await api.post('/api/admin/account-misassignments/reassign', {
        fromUserId: row.userId,
        toUserId: row.recommendedOwner.userId,
        accountId: row.accountId
      });
      await load();
      toast('계정 소유자를 변경했습니다.', 'success');
    } catch (err) {
      toast(err.message || '소유자 변경에 실패했습니다.', 'error');
    }
  };

  const markMisassignmentOk = async (row) => {
    try {
      await api.post('/api/admin/account-misassignments/mark-ok', { userId: row.userId, accountId: row.accountId, row });
      await load();
      toast('정상 항목으로 표시했습니다.', 'success');
    } catch (err) {
      toast(err.message || '정상 표시 저장에 실패했습니다.', 'error');
    }
  };

  const unassignProduct = async (userId, productId) => {
    if (!confirm('제품 권한을 해제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/users/${userId}/products/${productId}`);
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('제품 권한 해제에 실패했습니다.', 'error');
    }
  };

  const toggleStatus = async (user) => {
    const next = user.status === 'active' ? 'suspended' : 'active';
    try {
      await api.patch(`/api/admin/users/${user.id}`, { status: next });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('상태 변경에 실패했습니다.', 'error');
    }
  };

  const updateMaxAccounts = async (user, maxAccounts) => {
    try {
      await api.patch(`/api/admin/users/${user.id}`, { maxAccounts: Number(maxAccounts) });
      await load();
      toast('설정이 변경되었습니다.', 'success');
    } catch {
      toast('변경에 실패했습니다.', 'error');
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">고객 계정 및 제품 권한 관리</div>
        <button onClick={() => setShowCreate((v) => !v)} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white">
          {showCreate ? '취소' : '+ 구매자 생성'}
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createUser} className="rounded border border-line bg-white p-5 grid gap-4 md:grid-cols-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">구매자명</span>
            <input className="rounded border border-line px-3 py-2" value={form.buyerName} onChange={(e) => setForm((p) => ({ ...p, buyerName: e.target.value }))} placeholder="예: 박순상" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">이메일</span>
            <input type="email" required className="rounded border border-line px-3 py-2" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">비밀번호</span>
            <input type="password" required className="rounded border border-line px-3 py-2" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">계정 한도</span>
            <input type="number" min="1" max="20" className="rounded border border-line px-3 py-2" value={form.maxAccounts} onChange={(e) => setForm((p) => ({ ...p, maxAccounts: Number(e.target.value) }))} />
          </label>
          <div className="md:col-span-4">
            <button disabled={creating} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {creating ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      )}

      <ConflictPanel conflicts={conflicts} onDisconnect={disconnectThreads} />
      <MisassignmentPanel
        report={misassignments}
        onDryRun={() => cleanupMisassignments('dry-run')}
        onApply={() => cleanupMisassignments('apply')}
        onUnassign={unassignSuspectedAccount}
        onReassign={reassignSuspectedAccount}
        onMarkOk={markMisassignmentOk}
      />

      {loading ? (
        <div className="grid gap-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded border border-line bg-white" />)}</div>
      ) : users.length === 0 ? (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">등록된 구매자가 없습니다</div>
      ) : (
        <div className="grid gap-4">
          {users.map((user) => {
            const assignedIds = user.accounts?.map((a) => a.id) || [];
            const unassigned = accounts.filter((a) => !assignedIds.includes(a.id));
            const grantedProductIds = user.products?.map((product) => product.productId) || [];
            const ungrantedProducts = products.filter((product) => !grantedProductIds.includes(product.id));
            return (
              <div key={user.id} className="rounded border border-line bg-white p-5">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <label className="grid gap-1">
                    <span className="text-[11px] font-semibold text-slate-400">구매자명</span>
                    <div className="flex gap-1">
                      <input
                        className="w-32 rounded border border-line px-2 py-1 text-sm font-semibold"
                        value={buyerNameDrafts[user.id] ?? user.buyer_name ?? user.buyerName ?? ''}
                        placeholder="미입력"
                        onChange={(e) => setBuyerNameDrafts((prev) => ({ ...prev, [user.id]: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => updateBuyerName(user, buyerNameDrafts[user.id] ?? '')}
                        className="rounded border border-line px-2 py-1 text-xs font-semibold text-slate-600 hover:border-coupang hover:text-coupang"
                      >
                        저장
                      </button>
                    </div>
                  </label>
                  <div>
                    <div className="font-semibold text-sm">{user.email}</div>
                    {(user.buyer_name || user.buyerName) && <div className="text-xs text-slate-400">{user.buyer_name || user.buyerName}</div>}
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {user.status === 'active' ? '활성' : '정지'}
                  </span>
                  <div className="text-xs text-slate-400">
                    계정 {user.accounts?.length ?? 0} /
                    <input
                      type="number" min="1" max="20"
                      className="ml-1 w-10 rounded border border-line px-1 text-center text-xs"
                      defaultValue={user.max_accounts}
                      onBlur={(e) => { if (Number(e.target.value) !== user.max_accounts) updateMaxAccounts(user, e.target.value); }}
                    />
                    <span className="ml-1">한도</span>
                  </div>
                  <button onClick={() => toggleStatus(user)} className="ml-auto text-xs text-slate-500 hover:text-slate-800 border border-line rounded px-2 py-1">
                    {user.status === 'active' ? '정지' : '활성화'}
                  </button>
                </div>

                <div className="grid gap-2 border-t border-line pt-4">
                  <div className="text-xs font-semibold text-slate-500">보유 제품 및 제품별 설정</div>
                  {user.products?.length === 0 && <div className="text-xs text-slate-400">보유 제품 없음</div>}
                  <div className="grid gap-3">
                    {user.products?.map((product) => (
                      <ProductGrantCard
                        key={product.productId}
                        userId={user.id}
                        product={product}
                        onRevoke={() => unassignProduct(user.id, product.productId)}
                        onSaveSettings={saveProductSettings}
                      />
                    ))}
                  </div>
                  {ungrantedProducts.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <select className="rounded border border-line px-2 py-1 text-xs" defaultValue=""
                        onChange={(e) => { if (e.target.value) { assignProduct(user.id, e.target.value); e.target.value = ''; } }}>
                        <option value="">+ 제품 권한 추가...</option>
                        {ungrantedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="mt-4 grid gap-2 border-t border-line pt-4">
                  <div className="text-xs font-semibold text-slate-500">할당된 Threads 계정</div>
                  {user.accounts?.length === 0 && <div className="text-xs text-slate-400">할당된 계정 없음</div>}
                  <div className="grid gap-2">
                    {user.accounts?.map((a) => (
                      <div key={a.id} className="grid gap-2 rounded border border-line bg-gray-50 p-3 md:grid-cols-[1.4fr_1fr_auto_auto_auto] md:items-center">
                        <div>
                          <div className="text-sm font-semibold">{a.name}</div>
                          <div className="text-xs text-slate-400">{a.account_handle || '핸들 미입력'} · Threads {connectionText(a)}</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            {a.threads_user_id ? `ID ${a.threads_user_id}` : 'Threads ID 없음'}
                            {a.threads_connected_at ? ` · 연결 ${formatDateTime(a.threads_connected_at)}` : ''}
                            {a.threads_token_expires_at ? ` · 만료 ${formatDateTime(a.threads_token_expires_at)}` : ''}
                          </div>
                        </div>
                        <label className="grid gap-1 text-xs">
                          <span className="font-semibold text-slate-500">계정별 Tracking Code</span>
                          <input
                            className="rounded border border-line bg-white px-2 py-1.5"
                            defaultValue={a.coupang_tracking_code || ''}
                            placeholder="없으면 고객 기본값 사용"
                            onBlur={(e) => updateAccountTrackingCode(a, e.target.value)}
                          />
                        </label>
                        <button onClick={() => openAccountSettings?.(a.id)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-coupang hover:text-coupang">
                          설정 열기
                        </button>
                        <button onClick={() => connectThreads(a)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-gray-900 hover:text-gray-900">
                          {a.threads_access_token ? '재연결' : 'Threads 연결'}
                        </button>
                        <button onClick={() => unassignAccount(user.id, a.id)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-red-500 hover:border-red-300">
                          해제
                        </button>
                      </div>
                    ))}
                  </div>

                  {unassigned.length > 0 && user.accounts?.length < user.max_accounts && (
                    <div className="flex items-center gap-2 mt-1">
                      <select className="rounded border border-line px-2 py-1 text-xs" defaultValue=""
                        onChange={(e) => { if (e.target.value) { assignAccount(user.id, e.target.value); e.target.value = ''; } }}>
                        <option value="">+ 계정 할당...</option>
                        {unassigned.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                  )}
                  {user.accounts?.length < user.max_accounts && (
                    <div className="mt-2 rounded border border-dashed border-line bg-white p-3">
                      <div className="mb-2 text-xs font-semibold text-slate-500">고객 Threads 계정 새로 만들고 바로 할당</div>
                      <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                        <label className="grid gap-1 text-xs">
                          <span className="font-semibold text-slate-500">계정 이름</span>
                          <input
                            className="rounded border border-line px-2 py-1.5"
                            value={accountDrafts[user.id]?.name || ''}
                            placeholder="예: andsomwith01 꿀템"
                            onChange={(e) => setAccountDrafts((prev) => ({ ...prev, [user.id]: { ...(prev[user.id] || {}), name: e.target.value } }))}
                          />
                        </label>
                        <label className="grid gap-1 text-xs">
                          <span className="font-semibold text-slate-500">Threads 핸들</span>
                          <input
                            className="rounded border border-line px-2 py-1.5"
                            value={accountDrafts[user.id]?.account_handle || ''}
                            placeholder="@ 포함 가능"
                            onChange={(e) => setAccountDrafts((prev) => ({ ...prev, [user.id]: { ...(prev[user.id] || {}), account_handle: e.target.value } }))}
                          />
                        </label>
                        <label className="grid gap-1 text-xs">
                          <span className="font-semibold text-slate-500">Tracking Code</span>
                          <input
                            className="rounded border border-line px-2 py-1.5"
                            value={accountDrafts[user.id]?.coupang_tracking_code || ''}
                            placeholder="없으면 고객 기본값"
                            onChange={(e) => setAccountDrafts((prev) => ({ ...prev, [user.id]: { ...(prev[user.id] || {}), coupang_tracking_code: e.target.value } }))}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => createAndAssignAccount(user)}
                          className="rounded bg-coupang px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          생성/할당
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function connectionText(account) {
  if (!account.threads_access_token) return 'Threads 연결 필요';
  if (account.threads_token_status === 'refresh_failed') return '다시 연결 필요';
  return `연결됨${account.threads_token_status ? ` · ${account.threads_token_status}` : ''}`;
}

function formatDateTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function ConflictPanel({ conflicts, onDisconnect }) {
  if (!conflicts?.length) {
    return (
      <div className="rounded border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        계정 충돌 점검: 현재 감지된 중복 연결/다중 할당 문제가 없습니다.
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-4">
      <div>
        <div className="text-sm font-black text-amber-900">계정 충돌 점검</div>
        <div className="text-xs text-amber-700">중복 연결은 고객 재연결 전 먼저 해제하는 것이 안전합니다.</div>
      </div>
      <div className="grid gap-2">
        {conflicts.map((conflict, index) => (
          <div key={`${conflict.type}-${conflict.key}-${index}`} className="rounded border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${conflict.severity === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-amber-100 text-amber-700'}`}>
                {conflict.severity === 'error' ? '오류' : '주의'}
              </span>
              <span className="text-sm font-bold text-slate-800">{conflict.label}</span>
              <span className="text-xs text-slate-400">{conflict.key}</span>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-slate-500">
              {conflict.accounts?.map((account) => (
                <div key={account.id} className="flex flex-wrap items-center gap-2">
                  <span>{account.label || account.name}</span>
                  {(conflict.type === 'duplicate_threads_user_id' || conflict.type === 'duplicate_account_handle') && (
                    <button type="button" onClick={() => onDisconnect(account.id)} className="rounded border border-line px-2 py-0.5 text-[11px] font-semibold text-rose-500 hover:border-rose-300">
                      Threads 해제
                    </button>
                  )}
                </div>
              ))}
              {conflict.users?.length > 0 && (
                <div>고객: {conflict.users.map((user) => user.email).join(', ')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MisassignmentPanel({ report, onDryRun, onApply, onUnassign, onReassign, onMarkOk }) {
  const separable = report?.separable || [];
  const needsReview = report?.needsReview || [];
  const total = separable.length + needsReview.length;
  if (!total) {
    return (
      <div className="rounded border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        잘못 배정 의심: 현재 고객명/핸들 기준으로 의심되는 계정 노출 문제가 없습니다.
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded border border-rose-200 bg-rose-50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-rose-900">잘못 배정 의심</div>
          <div className="text-xs text-rose-700">
            확정 분리 가능 {separable.length}개 · 검토 필요 {needsReview.length}개
          </div>
        </div>
        <button type="button" onClick={onDryRun} className="rounded border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100">
          dry-run
        </button>
        <button type="button" onClick={onApply} className="rounded bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700">
          확정 항목 자동 해제
        </button>
      </div>
      <MisassignmentGroup title="확정 분리 가능" rows={separable} tone="error" onUnassign={onUnassign} onReassign={onReassign} onMarkOk={onMarkOk} />
      <MisassignmentGroup title="검토 필요" rows={needsReview} tone="warn" onUnassign={onUnassign} onReassign={onReassign} onMarkOk={onMarkOk} />
    </div>
  );
}

function MisassignmentGroup({ title, rows, tone, onUnassign, onReassign, onMarkOk }) {
  if (!rows?.length) return null;
  const badgeClass = tone === 'error' ? 'bg-rose-50 text-rose-600' : 'bg-amber-100 text-amber-700';
  return (
    <div className="grid gap-2">
      <div className="text-xs font-black text-slate-600">{title}</div>
      {rows.map((row) => (
        <div key={`${row.userId}-${row.accountId}`} className="rounded border border-rose-100 bg-white p-3">
          <div className="flex flex-wrap items-start gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>{row.classification}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-slate-800">
                {row.accountName} <span className="text-xs font-medium text-slate-400">{row.accountHandle || '핸들 없음'}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                현재 고객: {row.userEmail}{row.buyerName ? ` · ${row.buyerName}` : ''} · 점수 {row.currentScore}
                {row.overAssigned ? ` · 한도 초과 ${row.assignedCount}/${row.maxAccounts}` : ''}
              </div>
              {row.recommendedOwner && (
                <div className="mt-1 text-xs text-slate-500">
                  추천 소유자: {row.recommendedOwner.userEmail}
                  {row.recommendedOwner.buyerName ? ` · ${row.recommendedOwner.buyerName}` : ''} · 점수 {row.recommendedOwner.score}
                </div>
              )}
              <div className="mt-1 text-[11px] text-slate-400">
                근거: {[...(row.currentReasons || []), ...(row.recommendedOwner?.reasons || [])].join(', ') || '매칭 근거 부족'}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onUnassign(row)} className="rounded border border-line px-2 py-1 text-xs font-bold text-rose-600 hover:border-rose-300">
                해제
              </button>
              {row.recommendedOwner?.userId && (
                <button type="button" onClick={() => onReassign(row)} className="rounded border border-line px-2 py-1 text-xs font-bold text-slate-600 hover:border-coupang hover:text-coupang">
                  소유자 변경
                </button>
              )}
              <button type="button" onClick={() => onMarkOk(row)} className="rounded border border-line px-2 py-1 text-xs font-bold text-slate-500 hover:border-emerald-300 hover:text-emerald-600">
                정상으로 표시
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductGrantCard({ userId, product, onRevoke, onSaveSettings }) {
  const settings = product.settings || {};
  const [draft, setDraft] = useState({
    coupangAccessKey: settings.coupangAccessKey || '',
    coupangSecretKey: '',
    coupangPartnerId: settings.coupangPartnerId || '',
    defaultTrackingCode: settings.defaultTrackingCode || ''
  });

  useEffect(() => {
    setDraft({
      coupangAccessKey: settings.coupangAccessKey || '',
      coupangSecretKey: '',
      coupangPartnerId: settings.coupangPartnerId || '',
      defaultTrackingCode: settings.defaultTrackingCode || ''
    });
  }, [settings.coupangAccessKey, settings.coupangPartnerId, settings.defaultTrackingCode]);

  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const save = () => onSaveSettings(userId, product.productId, draft);
  const isCujasa = product.productId === 'cujasa';

  return (
    <div className="rounded border border-blue-100 bg-blue-50/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-blue-100 px-2 py-1 text-xs font-bold text-blue-700">{product.name || product.productId}</span>
        <span className="text-xs text-slate-500">{product.status || 'active'} · {product.role || 'customer'}</span>
        <button onClick={onRevoke} className="ml-auto text-xs font-bold text-blue-300 hover:text-red-500">제품 권한 해제</button>
      </div>

      {isCujasa && (
        <div className="mt-3 grid gap-3 rounded border border-line bg-white p-3 md:grid-cols-2">
          <div className="md:col-span-2 text-xs font-semibold text-slate-500">쿠팡 파트너스 설정</div>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Access Key</span>
            <input className="rounded border border-line px-2 py-2" value={draft.coupangAccessKey} onChange={(e) => update('coupangAccessKey', e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Secret Key</span>
            <input
              type="password"
              className="rounded border border-line px-2 py-2"
              value={draft.coupangSecretKey}
              onChange={(e) => update('coupangSecretKey', e.target.value)}
              placeholder={settings.hasCoupangSecretKey ? '저장됨 - 변경 시에만 입력' : ''}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Partner ID</span>
            <input className="rounded border border-line px-2 py-2" value={draft.coupangPartnerId} onChange={(e) => update('coupangPartnerId', e.target.value)} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">기본 Tracking Code</span>
            <input className="rounded border border-line px-2 py-2" value={draft.defaultTrackingCode} onChange={(e) => update('defaultTrackingCode', e.target.value)} />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} className="rounded bg-coupang px-3 py-2 text-xs font-bold text-white">쿠팡 설정 저장</button>
            <span className="text-xs text-slate-400">계정별 Tracking Code가 비어 있으면 이 기본값을 사용합니다.</span>
          </div>
        </div>
      )}
    </div>
  );
}
