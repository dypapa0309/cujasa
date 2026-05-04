import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, RefreshCw, Wrench } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { dateTime } from '../lib/format.js';

const statusLabels = {
  pending: '대기',
  in_progress: '셋업 중',
  completed: '완료',
  canceled: '취소'
};

const statusClass = {
  pending: 'border-amber-200 bg-amber-50 text-amber-700',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  canceled: 'border-slate-200 bg-slate-50 text-slate-500'
};

export default function AdminSetupPage() {
  const toast = useToast();
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [manual, setManual] = useState({ userId: '', productId: 'onetime_590000', amount: '', paidAt: '', memo: '' });
  const [savingManual, setSavingManual] = useState(false);

  const load = async () => {
    const [rows, nextUsers, nextProducts] = await Promise.all([
      api.get('/api/admin/setup-tasks'),
      api.get('/api/admin/users'),
      api.get('/api/admin/billing/products')
    ]);
    setTasks(rows);
    setUsers(nextUsers);
    setProducts(nextProducts);
  };

  useEffect(() => {
    load().catch(() => toast('셋업 대기를 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    pending: tasks.filter((task) => task.status === 'pending').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    completed: tasks.filter((task) => task.status === 'completed').length
  }), [tasks]);

  const updateStatus = async (task, status) => {
    setSavingId(task.id);
    try {
      await api.patch(`/api/admin/setup-tasks/${task.id}`, { status });
      toast(`셋업 상태를 ${statusLabels[status]}로 변경했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '셋업 상태 변경에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const submitManualPayment = async (e) => {
    e.preventDefault();
    if (!manual.userId || !manual.productId) return;
    setSavingManual(true);
    try {
      const product = products.find((item) => item.id === manual.productId);
      await api.post('/api/admin/billing/manual-payment', {
        ...manual,
        amount: Number(manual.amount || product?.amount || 0)
      });
      setManual({ userId: '', productId: 'onetime_590000', amount: '', paidAt: '', memo: '' });
      await load();
      toast('수동 입금 결제를 반영했습니다.', 'success');
    } catch (err) {
      toast(err.message || '수동 결제 입력에 실패했습니다.', 'error');
    } finally {
      setSavingManual(false);
    }
  };

  if (loading) return <div className="rounded border border-line bg-white p-6 text-sm text-slate-500">셋업 대기 확인 중</div>;

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">결제 후 운영 셋업</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">셋업 대기</h2>
        </div>
        <button onClick={() => load().catch(() => toast('새로고침에 실패했습니다.', 'error'))} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium">
          <RefreshCw size={16} />
          새로고침
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard icon={<Clock3 size={18} />} label="대기" value={counts.pending} />
        <SummaryCard icon={<Wrench size={18} />} label="셋업 중" value={counts.inProgress} />
        <SummaryCard icon={<CheckCircle2 size={18} />} label="완료" value={counts.completed} />
      </div>

      <section className="rounded border border-line bg-white p-5">
        <div className="mb-4">
          <h3 className="font-bold">수동 계좌이체 입력</h3>
          <p className="mt-0.5 text-xs text-slate-400">내 계좌로 직접 입금한 고객도 여기서 결제로 기록하고 권한을 열 수 있습니다.</p>
        </div>
        <form onSubmit={submitManualPayment} className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.4fr_auto] md:items-end">
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">고객</span>
            <select required className="rounded border border-line px-3 py-2 text-sm" value={manual.userId} onChange={(e) => setManual((p) => ({ ...p, userId: e.target.value }))}>
              <option value="">고객 선택</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.email}{user.buyerName ? ` · ${user.buyerName}` : ''}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">상품</span>
            <select className="rounded border border-line px-3 py-2 text-sm" value={manual.productId} onChange={(e) => setManual((p) => ({ ...p, productId: e.target.value }))}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">금액</span>
            <input className="rounded border border-line px-3 py-2 text-sm" value={manual.amount} placeholder="상품 기본가" onChange={(e) => setManual((p) => ({ ...p, amount: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">입금일</span>
            <input type="datetime-local" className="rounded border border-line px-3 py-2 text-sm" value={manual.paidAt} onChange={(e) => setManual((p) => ({ ...p, paidAt: e.target.value }))} />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">메모</span>
            <input className="rounded border border-line px-3 py-2 text-sm" value={manual.memo} placeholder="입금자명/특이사항" onChange={(e) => setManual((p) => ({ ...p, memo: e.target.value }))} />
          </label>
          <button disabled={savingManual} className="rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {savingManual ? '반영 중...' : '입금 반영'}
          </button>
        </form>
      </section>

      <section className="rounded border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-bold">결제 완료 고객</h3>
          <p className="mt-0.5 text-xs text-slate-400">입금 완료 후 자동 생성된 셋업 작업입니다.</p>
        </div>
        {tasks.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">현재 셋업 대기 고객이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-panel text-left text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">구매자</th>
                  <th className="px-4 py-3">연락처</th>
                  <th className="px-4 py-3">상품/금액</th>
                  <th className="px-4 py-3">입금 완료</th>
                  <th className="px-4 py-3 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td className="px-4 py-3"><StatusPill status={task.status} /></td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{task.buyer_name || '-'}</div>
                      <div className="text-xs text-slate-400">{task.email || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{task.phone || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{task.product_id}</div>
                      <div className="text-xs text-slate-400">{Number(task.amount || 0).toLocaleString('ko-KR')}원</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{dateTime(task.paid_at || task.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {task.status === 'pending' && (
                          <button disabled={savingId === task.id} onClick={() => updateStatus(task, 'in_progress')} className="rounded border border-line px-3 py-1.5 text-xs font-bold hover:bg-panel disabled:opacity-50">셋업 시작</button>
                        )}
                        {task.status !== 'completed' && (
                          <button disabled={savingId === task.id} onClick={() => updateStatus(task, 'completed')} className="rounded bg-coupang px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">셋업 완료</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value }) {
  return (
    <div className="rounded border border-line bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-bold text-slate-400">{icon}{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass[status] || statusClass.pending}`}>{statusLabels[status] || status}</span>;
}
