import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Pencil, RefreshCw, Trash2, Wrench } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { dateTime } from '../lib/format.js';
import SearchableSelect from '../components/SearchableSelect.jsx';

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

const threadsStatusLabels = {
  requested: '등록 필요',
  meta_registered: 'Meta 등록',
  customer_action_required: '고객 승인 필요',
  connected: '연결 완료',
  canceled: '취소'
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
  const [taskFilter, setTaskFilter] = useState('open');
  const [customerFilter, setCustomerFilter] = useState('open');
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [normalizing, setNormalizing] = useState(false);
  const [assistantMetrics, setAssistantMetrics] = useState(null);
  const [threadsRequests, setThreadsRequests] = useState([]);

  const load = async () => {
    const [tasksResult, usersResult, productsResult, metricsResult, threadsResult] = await Promise.allSettled([
      api.get('/api/admin/setup-tasks'),
      api.get('/api/admin/users/summary'),
      api.get('/api/admin/billing/products'),
      api.get('/api/admin/operations/assistant-metrics'),
      api.get('/api/admin/threads-connection-requests')
    ]);
    if (tasksResult.status !== 'fulfilled') throw tasksResult.reason;
    setTasks(tasksResult.value);
    setUsers(usersResult.status === 'fulfilled' ? usersResult.value : []);
    setProducts(productsResult.status === 'fulfilled' ? productsResult.value : []);
    setAssistantMetrics(metricsResult.status === 'fulfilled' ? metricsResult.value : null);
    setThreadsRequests(threadsResult.status === 'fulfilled' && Array.isArray(threadsResult.value) ? threadsResult.value : []);
    if (usersResult.status !== 'fulfilled' || productsResult.status !== 'fulfilled' || threadsResult.status !== 'fulfilled') {
      toast('셋업 일부 보조 데이터를 불러오지 못했습니다. 핵심 대기 목록은 표시합니다.', 'info');
    }
  };

  useEffect(() => {
    load().catch(() => toast('셋업 대기를 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    pending: tasks.filter((task) => task.status === 'pending').length,
    inProgress: tasks.filter((task) => task.status === 'in_progress').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    threadsOpen: threadsRequests.filter((row) => ['requested', 'meta_registered', 'customer_action_required'].includes(row.status)).length
  }), [tasks, threadsRequests]);

  const taskUserIdsByStatus = useMemo(() => {
    const result = { pending: new Set(), in_progress: new Set(), completed: new Set(), canceled: new Set(), open: new Set(), all: new Set() };
    tasks.forEach((task) => {
      if (!task.user_id) return;
      result.all.add(task.user_id);
      result[task.status]?.add(task.user_id);
      if (['pending', 'in_progress'].includes(task.status)) result.open.add(task.user_id);
    });
    return result;
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    if (taskFilter === 'all') return tasks;
    if (taskFilter === 'open') return tasks.filter((task) => ['pending', 'in_progress'].includes(task.status));
    return tasks.filter((task) => task.status === taskFilter);
  }, [taskFilter, tasks]);

  const selectableUsers = useMemo(() => {
    const statusSet = taskUserIdsByStatus[customerFilter];
    if (customerFilter === 'all') return users;
    if (customerFilter === 'open') return users.filter((user) => !taskUserIdsByStatus.completed.has(user.id));
    return users.filter((user) => statusSet?.has(user.id));
  }, [customerFilter, taskUserIdsByStatus, users]);

  const selectableUserOptions = useMemo(() => selectableUsers.map((user) => ({
    value: user.id,
    label: [user.email, user.buyerName || user.buyer_name].filter(Boolean).join(' · '),
    searchText: [user.email, user.buyerName, user.buyer_name, user.username, user.phone].filter(Boolean).join(' ')
  })), [selectableUsers]);

  const productOptions = useMemo(() => products.map((product) => ({
    value: product.id,
    label: product.name || product.id,
    searchText: [product.name, product.id].filter(Boolean).join(' ')
  })), [products]);

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

  const updateThreadsRequest = async (request, status) => {
    setSavingId(request.id);
    try {
      await api.patch(`/api/admin/threads-connection-requests/${request.id}`, { status });
      toast(`Threads 요청을 ${threadsStatusLabels[status] || status} 상태로 변경했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || 'Threads 요청 상태 변경에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const deleteTask = async (task) => {
    const customerLabel = task.buyer_name || task.email || '이 고객';
    if (!window.confirm(`${customerLabel} 셋업 요청을 삭제 처리할까요?\n기본 대기 목록에서는 숨겨지고, 삭제됨 필터에서 다시 확인할 수 있습니다.`)) return;
    setSavingId(task.id);
    try {
      await api.patch(`/api/admin/setup-tasks/${task.id}`, { status: 'canceled' });
      toast('셋업 요청을 삭제 처리했습니다.', 'success');
      await load();
    } catch (err) {
      toast(err.message || '셋업 요청 삭제에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const openEdit = (task) => {
    setEditingTask(task);
    setEditForm({
      status: task.status || 'pending',
      buyer_name: task.buyer_name || '',
      email: task.email || '',
      phone: task.phone || '',
      product_id: task.product_id || 'onetime_590000',
      amount: task.amount || '',
      paid_at: task.paid_at ? new Date(task.paid_at).toISOString().slice(0, 16) : '',
      notes: task.notes || ''
    });
  };

  const closeEdit = () => {
    setEditingTask(null);
    setEditForm(null);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editingTask || !editForm) return;
    setSavingId(editingTask.id);
    try {
      await api.patch(`/api/admin/setup-tasks/${editingTask.id}`, {
        ...editForm,
        amount: editForm.amount ? Number(editForm.amount) : null
      });
      toast('셋업 정보를 수정했습니다.', 'success');
      closeEdit();
      await load();
    } catch (err) {
      toast(err.message || '셋업 정보 수정에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const normalizeSetupCustomers = async () => {
    if (!window.confirm('셋업 화면에 잡힌 고객을 베이직 일시불 paid 상태로 보정할까요?')) return;
    setNormalizing(true);
    try {
      const result = await api.post('/api/admin/setup-tasks/normalize-onetime', {});
      toast(`${result.count || 0}명의 고객을 베이직 일시불로 보정했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '베이직 일시불 보정에 실패했습니다.', 'error');
    } finally {
      setNormalizing(false);
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
        <button disabled={normalizing} onClick={normalizeSetupCustomers} className="inline-flex items-center gap-2 rounded bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          {normalizing ? '보정 중...' : '셋업 고객 일시불 보정'}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard icon={<Clock3 size={18} />} label="대기" value={counts.pending} />
        <SummaryCard icon={<Wrench size={18} />} label="셋업 중" value={counts.inProgress} />
        <SummaryCard icon={<CheckCircle2 size={18} />} label="완료" value={counts.completed} />
        <SummaryCard icon={<Wrench size={18} />} label="Threads 요청" value={counts.threadsOpen} />
      </div>

      <section className="rounded border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-bold">Threads 연결 요청</h3>
          <p className="mt-0.5 text-xs text-slate-400">고객이 입력한 Threads 핸들을 Meta 개발자센터에 등록한 뒤 완료 처리합니다.</p>
        </div>
        {threadsRequests.filter((row) => row.status !== 'connected' && row.status !== 'canceled').length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400">현재 처리할 Threads 연결 요청이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="bg-panel text-left text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">고객</th>
                  <th className="px-4 py-3">계정</th>
                  <th className="px-4 py-3">Threads</th>
                  <th className="px-4 py-3">요청 메모</th>
                  <th className="px-4 py-3 text-right">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {threadsRequests.filter((row) => row.status !== 'connected' && row.status !== 'canceled').map((request) => (
                  <tr key={request.id}>
                    <td className="px-4 py-3"><span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{threadsStatusLabels[request.status] || request.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{request.user?.buyer_name || request.user?.username || '-'}</div>
                      <div className="text-xs text-slate-400">{request.user?.email || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{request.account?.name || request.account_id}</div>
                      <div className="text-xs text-slate-400">{request.account?.account_handle || request.threads_handle || '-'}</div>
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-700">{request.threads_handle}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{request.request_memo || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {request.status === 'requested' && (
                          <button disabled={savingId === request.id} onClick={() => updateThreadsRequest(request, 'customer_action_required')} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">Meta 등록 완료</button>
                        )}
                        {request.status !== 'connected' && (
                          <button disabled={savingId === request.id} onClick={() => updateThreadsRequest(request, 'connected')} className="rounded border border-line px-3 py-1.5 text-xs font-bold hover:bg-panel disabled:opacity-50">연결 완료 처리</button>
                        )}
                        <button disabled={savingId === request.id} onClick={() => updateThreadsRequest(request, 'canceled')} className="rounded border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">취소</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {assistantMetrics && (
        <section className="rounded border border-line bg-white p-5">
          <div className="mb-4">
            <h3 className="font-bold">상담 품질 모니터</h3>
            <p className="mt-0.5 text-xs text-slate-400">채팅 응답 속도, fallback 질문, public rate limit 이벤트를 최근 로그 기준으로 봅니다.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-6">
            <SummaryCard label="채팅 로그" value={assistantMetrics.counts?.total || 0} />
            <SummaryCard label="즉답" value={assistantMetrics.counts?.faqHit || 0} />
            <SummaryCard label="초안" value={assistantMetrics.counts?.draftCreated || 0} />
            <SummaryCard label="Fallback" value={assistantMetrics.counts?.fallback || 0} />
            <SummaryCard label="AI Timeout" value={assistantMetrics.counts?.aiTimeout || 0} />
            <SummaryCard label="평균 ms" value={assistantMetrics.averageDurationMs || 0} />
          </div>
          {assistantMetrics.fallbackQuestions?.length > 0 && (
            <div className="mt-4 rounded border border-amber-100 bg-amber-50 p-3">
              <div className="mb-2 text-xs font-black text-amber-700">답변 보강 필요 질문</div>
              <div className="grid gap-1 text-xs text-amber-900">
                {assistantMetrics.fallbackQuestions.slice(0, 6).map((item) => (
                  <div key={item.message} className="flex items-center justify-between gap-3">
                    <span className="truncate">{item.message || '-'}</span>
                    <span className="shrink-0 font-bold">{item.count}회</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="rounded border border-line bg-white p-5">
        <div className="mb-4">
          <h3 className="font-bold">수동 계좌이체 입력</h3>
          <p className="mt-0.5 text-xs text-slate-400">내 계좌로 직접 입금한 고객도 여기서 결제로 기록하고 권한을 열 수 있습니다.</p>
        </div>
        <form onSubmit={submitManualPayment} className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_1fr_1.4fr_auto] md:items-end">
          <label className="grid gap-1 text-xs md:col-span-6">
            <span className="font-bold text-slate-500">고객 선택 필터</span>
            <select className="max-w-xs rounded border border-line px-3 py-2 text-sm" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
              <option value="open">완료 고객 제외</option>
              <option value="pending">셋업 대기 고객</option>
              <option value="in_progress">셋업 중 고객</option>
              <option value="completed">셋업 완료 고객</option>
              <option value="all">전체 고객</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">고객</span>
            <SearchableSelect
              value={manual.userId}
              onChange={(value) => setManual((p) => ({ ...p, userId: value }))}
              options={selectableUserOptions}
              placeholder="고객 선택"
              searchPlaceholder="고객명 또는 이메일 검색"
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-bold text-slate-500">상품</span>
            <SearchableSelect
              value={manual.productId}
              onChange={(value) => setManual((p) => ({ ...p, productId: value }))}
              options={productOptions}
              placeholder="상품 선택"
              searchPlaceholder="상품명 검색"
            />
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
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-bold">결제 완료 고객</h3>
            <p className="mt-0.5 text-xs text-slate-400">입금 완료 후 자동 생성된 셋업 작업입니다. 기본값은 완료/삭제 고객을 숨깁니다.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <FilterButton active={taskFilter === 'open'} onClick={() => setTaskFilter('open')}>대기+진행</FilterButton>
            <FilterButton active={taskFilter === 'pending'} onClick={() => setTaskFilter('pending')}>대기</FilterButton>
            <FilterButton active={taskFilter === 'in_progress'} onClick={() => setTaskFilter('in_progress')}>셋업 중</FilterButton>
            <FilterButton active={taskFilter === 'completed'} onClick={() => setTaskFilter('completed')}>완료</FilterButton>
            <FilterButton active={taskFilter === 'canceled'} onClick={() => setTaskFilter('canceled')}>삭제됨</FilterButton>
            <FilterButton active={taskFilter === 'all'} onClick={() => setTaskFilter('all')}>전체</FilterButton>
          </div>
        </div>
        {visibleTasks.length === 0 ? (
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
                {visibleTasks.map((task) => (
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
                        <button disabled={savingId === task.id} onClick={() => openEdit(task)} className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-xs font-bold hover:bg-panel disabled:opacity-50">
                          <Pencil size={13} />
                          수정
                        </button>
                        {task.status === 'pending' && (
                          <button disabled={savingId === task.id} onClick={() => updateStatus(task, 'in_progress')} className="rounded border border-line px-3 py-1.5 text-xs font-bold hover:bg-panel disabled:opacity-50">셋업 시작</button>
                        )}
                        {task.status !== 'completed' && (
                          <button disabled={savingId === task.id} onClick={() => updateStatus(task, 'completed')} className="rounded bg-coupang px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">셋업 완료</button>
                        )}
                        {task.status !== 'canceled' && (
                          <button disabled={savingId === task.id} onClick={() => deleteTask(task)} className="inline-flex items-center gap-1 rounded border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                            <Trash2 size={13} />
                            삭제
                          </button>
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
      {editingTask && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <form onSubmit={submitEdit} className="grid max-h-[88vh] w-full max-w-2xl gap-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div>
              <h3 className="text-lg font-black">셋업 정보 수정</h3>
              <p className="mt-1 text-xs text-slate-400">완료된 고객도 연락처, 메모, 상태를 다시 수정할 수 있습니다.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <EditField label="구매자명" value={editForm.buyer_name} onChange={(value) => setEditForm((p) => ({ ...p, buyer_name: value }))} />
              <EditField label="이메일" value={editForm.email} onChange={(value) => setEditForm((p) => ({ ...p, email: value }))} />
              <EditField label="전화번호" value={editForm.phone} onChange={(value) => setEditForm((p) => ({ ...p, phone: value }))} />
              <label className="grid gap-1 text-xs">
                <span className="font-bold text-slate-500">상태</span>
                <select className="rounded border border-line px-3 py-2 text-sm" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-bold text-slate-500">상품</span>
                <SearchableSelect
                  value={editForm.product_id}
                  onChange={(value) => setEditForm((p) => ({ ...p, product_id: value }))}
                  options={productOptions}
                  placeholder="상품 선택"
                  searchPlaceholder="상품명 검색"
                />
              </label>
              <EditField label="금액" value={editForm.amount} onChange={(value) => setEditForm((p) => ({ ...p, amount: value }))} />
              <label className="grid gap-1 text-xs md:col-span-2">
                <span className="font-bold text-slate-500">입금일</span>
                <input type="datetime-local" className="rounded border border-line px-3 py-2 text-sm" value={editForm.paid_at} onChange={(e) => setEditForm((p) => ({ ...p, paid_at: e.target.value }))} />
              </label>
              <label className="grid gap-1 text-xs md:col-span-2">
                <span className="font-bold text-slate-500">메모</span>
                <textarea className="min-h-24 rounded border border-line px-3 py-2 text-sm" value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeEdit} className="rounded border border-line px-4 py-2 text-sm font-bold">닫기</button>
              <button disabled={savingId === editingTask.id} className="rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {savingId === editingTask.id ? '저장 중...' : '저장'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full border px-3 py-1.5 ${active ? 'border-coupang bg-red-50 text-coupang' : 'border-line bg-white text-slate-500 hover:bg-panel'}`}>
      {children}
    </button>
  );
}

function EditField({ label, value, onChange }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-bold text-slate-500">{label}</span>
      <input className="rounded border border-line px-3 py-2 text-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
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
