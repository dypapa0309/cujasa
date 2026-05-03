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
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  const load = async () => {
    const rows = await api.get('/api/admin/setup-tasks');
    setTasks(rows);
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
