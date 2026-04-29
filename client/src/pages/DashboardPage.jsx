import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, ExternalLink, ListChecks, Play, RefreshCw, Settings, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { dateTime } from '../lib/format.js';

const statusTone = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  running: 'border-blue-200 bg-blue-50 text-blue-700'
};

export default function DashboardPage({ openAccountSettings, openAccountQueue, setPage }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [runningAccountId, setRunningAccountId] = useState('');

  const load = async () => {
    const [nextSummary, nextRows] = await Promise.all([
      api.get('/api/admin/operations/summary'),
      api.get('/api/admin/operations/accounts')
    ]);
    setSummary(nextSummary);
    setRows(nextRows);
  };

  useEffect(() => {
    load().catch(() => toast('운영 대시보드를 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const runAll = async () => {
    setRunningAll(true);
    try {
      const result = await api.post('/api/scheduler/run-pipeline', {});
      const ok = result.results?.filter((r) => r.status === 'ok').length ?? 0;
      const skipped = result.results?.filter((r) => r.status === 'skipped').length ?? 0;
      const total = result.results?.length ?? 0;
      toast(`전체 자동화 완료: 성공 ${ok}개, 실행 중 skip ${skipped}개 / ${total}개`, skipped ? 'info' : 'success');
      await load();
    } catch (err) {
      toast(err.message || '전체 자동화 실행에 실패했습니다.', 'error');
    } finally {
      setRunningAll(false);
    }
  };

  const runAccount = async (row) => {
    setRunningAccountId(row.accountId);
    try {
      await api.post(`/api/accounts/${row.accountId}/run-pipeline`, {});
      toast(`${row.accountName} 자동화가 완료됐습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '자동화 실행에 실패했습니다.', 'error');
    } finally {
      setRunningAccountId('');
    }
  };

  const problemCounts = useMemo(() => {
    const problems = summary?.problemAccounts || [];
    return {
      error: problems.filter((p) => p.severity === 'error').length,
      warn: problems.filter((p) => p.severity === 'warn').length
    };
  }, [summary]);

  if (loading) {
    return (
      <div className="grid gap-5">
        <div className="h-28 animate-pulse rounded border border-line bg-white" />
        <div className="grid gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded border border-line bg-white" />)}
        </div>
        <div className="h-80 animate-pulse rounded border border-line bg-white" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-500">운영 관제</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">오늘 정상 운영 중인지 먼저 확인하세요</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => load().catch(() => toast('새로고침에 실패했습니다.', 'error'))} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium">
            <RefreshCw size={16} />
            새로고침
          </button>
          <button
            onClick={runAll}
            disabled={runningAll}
            className="inline-flex items-center gap-2 rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {runningAll ? <Spinner /> : <Play size={16} />}
            전체 자동화 실행
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <OpsCard label="계정" value={`${summary?.cards?.accountsActive ?? 0}/${summary?.cards?.accountsTotal ?? 0}`} hint="활성 / 전체" tone="ok" />
        <OpsCard label="오늘 예약" value={summary?.cards?.scheduledToday ?? 0} hint={`오늘 업로드 완료 ${summary?.cards?.postedToday ?? 0}개`} tone="ok" />
        <OpsCard label="실패/검토" value={summary?.cards?.queueProblems ?? 0} hint="failed · retry · manual_required" tone={(summary?.cards?.queueProblems ?? 0) > 0 ? 'error' : 'ok'} />
        <OpsCard label="연결 문제" value={summary?.cards?.threadsProblems ?? 0} hint={`mock 의심 ${summary?.cards?.mockUploads ?? 0}개`} tone={(summary?.cards?.threadsProblems ?? 0) > 0 ? 'warn' : 'ok'} />
      </div>

      <section className="rounded border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h3 className="font-bold">문제 계정</h3>
            <p className="mt-0.5 text-xs text-slate-400">오류 {problemCounts.error}개 · 주의 {problemCounts.warn}개</p>
          </div>
          {(summary?.problemAccounts || []).length === 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={14} />
              이상 없음
            </span>
          )}
        </div>
        {(summary?.problemAccounts || []).length > 0 ? (
          <div className="grid divide-y divide-line">
            {summary.problemAccounts.slice(0, 10).map((problem, index) => (
              <button
                key={`${problem.accountId}-${problem.type}-${index}`}
                onClick={() => problem.type === 'no_schedule' || problem.type === 'queue_failed' ? openAccountQueue?.(problem.accountId) : openAccountSettings?.(problem.accountId)}
                className="flex items-center justify-between gap-3 px-5 py-3 text-left hover:bg-panel"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={problem.severity} label={problem.severity === 'error' ? '오류' : '주의'} />
                    <span className="font-semibold text-sm">{problem.accountName}</span>
                    {problem.accountHandle && <span className="text-xs text-slate-400">{problem.accountHandle}</span>}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{problem.label}</div>
                  {problem.detail && <div className="mt-0.5 truncate text-xs text-slate-400">{problem.detail}</div>}
                </div>
                <ExternalLink size={16} className="shrink-0 text-slate-300" />
              </button>
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center text-sm text-slate-400">현재 손봐야 할 계정이 없습니다.</div>
        )}
      </section>

      <section className="rounded border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-bold">계정별 운영 상태</h3>
          <p className="mt-0.5 text-xs text-slate-400">연결, 예약, 실패, 최근 활동을 한 번에 확인합니다.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-panel text-left text-xs font-bold text-slate-500">
              <tr>
                <th className="px-4 py-3">계정</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">Threads</th>
                <th className="px-4 py-3">쿠팡 API</th>
                <th className="px-4 py-3">오늘</th>
                <th className="px-4 py-3">최근 활동</th>
                <th className="px-4 py-3 text-right">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.accountId} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{row.accountName}</div>
                    <div className="text-xs text-slate-400">{row.customer || '고객 미할당'} {row.accountHandle ? `· ${row.accountHandle}` : ''}</div>
                  </td>
                  <td className="px-4 py-3"><StatusPill status={row.health} label={healthLabel(row.health)} /></td>
                  <td className="px-4 py-3"><StatusPill status={row.threads.status} label={row.threads.label} /></td>
                  <td className="px-4 py-3">
                    <StatusPill status={row.coupang.status} label={row.coupang.label} />
                    {row.coupang.missing?.length > 0 && <div className="mt-1 text-xs text-slate-400">{row.coupang.missing.join(', ')}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">예약 {row.todayScheduled} · 완료 {row.todayPosted}</div>
                    <div className="text-xs text-slate-400">실패/검토 {row.failedCount} · mock {row.mockCount}</div>
                  </td>
                  <td className="px-4 py-3">
                    {row.pipelineRun?.status === 'running' ? (
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-blue-600"><Clock3 size={13} />자동화 실행 중</div>
                    ) : row.lastActivity ? (
                      <>
                        <div className="text-xs font-medium text-slate-600">{row.lastActivity.action}</div>
                        <div className="mt-0.5 max-w-[220px] truncate text-xs text-slate-400">{row.lastActivity.message || '-'}</div>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">활동 없음</span>
                    )}
                    {row.lastPostedAt && <div className="mt-1 text-xs text-slate-400">최근 업로드 {dateTime(row.lastPostedAt)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <IconButton title="설정 열기" onClick={() => openAccountSettings?.(row.accountId)}><Settings size={15} /></IconButton>
                      <IconButton title="큐 보기" onClick={() => openAccountQueue?.(row.accountId)}><ListChecks size={15} /></IconButton>
                      <IconButton title="고객 계정 보기" onClick={() => setPage?.('admin-users')}><Users size={15} /></IconButton>
                      <button
                        onClick={() => runAccount(row)}
                        disabled={runningAccountId === row.accountId || row.pipelineRun?.status === 'running'}
                        className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-panel disabled:opacity-50"
                      >
                        {runningAccountId === row.accountId || row.pipelineRun?.status === 'running' ? <Spinner /> : <Play size={13} />}
                        실행
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OpsCard({ label, value, hint, tone }) {
  return (
    <div className={`rounded border bg-white p-4 ${tone === 'error' ? 'border-rose-200' : tone === 'warn' ? 'border-amber-200' : 'border-line'}`}>
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </div>
  );
}

function StatusPill({ status, label }) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold ${statusTone[status] || statusTone.warn}`}>{label}</span>;
}

function IconButton({ title, onClick, children }) {
  return (
    <button title={title} onClick={onClick} className="grid h-8 w-8 place-items-center rounded border border-line text-slate-500 hover:bg-panel">
      {children}
    </button>
  );
}

function healthLabel(status) {
  return status === 'ok' ? '정상' : status === 'running' ? '실행 중' : status === 'error' ? '오류' : '주의';
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
