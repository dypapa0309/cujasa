import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import SensitiveInput from '../components/SensitiveInput.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

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
  const [search, setSearch] = useState('');
  const [customerSegment, setCustomerSegment] = useState('all');
  const [setupTasks, setSetupTasks] = useState([]);
  const [planBusyUserId, setPlanBusyUserId] = useState('');
  const [showArchivedUsers, setShowArchivedUsers] = useState(false);
  const [archiveBusyUserId, setArchiveBusyUserId] = useState('');

  const load = async () => {
    const [nextUsers, nextProducts, nextConflicts, nextMisassignments, nextSetupTasks] = await Promise.all([
      api.get(`/api/admin/users${showArchivedUsers ? '?includeArchived=1' : ''}`),
      api.get('/api/admin/products'),
      api.get('/api/admin/account-conflicts'),
      api.get('/api/admin/account-misassignments'),
      api.get('/api/admin/setup-tasks'),
    ]);
    setUsers(nextUsers);
    setProducts(nextProducts);
    setConflicts(nextConflicts);
    setMisassignments(nextMisassignments);
    setSetupTasks(nextSetupTasks);
    setBuyerNameDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, user.buyer_name || user.buyerName || ''])));
  };

  useEffect(() => {
    load().catch(() => toast('구매자 목록을 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, [showArchivedUsers]);

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

  const savePolibotCatalogReviews = async (userId, reviews) => {
    try {
      await api.patch(`/api/admin/users/${userId}/products/polibot/catalog-reviews`, { reviews });
      await load();
      toast('POLIBOT 상품 검수를 저장했습니다.', 'success');
    } catch (err) {
      toast(err.message || 'POLIBOT 상품 검수 저장에 실패했습니다.', 'error');
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

  const changePlan = async (user, plan) => {
    const labels = { free: '무료회원', onetime: '영구구매', monthly: '월회원', suspended: '정지' };
    if (plan === 'suspended' && !confirm(`${user.buyer_name || user.buyerName || user.username || user.email} 고객을 정지할까요?`)) return;
    setPlanBusyUserId(user.id);
    try {
      await api.post(`/api/admin/users/${user.id}/plan`, { plan });
      await load();
      toast(`${labels[plan]}으로 변경했습니다.`, 'success');
    } catch (err) {
      toast(err.message || '회원 플랜 변경에 실패했습니다.', 'error');
    } finally {
      setPlanBusyUserId('');
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

  const archiveCustomer = async (user) => {
    const label = user.username || user.email;
    const buyer = user.buyer_name || user.buyerName || label;
    if (!confirm(`${buyer} (${label}) 고객을 보관 삭제할까요?\n\n로그인은 차단되고, 제품 권한/계정 할당은 해제됩니다. 결제와 로그 기록은 보존됩니다.`)) return;
    if (!confirm(`정말 보관 삭제합니다: ${label}`)) return;
    setArchiveBusyUserId(user.id);
    try {
      await api.delete(`/api/admin/users/${user.id}?reason=admin_archive_duplicate_or_requested`);
      await load();
      toast('고객을 보관 삭제했습니다.', 'success');
    } catch (err) {
      toast(err.message || '고객 보관 삭제에 실패했습니다.', 'error');
    } finally {
      setArchiveBusyUserId('');
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

  const setupStatusByUser = setupTasks.reduce((acc, task) => {
    if (!task?.user_id) return acc;
    const priority = { pending: 1, in_progress: 2, completed: 3, canceled: 0 };
    const current = acc[task.user_id];
    if (!current || (priority[task.status] || 0) > (priority[current.status] || 0)) acc[task.user_id] = task.status;
    return acc;
  }, {});
  const segmentDefinitions = [
    { key: 'all', label: '전체', description: '모든 회원' },
    { key: 'free', label: '무료회원', description: '무료 플랜' },
    { key: 'onetime', label: '영구구매', description: '일시불 고객' },
    { key: 'monthly', label: '월회원', description: '월결제 고객' },
    { key: 'attention', label: '정지/연체', description: '확인 필요' },
    { key: 'signup_only', label: '회원가입만', description: '권한/계정/셋업 없음' }
  ];
  const isSignupOnlyUser = (user) => (
    (user.plan || 'free') === 'free'
    && user.status !== 'suspended'
    && (user.products || []).length === 0
    && (user.accounts || []).length === 0
    && !setupStatusByUser[user.id]
  );
  const userInSegment = (user, segment) => {
    if (segment === 'all') return true;
    if (segment === 'free') return (user.plan || 'free') === 'free' && user.status !== 'suspended';
    if (segment === 'onetime') return user.plan === 'onetime' && user.status !== 'suspended';
    if (segment === 'monthly') return user.plan === 'monthly' && user.status !== 'suspended' && user.billing_status !== 'past_due';
    if (segment === 'attention') return user.status === 'suspended' || user.billing_status === 'past_due';
    if (segment === 'signup_only') return isSignupOnlyUser(user);
    return true;
  };
  const segmentCounts = Object.fromEntries(segmentDefinitions.map((segment) => [
    segment.key,
    users.filter((user) => userInSegment(user, segment.key)).length
  ]));
  const setupStatusLabel = (status) => ({
    pending: '셋업 대기',
    in_progress: '셋업 중',
    completed: '셋업 완료',
    canceled: '셋업 삭제'
  }[status] || '');

  const filteredUsers = users.filter((user) => {
    if (!userInSegment(user, customerSegment)) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    const haystack = [
      user.buyer_name,
      user.buyerName,
      user.username,
      user.email,
      user.plan,
      user.billing_status,
      setupStatusLabel(setupStatusByUser[user.id]),
      ...(user.accounts || []).flatMap((account) => [account.name, account.account_handle, account.threads_user_id])
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(needle);
  });

  return (
    <div className="grid gap-5">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-400">고객 계정 및 제품 권한 관리</div>
        <button onClick={() => setShowCreate((v) => !v)} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white">
          {showCreate ? '취소' : '+ 구매자 생성'}
        </button>
      </div>
      <div className="rounded border border-line bg-white p-4">
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {segmentDefinitions.map((segment) => {
            const active = customerSegment === segment.key;
            return (
              <button
                key={segment.key}
                type="button"
                onClick={() => setCustomerSegment(segment.key)}
                className={`rounded border px-3 py-3 text-left transition ${
                  active ? 'border-coupang bg-orange-50 text-coupang shadow-sm' : 'border-line bg-white text-slate-600 hover:border-slate-300 hover:bg-panel'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black">{segment.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${active ? 'bg-white text-coupang' : 'bg-slate-100 text-slate-500'}`}>{segmentCounts[segment.key] || 0}</span>
                </div>
                <div className="mt-1 text-[11px] font-medium text-slate-400">{segment.description}</div>
              </button>
            );
          })}
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-600">고객 검색</span>
          <input
            className="rounded border border-line px-3 py-2"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="구매자명, 아이디, 이메일, Threads 계정명/핸들 검색"
          />
        </label>
        <label className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-slate-500">
          <input
            type="checkbox"
            checked={showArchivedUsers}
            onChange={(e) => setShowArchivedUsers(e.target.checked)}
          />
          보관 고객 보기
        </label>
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
            <SensitiveInput
              required
              value={form.password}
              inputClassName="w-full rounded border border-line px-3 py-2 pr-10"
              onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
            />
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
      ) : filteredUsers.length === 0 ? (
        <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">검색 결과가 없습니다</div>
      ) : (
        <div className="grid gap-4">
          {filteredUsers.map((user) => {
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
                    <div className="text-xs text-slate-400">
                      {[user.buyer_name || user.buyerName, user.username ? `ID ${user.username}` : '', planLabel(user)].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {setupStatusByUser[user.id] && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
                      {setupStatusLabel(setupStatusByUser[user.id])}
                    </span>
                  )}
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${user.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {user.archived_at ? '보관됨' : user.status === 'active' ? '활성' : '정지'}
                  </span>
                  {user.archived_at && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                      {formatDateTime(user.archived_at)}
                    </span>
                  )}
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
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-line bg-gray-50 p-3">
                  <span className="text-xs font-semibold text-slate-500">계정 상태</span>
                  <button
                    type="button"
                    onClick={() => { if (user.status !== 'active') toggleStatus(user); }}
                    disabled={planBusyUserId === user.id}
                    className={`rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                      user.status === 'active' ? 'border-slate-900 bg-slate-900 text-white' : 'border-line bg-white text-slate-600 hover:border-slate-900'
                    }`}
                  >
                    활성
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (user.status !== 'suspended') toggleStatus(user); }}
                    disabled={planBusyUserId === user.id}
                    className={`rounded border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${
                      user.status === 'suspended' ? 'border-rose-600 bg-rose-600 text-white' : 'border-rose-200 bg-white text-rose-600'
                    }`}
                  >
                    정지
                  </button>
                  <span className="text-xs text-slate-400">제품 결제 상태는 아래 제품 카드에서 각각 관리합니다.</span>
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
                        onSavePolibotCatalogReviews={savePolibotCatalogReviews}
                      />
                    ))}
                  </div>
                  {ungrantedProducts.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <SearchableSelect
                        value=""
                        onChange={(value) => { if (value) assignProduct(user.id, value); }}
                        options={ungrantedProducts.map((product) => ({
                          value: product.id,
                          label: product.name,
                          searchText: [product.name, product.id].filter(Boolean).join(' ')
                        }))}
                        placeholder="+ 제품 권한 추가..."
                        searchPlaceholder="제품명 검색"
                        variant="compact"
                        className="w-56 text-xs"
                      />
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
                          <div className="mt-1 text-[11px] leading-relaxed text-amber-600">
                            Threads 연결은 고객 브라우저 Chrome/Safari에서 해당 계정으로 threads.net에 로그인한 상태로 진행해야 합니다.
                          </div>
                        </div>
                        <label className="grid gap-1 text-xs">
                          <span className="font-semibold text-slate-500">계정별 Tracking Code</span>
                          <AccountTrackingCodeInput account={a} onSave={updateAccountTrackingCode} />
                        </label>
                        <button onClick={() => openAccountSettings?.(a.id)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-coupang hover:text-coupang">
                          설정 열기
                        </button>
                        <button onClick={() => connectThreads(a)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-gray-900 hover:text-gray-900">
                          {a.has_threads_access_token ? '재연결' : 'Threads 연결'}
                        </button>
                        <button onClick={() => unassignAccount(user.id, a.id)} className="rounded border border-line bg-white px-3 py-2 text-xs font-semibold text-red-500 hover:border-red-300">
                          해제
                        </button>
                      </div>
                    ))}
                  </div>

                  {unassigned.length > 0 && user.accounts?.length < user.max_accounts && (
                    <div className="flex items-center gap-2 mt-1">
                      <SearchableSelect
                        value=""
                        onChange={(value) => { if (value) assignAccount(user.id, value); }}
                        options={unassigned.map((account) => ({
                          value: account.id,
                          label: [account.name, account.account_handle].filter(Boolean).join(' · '),
                          searchText: [account.name, account.account_handle, account.owner?.email].filter(Boolean).join(' ')
                        }))}
                        placeholder="+ 계정 할당..."
                        searchPlaceholder="계정명 또는 핸들 검색"
                        variant="compact"
                        className="w-56 text-xs"
                      />
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
                          <SensitiveInput
                            value={accountDrafts[user.id]?.coupang_tracking_code || ''}
                            placeholder="없으면 고객 기본값"
                            inputClassName="w-full rounded border border-line px-2 py-1.5 pr-9"
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
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-rose-100 pt-4">
                  <div className="text-xs leading-relaxed text-slate-400">
                    보관 삭제는 로그인 차단, 제품 권한 정지, Threads 계정 할당 해제만 수행하고 결제/로그 기록은 보존합니다.
                  </div>
                  <button
                    type="button"
                    onClick={() => archiveCustomer(user)}
                    disabled={Boolean(user.archived_at) || archiveBusyUserId === user.id}
                    className="rounded border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {archiveBusyUserId === user.id ? '보관 중...' : user.archived_at ? '보관 완료' : '고객 보관 삭제'}
                  </button>
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
  if (!account.has_threads_access_token) return 'Threads 연결 필요';
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

function planLabel(user) {
  if (user.status === 'suspended') return '정지';
  if (user.plan === 'onetime') return '영구구매';
  if (user.plan === 'monthly') return user.billing_status === 'past_due' ? '월회원 연체' : '월회원';
  return '무료회원';
}

function isCurrentPlan(user, plan) {
  if (plan === 'suspended') return user.status === 'suspended';
  if (user.status === 'suspended') return false;
  return (user.plan || 'free') === plan;
}

function productBillingPlan(billing = {}, productStatus = 'active') {
  if (productStatus === 'suspended') return 'suspended';
  return billing.plan || 'free';
}

function productBillingLabel(billing = {}, productStatus = 'active') {
  const plan = productBillingPlan(billing, productStatus);
  if (plan === 'suspended') return '정지';
  if (plan === 'onetime') return '영구구매';
  if (plan === 'monthly') return billing.status === 'past_due' ? '월회원 연체' : '월회원';
  return '무료';
}

function ConflictPanel({ conflicts, onDisconnect }) {
  if (!conflicts?.length) {
    return (
      <div className="rounded border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
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
      <div className="rounded border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
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

function ProductGrantCard({ userId, product, onRevoke, onSaveSettings, onSavePolibotCatalogReviews }) {
  const settings = product.settings || {};
  const usage = getProductUsage(settings, product.productId);
  const workspaceSummary = settings.workspaceSummary || {};
  const billing = settings.billing || {};
  const [draft, setDraft] = useState({
    coupangAccessKey: '',
    coupangSecretKey: '',
    coupangPartnerId: '',
    defaultTrackingCode: ''
  });
  const [usageDraft, setUsageDraft] = useState({ limit: usage.limit, used: usage.used });

  useEffect(() => {
    setDraft({
      coupangAccessKey: '',
      coupangSecretKey: '',
      coupangPartnerId: '',
      defaultTrackingCode: ''
    });
  }, [settings.hasCoupangAccessKey, settings.hasCoupangSecretKey, settings.hasCoupangPartnerId, settings.hasDefaultTrackingCode]);

  useEffect(() => {
    setUsageDraft({ limit: usage.limit, used: usage.used });
  }, [usage.limit, usage.used]);

  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  const save = () => onSaveSettings(userId, product.productId, draft);
  const saveUsage = () => onSaveSettings(userId, product.productId, { usage: { limit: usageDraft.limit, used: usageDraft.used } });
  const saveBilling = (plan) => {
    if (plan === 'suspended' && !confirm(`${product.name || product.productId} 제품을 정지할까요?`)) return;
    onSaveSettings(userId, product.productId, { billing: { plan } });
  };
  const isCujasa = product.productId === 'cujasa';
  const revealProductSetting = async (field) => {
    const payload = await api.get(`/api/admin/users/${userId}/products/${product.productId}/settings/${field}`);
    return payload?.value || '';
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-bold text-slate-800">{product.name || product.productId}</span>
        <span className="text-xs text-slate-500">{product.status || 'active'} · {product.role || 'customer'} · {productBillingLabel(billing, product.status)}</span>
        <button onClick={onRevoke} className="ml-auto text-xs font-bold text-slate-400 hover:text-rose-600">제품 권한 해제</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 rounded border border-line bg-gray-50 p-3">
        {[
          ['free', '무료'],
          ['onetime', '영구구매'],
          ['monthly', '월회원'],
          ['suspended', '정지']
        ].map(([plan, label]) => {
          const active = productBillingPlan(billing, product.status) === plan;
          return (
            <button
              key={plan}
              type="button"
              onClick={() => saveBilling(plan)}
              className={`rounded border px-3 py-1.5 text-xs font-bold ${
                active
                  ? plan === 'suspended' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-900 bg-slate-900 text-white'
                  : plan === 'suspended' ? 'border-rose-200 bg-white text-rose-600' : 'border-line bg-white text-slate-600 hover:border-slate-900'
              }`}
            >
              {label}
            </button>
          );
        })}
        {billing.paidUntil && <span className="self-center text-xs text-slate-400">유효기간 {formatDateTime(billing.paidUntil)}</span>}
      </div>

      {isCujasa && (
        <div className="mt-3 grid gap-3 rounded border border-line bg-white p-3 md:grid-cols-2">
          <div className="md:col-span-2 text-xs font-semibold text-slate-500">쿠팡 파트너스 설정</div>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Access Key</span>
            <SensitiveInput
              value={draft.coupangAccessKey}
              placeholder={settings.hasCoupangAccessKey ? (settings.maskedCoupangAccessKey || '저장됨 - 변경 시에만 입력') : ''}
              hasStoredValue={Boolean(settings.hasCoupangAccessKey)}
              onRevealStored={() => revealProductSetting('coupangAccessKey')}
              inputClassName="w-full rounded border border-line px-2 py-2 pr-9"
              onChange={(e) => update('coupangAccessKey', e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Secret Key</span>
            <SensitiveInput
              value={draft.coupangSecretKey}
              onChange={(e) => update('coupangSecretKey', e.target.value)}
              placeholder={settings.hasCoupangSecretKey ? '저장됨 - 변경 시에만 입력' : ''}
              hasStoredValue={Boolean(settings.hasCoupangSecretKey)}
              onRevealStored={() => revealProductSetting('coupangSecretKey')}
              inputClassName="w-full rounded border border-line px-2 py-2 pr-9"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">Partner ID</span>
            <SensitiveInput
              value={draft.coupangPartnerId}
              placeholder={settings.hasCoupangPartnerId ? (settings.maskedCoupangPartnerId || '저장됨 - 변경 시에만 입력') : ''}
              hasStoredValue={Boolean(settings.hasCoupangPartnerId)}
              onRevealStored={() => revealProductSetting('coupangPartnerId')}
              inputClassName="w-full rounded border border-line px-2 py-2 pr-9"
              onChange={(e) => update('coupangPartnerId', e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium">기본 Tracking Code</span>
            <SensitiveInput
              value={draft.defaultTrackingCode}
              placeholder={settings.hasDefaultTrackingCode ? (settings.maskedDefaultTrackingCode || '저장됨 - 변경 시에만 입력') : ''}
              hasStoredValue={Boolean(settings.hasDefaultTrackingCode)}
              onRevealStored={() => revealProductSetting('defaultTrackingCode')}
              inputClassName="w-full rounded border border-line px-2 py-2 pr-9"
              onChange={(e) => update('defaultTrackingCode', e.target.value)}
            />
          </label>
          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} className="rounded bg-coupang px-3 py-2 text-xs font-bold text-white">쿠팡 설정 저장</button>
            <span className="text-xs text-slate-400">계정별 Tracking Code가 비어 있으면 이 기본값을 사용합니다.</span>
          </div>
        </div>
      )}
      {!isCujasa && (
        <div className="mt-3 grid gap-3 rounded border border-line bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-slate-500">제품 무료 사용량</div>
              <div className="mt-1 text-sm font-bold text-slate-800">남은 {usage.remaining}회 · 사용 {usage.used} / {usage.limit}회</div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs">
                <span className="font-semibold text-slate-500">전체 횟수</span>
                <input
                  type="number"
                  min="0"
                  className="w-20 rounded border border-line px-2 py-1.5"
                  value={usageDraft.limit}
                  onChange={(event) => setUsageDraft((prev) => ({ ...prev, limit: Number(event.target.value) }))}
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-semibold text-slate-500">사용 횟수</span>
                <input
                  type="number"
                  min="0"
                  className="w-20 rounded border border-line px-2 py-1.5"
                  value={usageDraft.used}
                  onChange={(event) => setUsageDraft((prev) => ({ ...prev, used: Number(event.target.value) }))}
                />
              </label>
              <button type="button" onClick={saveUsage} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">횟수 저장</button>
            </div>
          </div>
          <div className="grid gap-2 rounded border border-line bg-gray-50 p-3 text-xs text-slate-500 md:grid-cols-3">
            <div>후보 {workspaceSummary.candidateCount || 0}개</div>
            <div>분석 {workspaceSummary.analysisCount || 0}개</div>
            <div>최근 작업 {workspaceSummary.updatedAt ? formatDateTime(workspaceSummary.updatedAt) : '없음'}</div>
            {product.productId === 'spread' && (
              <>
                <div>캠페인 {workspaceSummary.campaignCount || 0}개</div>
                <div>참여자 {workspaceSummary.applicantCount || 0}명</div>
                <div>{workspaceSummary.hasCampaignDraft ? '캠페인 있음' : '캠페인 없음'}</div>
                <div>{workspaceSummary.hasSubmissionReview ? '검수 기록 있음' : '검수 기록 없음'}</div>
              </>
            )}
            {product.productId === 'polibot' && (
              <>
                <div>고객 {workspaceSummary.customerCount || 0}명</div>
                <div>{workspaceSummary.hasPolibotUpload ? 'PDF 기록 있음' : 'PDF 기록 없음'}</div>
                <div>{workspaceSummary.hasPolibotRecommendations ? '추천 결과 있음' : '추천 결과 없음'}</div>
              </>
            )}
            {product.productId === 'infludex' && (
              <>
                <div>인스타 분석 {workspaceSummary.infludexAnalysisCount || 0}개</div>
                <div>후보 {workspaceSummary.candidateCount || 0}개</div>
              </>
            )}
          </div>
        </div>
      )}
      {product.productId === 'polibot' && (
        <PolibotCatalogReviewPanel
          userId={userId}
          onSave={onSavePolibotCatalogReviews}
        />
      )}
    </div>
  );
}

function PolibotCatalogReviewPanel({ userId, onSave }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [reviewTab, setReviewTab] = useState('review');

  const loadReview = async () => {
    setLoading(true);
    try {
      const next = await api.get(`/api/admin/users/${userId}/products/polibot/catalog-reviews`);
      setPayload(next);
      setDrafts(next.catalogReviews || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !payload && !loading) loadReview().catch(() => {});
  }, [open]);

  const report = payload?.qualityReport || {};
  const items = Array.isArray(report.catalogItems) ? report.catalogItems : [];
  const reviewTabs = [
    ['confirmed', '확정 상품', report.recommendableProducts || 0],
    ['review', '검수 필요', report.reviewNeededProducts || 0],
    ['insufficient', '정보 부족', report.insufficientProducts || 0],
    ['excluded', '제외 문구', report.excludedPhrases || 0]
  ];
  const visibleItems = items
    .filter((item) => {
      const draft = drafts[item.id] || {};
      const status = draft.status || item.status || 'review';
      const completeness = item.completeness || '부족';
      if (reviewTab === 'confirmed') return status === 'confirmed' && completeness !== '부족';
      if (reviewTab === 'insufficient') return status === 'confirmed' && completeness === '부족';
      if (reviewTab === 'excluded') return status === 'excluded';
      return ['auto', 'review'].includes(status);
    })
    .slice(0, 40);

  const updateReview = (item, patch) => {
    const key = item.id;
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        status: item.status || 'review',
        productName: item.productName || '',
        company: item.company || '',
        productGroup: item.productGroup || '',
        coverageKeywords: item.coverageKeywords || [],
        ageRange: item.ageRange || '',
        paymentTerm: item.paymentTerm || '',
        renewalType: item.renewalType || '',
        disclosureMemo: item.disclosureMemo || '',
        reductionMemo: item.reductionMemo || '',
        premiumExample: item.premiumExample || '',
        refundRate: item.refundRate || '',
        targetAudience: item.targetAudience || [],
        excludedAudience: item.excludedAudience || [],
        cautionMemo: item.cautionMemo || '',
        ...prev[key],
        ...patch,
        reviewedAt: new Date().toISOString()
      }
    }));
  };

  const statusLabel = {
    confirmed: '확정',
    auto: '자동 후보',
    review: '검수 필요',
    excluded: '제외'
  };
  const listValue = (value) => Array.isArray(value) ? value.join(', ') : value || '';
  const listPatch = (key, value) => ({ [key]: value.split(',').map((item) => item.trim()).filter(Boolean) });

  return (
    <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-left text-xs font-bold text-slate-700"
      >
        <span>POLIBOT 상품 후보 검수</span>
        <span className={`transition ${open ? 'rotate-180' : ''}`}>⌄</span>
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <div className="grid gap-2 text-xs text-slate-600 md:grid-cols-5">
            <div className="rounded border border-line bg-white p-2">추천 가능 {report.recommendableProducts || 0}개</div>
            <div className="rounded border border-line bg-white p-2">정보 부족 {report.insufficientProducts || 0}개</div>
            <div className="rounded border border-line bg-white p-2">검수 필요 {report.reviewNeededProducts || 0}개</div>
            <div className="rounded border border-line bg-white p-2">제외 문구 {report.excludedPhrases || 0}개</div>
            <div className="rounded border border-line bg-white p-2">OCR 필요 {report.ocrNeeded || 0}개</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {reviewTabs.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                onClick={() => setReviewTab(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-black ${
                  reviewTab === key
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-line bg-white text-slate-500 hover:border-slate-900 hover:text-slate-900'
                }`}
              >
                {label} {count}
              </button>
            ))}
          </div>
          <div className="max-h-80 overflow-auto rounded border border-line bg-white">
            {loading && <div className="p-3 text-xs text-slate-400">검수 목록을 불러오는 중...</div>}
            {!loading && visibleItems.length === 0 && <div className="p-3 text-xs text-slate-400">이 탭에 표시할 항목이 없습니다.</div>}
            {visibleItems.map((item) => {
              const draft = drafts[item.id] || {};
              const status = draft.status || item.status || 'review';
              return (
                <div key={item.id} className="grid gap-2 border-b border-line p-3 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{draft.productName || item.productName || '상품명 미입력'}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.company || '미분류'} · {item.productGroup || '상품군 미분류'} · 정보 {item.completeness || '부족'} · {item.fileName || '근거 파일 없음'}
                      </div>
                    </div>
                    <span className="rounded border border-line px-2 py-1 text-xs font-bold text-slate-500">{statusLabel[status] || status}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.productName ?? item.productName ?? ''}
                      onChange={(event) => updateReview(item, { productName: event.target.value })}
                      placeholder="실제 상품명"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.company ?? item.company ?? ''}
                      onChange={(event) => updateReview(item, { company: event.target.value })}
                      placeholder="보험사"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.productGroup ?? item.productGroup ?? ''}
                      onChange={(event) => updateReview(item, { productGroup: event.target.value })}
                      placeholder="상품군"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={listValue(draft.coverageKeywords ?? item.coverageKeywords)}
                      onChange={(event) => updateReview(item, listPatch('coverageKeywords', event.target.value))}
                      placeholder="핵심 담보/키워드, 쉼표로 구분"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.ageRange ?? item.ageRange ?? ''}
                      onChange={(event) => updateReview(item, { ageRange: event.target.value })}
                      placeholder="가입 가능 연령"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.paymentTerm ?? item.paymentTerm ?? ''}
                      onChange={(event) => updateReview(item, { paymentTerm: event.target.value })}
                      placeholder="납입/만기"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.renewalType ?? item.renewalType ?? ''}
                      onChange={(event) => updateReview(item, { renewalType: event.target.value })}
                      placeholder="갱신/비갱신"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.premiumExample ?? item.premiumExample ?? ''}
                      onChange={(event) => updateReview(item, { premiumExample: event.target.value })}
                      placeholder="보험료 예시"
                    />
                    <input
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      value={draft.refundRate ?? item.refundRate ?? ''}
                      onChange={(event) => updateReview(item, { refundRate: event.target.value })}
                      placeholder="환급률"
                    />
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <textarea
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      rows="2"
                      value={draft.disclosureMemo ?? item.disclosureMemo ?? ''}
                      onChange={(event) => updateReview(item, { disclosureMemo: event.target.value })}
                      placeholder="고지 조건"
                    />
                    <textarea
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      rows="2"
                      value={draft.reductionMemo ?? item.reductionMemo ?? ''}
                      onChange={(event) => updateReview(item, { reductionMemo: event.target.value })}
                      placeholder="감액/면책"
                    />
                    <textarea
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      rows="2"
                      value={listValue(draft.targetAudience ?? item.targetAudience)}
                      onChange={(event) => updateReview(item, listPatch('targetAudience', event.target.value))}
                      placeholder="추천 대상, 쉼표로 구분"
                    />
                    <textarea
                      className="rounded border border-line px-2 py-1.5 text-xs"
                      rows="2"
                      value={listValue(draft.excludedAudience ?? item.excludedAudience)}
                      onChange={(event) => updateReview(item, listPatch('excludedAudience', event.target.value))}
                      placeholder="제외 대상, 쉼표로 구분"
                    />
                    <textarea
                      className="rounded border border-line px-2 py-1.5 text-xs md:col-span-2"
                      rows="2"
                      value={draft.cautionMemo ?? item.cautionMemo ?? ''}
                      onChange={(event) => updateReview(item, { cautionMemo: event.target.value })}
                      placeholder="주의 문구"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['confirmed', '확정'],
                      ['review', '검수 필요'],
                      ['excluded', '제외']
                    ].map(([nextStatus, label]) => (
                      <button
                        key={nextStatus}
                        type="button"
                        onClick={() => updateReview(item, { status: nextStatus })}
                        className={`rounded border px-2 py-1 text-xs font-bold ${
                          status === nextStatus ? 'border-slate-900 bg-slate-900 text-white' : 'border-line bg-white text-slate-600 hover:border-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={loadReview} className="rounded border border-line bg-white px-3 py-2 text-xs font-bold text-slate-600">새로고침</button>
            <button type="button" onClick={() => onSave(userId, drafts)} className="rounded bg-slate-900 px-3 py-2 text-xs font-bold text-white">검수 저장</button>
          </div>
        </div>
      )}
    </div>
  );
}

function getProductUsage(settings = {}, productId) {
  const usageRoot = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const raw = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(0, Number(raw.limit)) : 5;
  const used = Number.isFinite(Number(raw.used)) ? Math.max(0, Number(raw.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, Number.isFinite(Number(raw.remaining)) ? Number(raw.remaining) : limit - used)
  };
}

function AccountTrackingCodeInput({ account, onSave }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    setValue('');
  }, [account.id, account.has_coupang_tracking_code, account.masked_coupang_tracking_code]);

  const reveal = async () => {
    const payload = await api.get(`/api/accounts/${account.id}/sensitive/coupang_tracking_code`);
    return payload?.value || '';
  };

  return (
    <SensitiveInput
      value={value}
      placeholder={account.has_coupang_tracking_code ? (account.masked_coupang_tracking_code || '저장됨 - 변경 시에만 입력') : '없으면 고객 기본값 사용'}
      hasStoredValue={Boolean(account.has_coupang_tracking_code)}
      onRevealStored={reveal}
      inputClassName="w-full rounded border border-line bg-white px-2 py-1.5 pr-9"
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => onSave(account, e.target.value)}
    />
  );
}
