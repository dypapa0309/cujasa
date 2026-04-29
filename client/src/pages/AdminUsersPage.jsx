import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

export default function AdminUsersPage({ accounts }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', maxAccounts: 2 });
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const [nextUsers, nextProducts] = await Promise.all([
      api.get('/api/admin/users'),
      api.get('/api/admin/products'),
    ]);
    setUsers(nextUsers);
    setProducts(nextProducts);
  };

  useEffect(() => {
    load().catch(() => toast('구매자 목록을 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const createUser = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post('/api/admin/users', form);
      await load();
      setForm({ email: '', password: '', maxAccounts: 2 });
      setShowCreate(false);
      toast('구매자 계정이 생성됐습니다.', 'success');
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
      toast('계정이 할당됐습니다.', 'success');
    } catch (err) {
      toast(err.message || '할당에 실패했습니다.', 'error');
    }
  };

  const unassignAccount = async (userId, accountId) => {
    if (!confirm('계정 할당을 해제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/users/${userId}/accounts/${accountId}`);
      await load();
      toast('계정 할당이 해제됐습니다.', 'info');
    } catch {
      toast('해제에 실패했습니다.', 'error');
    }
  };

  const assignProduct = async (userId, productId) => {
    try {
      await api.post(`/api/admin/users/${userId}/products`, { productId });
      await load();
      toast('제품 권한이 추가됐습니다.', 'success');
    } catch (err) {
      toast(err.message || '제품 권한 추가에 실패했습니다.', 'error');
    }
  };

  const unassignProduct = async (userId, productId) => {
    if (!confirm('제품 권한을 해제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/users/${userId}/products/${productId}`);
      await load();
      toast('제품 권한이 해제됐습니다.', 'info');
    } catch {
      toast('제품 권한 해제에 실패했습니다.', 'error');
    }
  };

  const toggleStatus = async (user) => {
    const next = user.status === 'active' ? 'suspended' : 'active';
    try {
      await api.patch(`/api/admin/users/${user.id}`, { status: next });
      await load();
      toast(`${next === 'active' ? '활성화' : '정지'}됐습니다.`, 'info');
    } catch {
      toast('상태 변경에 실패했습니다.', 'error');
    }
  };

  const updateMaxAccounts = async (user, maxAccounts) => {
    try {
      await api.patch(`/api/admin/users/${user.id}`, { maxAccounts: Number(maxAccounts) });
      await load();
      toast('계정 한도가 변경됐습니다.', 'success');
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
        <form onSubmit={createUser} className="rounded border border-line bg-white p-5 grid gap-4 md:grid-cols-3">
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
          <div className="md:col-span-3">
            <button disabled={creating} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {creating ? '생성 중...' : '생성'}
            </button>
          </div>
        </form>
      )}

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
                  <div className="font-semibold text-sm">{user.email}</div>
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
                  <div className="text-xs font-semibold text-slate-500">보유 제품</div>
                  {user.products?.length === 0 && <div className="text-xs text-slate-400">보유 제품 없음</div>}
                  <div className="flex flex-wrap gap-2">
                    {user.products?.map((product) => (
                      <span key={product.productId} className="flex items-center gap-1.5 rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                        {product.name || product.productId}
                        <button onClick={() => unassignProduct(user.id, product.productId)} className="text-blue-300 hover:text-red-500 font-bold">✕</button>
                      </span>
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
                  <div className="text-xs font-semibold text-slate-500">할당된 계정</div>
                  {user.accounts?.length === 0 && <div className="text-xs text-slate-400">할당된 계정 없음</div>}
                  <div className="flex flex-wrap gap-2">
                    {user.accounts?.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 rounded bg-gray-100 px-2 py-1 text-xs font-medium">
                        {a.name}
                        <button onClick={() => unassignAccount(user.id, a.id)} className="text-slate-400 hover:text-red-500 font-bold">✕</button>
                      </span>
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
