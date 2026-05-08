import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Clock3, ExternalLink, ListChecks, Play, RefreshCw, Settings, Users, Wrench, X } from 'lucide-react';
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
  const [refreshing, setRefreshing] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [misassignments, setMisassignments] = useState(null);
  const [preflightModal, setPreflightModal] = useState(null);
  const [runSummaryModal, setRunSummaryModal] = useState(null);
  const [cleaningQueue, setCleaningQueue] = useState(false);
  const [catchingUpDaily, setCatchingUpDaily] = useState(false);
  const [reschedulingToday, setReschedulingToday] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [eventModal, setEventModal] = useState(null);
  const [eventLoading, setEventLoading] = useState(false);

  const load = async () => {
    const dashboard = await api.get('/api/admin/operations/dashboard');
    setSummary(dashboard.summary || null);
    setRows(dashboard.rows || []);
  };

  const loadRiskPanels = async () => {
    const [nextConflicts, nextMisassignments] = await Promise.all([
      api.get('/api/admin/account-conflicts').catch(() => []),
      api.get('/api/admin/account-misassignments').catch(() => null)
    ]);
    setConflicts(nextConflicts || []);
    setMisassignments(nextMisassignments);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
      loadRiskPanels().catch(() => {});
      toast('대시보드를 새로고침했습니다.', 'success');
    } catch {
      toast('새로고침에 실패했습니다.', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load()
      .then(() => loadRiskPanels().catch(() => {}))
      .catch(() => toast('운영 대시보드를 불러오지 못했습니다.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const runAll = async () => {
    const readiness = summary?.runReadiness;
    if (readiness) {
      const ready = readiness.ready || 0;
      if (ready === 0) {
        toast('실행 가능한 계정이 없습니다. 재연결, 쿠팡 설정, 큐 상태를 먼저 정리하세요.', 'error');
        return;
      }
      const confirmed = window.confirm([
        '전체 자동화를 실행할까요?',
        '',
        `실행 가능: ${ready}개`,
        `스킵 예정: ${readiness.skipped || 0}개`,
        `Threads 재연결 필요: ${readiness.threadsReconnect || 0}개`,
        `쿠팡 설정 필요: ${readiness.coupangSettings || 0}개`,
        `큐 정리 필요: ${readiness.queueCleanup || 0}개`,
        `멈춘 파이프라인: ${readiness.pipelineStuck || 0}개`
      ].join('\n'));
      if (!confirmed) return;
    }
    setRunningAll(true);
    try {
      const result = await api.post('/api/scheduler/run-pipeline', {});
      if (result.status === 'accepted') {
        setRunSummaryModal(null);
        toast(result.message || '전체 자동화 실행을 시작했습니다.', 'success');
        await load();
        return;
      }
      const ok = result.results?.filter((r) => r.status === 'ok').length ?? 0;
      const skipped = result.results?.filter((r) => r.status === 'skipped').length ?? 0;
      const reconnect = result.results?.filter((r) => /Threads|토큰|연결|access token|OAuth/i.test(r.error || r.reason || '')).length ?? 0;
      const failed = result.results?.filter((r) => r.status === 'error').length ?? 0;
      const total = result.results?.length ?? 0;
      setRunSummaryModal({ results: result.results || [] });
      toast(`전체 자동화 완료: 성공 ${ok}개 · 스킵 ${skipped}개 · 재연결 필요 ${reconnect}개 · 실패 ${failed}개 / ${total}개`, failed || reconnect ? 'info' : 'success');
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
      const preflight = await api.get(`/api/accounts/${row.accountId}/preflight?mode=start`);
      if (!preflight.canPublish) {
        setPreflightModal({ accountName: row.accountName, result: preflight });
        toast(`${row.accountName} 실행 전 확인이 필요합니다.`, 'error');
        return;
      }
      const result = await api.patch(`/api/accounts/${row.accountId}/automation`, { automationStatus: 'running', runNow: true });
      toast(result.alreadyRunning
        ? `${row.accountName} 예약 작업을 이미 확인 중입니다.`
        : (result.message || `${row.accountName} 자동화를 켜고 예약 작업을 시작했습니다.`), 'success');
      await load();
    } catch (err) {
      toast(err.message || '자동화 실행에 실패했습니다.', 'error');
    } finally {
      setRunningAccountId('');
    }
  };

  const cleanupQueueErrors = async () => {
    setCleaningQueue(true);
    try {
      const dryRun = await api.post('/api/admin/operations/cleanup-queue-errors', { mode: 'dry-run' });
      const total = dryRun.targets?.length || 0;
      if (total === 0) {
        toast('정리할 실패 큐가 없습니다.', 'success');
        return;
      }
      const applied = await api.post('/api/admin/operations/cleanup-queue-errors', { mode: 'apply' });
      toast(`실패 큐 ${applied.updated}건을 분류했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '실패 큐 정리에 실패했습니다.', 'error');
    } finally {
      setCleaningQueue(false);
    }
  };

  const catchUpDailyPipeline = async () => {
    setCatchingUpDaily(true);
    try {
      const result = await api.post('/api/admin/operations/daily-pipeline/catch-up', {});
      toast(result.duplicate
        ? '오늘 2시 자동 실행 기록이 이미 있습니다.'
        : '오늘 2시 자동 실행 보정을 시작/완료했습니다.', result.ok ? 'success' : 'info');
      await load();
    } catch (err) {
      toast(err.message || '자동 실행 보정에 실패했습니다.', 'error');
    } finally {
      setCatchingUpDaily(false);
    }
  };

  const rescheduleTodayQueue = async () => {
    setReschedulingToday(true);
    try {
      const result = await api.post('/api/admin/operations/reschedule-today-queue', {});
      toast(`오늘 예약 ${result.updatedCount || 0}건을 09-23시 랜덤 분산으로 재배치했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '오늘 예약 재배치에 실패했습니다.', 'error');
    } finally {
      setReschedulingToday(false);
    }
  };

  const openEvents = async (type, title) => {
    setEventLoading(true);
    setEventModal({ type, title, events: [], count: 0 });
    try {
      const result = await api.get(`/api/admin/operations/events?type=${encodeURIComponent(type)}&limit=250`);
      setEventModal({ type, title, events: result.events || [], count: result.count || 0 });
    } catch (err) {
      setEventModal(null);
      toast(err.message || '상세 데이터를 불러오지 못했습니다.', 'error');
    } finally {
      setEventLoading(false);
    }
  };

  const accountFilterCounts = useMemo(() => buildAccountFilterCounts(rows), [rows]);
  const accountFilters = useMemo(() => buildAccountFilters(accountFilterCounts), [accountFilterCounts]);

  const filteredRows = useMemo(() => {
    const needle = accountSearch.trim().toLowerCase();
    return rows
      .filter((row) => matchesAccountFilter(row, statusFilter))
      .filter((row) => {
        if (!needle) return true;
        return [
          row.accountName,
          row.accountHandle,
          row.customer,
          row.runCategory,
          row.threads?.label,
          row.coupang?.label
        ].filter(Boolean).join(' ').toLowerCase().includes(needle);
      })
      .sort(compareAccountRows);
  }, [rows, accountSearch, statusFilter]);

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
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            {refreshing ? <Spinner /> : <RefreshCw size={16} />}
            {refreshing ? '새로고침 중' : '새로고침'}
          </button>
          <button
            onClick={runAll}
            disabled={runningAll}
            className="inline-flex items-center gap-2 rounded bg-coupang px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {runningAll ? <Spinner /> : <Play size={16} />}
            전체 자동화 실행
          </button>
          <button
            onClick={cleanupQueueErrors}
            disabled={cleaningQueue}
            className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {cleaningQueue ? <Spinner /> : <Wrench size={16} />}
            실패 큐 정리
          </button>
          <button
            onClick={rescheduleTodayQueue}
            disabled={reschedulingToday}
            className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {reschedulingToday ? <Spinner /> : <RefreshCw size={16} />}
            오늘 예약 재분산
          </button>
          {summary?.dailyPipeline?.missing && (
            <button
              onClick={catchUpDailyPipeline}
              disabled={catchingUpDaily}
              className="inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 disabled:opacity-50"
            >
              {catchingUpDaily ? <Spinner /> : <Clock3 size={16} />}
              오늘 2시 실행 보정
            </button>
          )}
        </div>
      </div>

      <RiskPanel
        conflicts={conflicts}
        misassignments={misassignments}
        onOpenUsers={() => setPage?.('admin-users')}
      />

      <ReadinessPanel
        readiness={summary?.runReadiness}
        issueBreakdown={summary?.issueBreakdown}
      />

      <div className="grid gap-3 md:grid-cols-5">
        <OpsCard label="계정" value={`${summary?.cards?.accountsActive ?? 0}/${summary?.cards?.accountsTotal ?? 0}`} hint="활성 / 전체" tone="ok" onClick={() => setStatusFilter('all')} />
        <OpsCard
          label="2시 자동 실행"
          value={dailyPipelineLabel(summary?.dailyPipeline)}
          hint={dailyPipelineHint(summary?.dailyPipeline)}
          tone={dailyPipelineTone(summary?.dailyPipeline)}
          onClick={summary?.dailyPipeline?.missing ? catchUpDailyPipeline : undefined}
        />
        <OpsCard label="오늘 예약" value={summary?.cards?.scheduledToday ?? 0} hint={`오늘 업로드 완료 ${summary?.cards?.postedToday ?? 0}개`} tone="ok" onClick={() => openEvents('scheduled_today', '오늘 예약/업로드')} />
        <OpsCard label="실패/검토" value={summary?.cards?.queueProblems ?? 0} hint={`큐 정리 ${summary?.issueBreakdown?.queueCleanup ?? 0}개 · 확인 ${summary?.issueBreakdown?.pipelineStuck ?? 0}개`} tone={(summary?.cards?.queueProblems ?? 0) > 0 || (summary?.issueBreakdown?.pipelineStuck ?? 0) > 0 ? 'error' : 'ok'} onClick={() => openEvents('queue_problems', '실패/검토 항목')} />
        <OpsCard label="연결 문제" value={summary?.cards?.threadsProblems ?? 0} hint={`재연결 ${summary?.issueBreakdown?.threadsReconnect ?? 0}개 · 테스트 ${summary?.cards?.mockUploads ?? 0}개`} tone={(summary?.cards?.threadsProblems ?? 0) > 0 ? 'warn' : 'ok'} onClick={() => openEvents('connection_problems', '연결 문제')} />
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-bold">계정별 운영 상태</h3>
              <p className="mt-0.5 text-xs text-slate-400">연결, 예약, 실패, 최근 활동을 한 번에 확인합니다.</p>
            </div>
            <input
              className="w-full rounded border border-line px-3 py-2 text-sm md:w-72"
              value={accountSearch}
              onChange={(event) => setAccountSearch(event.target.value)}
              placeholder="고객명, 아이디, 계정명, 핸들 검색"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {accountFilters.map((filter) => (
              <button
                key={filter.key}
                onClick={() => setStatusFilter(filter.key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${statusFilter === filter.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-line bg-white text-slate-600 hover:bg-panel'}`}
              >
                {filter.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${statusFilter === filter.key ? 'bg-white/20 text-white' : 'bg-panel text-slate-500'}`}>{filter.count}</span>
              </button>
            ))}
          </div>
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
              {filteredRows.map((row) => (
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
                    <div className="text-xs text-slate-400">실패/검토 {row.failedCount} · 댓글경고 {row.replyWarningCount || 0} · 테스트 {row.mockCount}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <StatusPill status={row.automationStatus === 'running' ? 'ok' : 'warn'} label={`자동화 ${row.automationStatus === 'running' ? '실행중' : '중지됨'}`} />
                      <span className="text-xs text-slate-400">{runCategoryLabel(row.runCategory)}</span>
                    </div>
                    {row.dailyPipelineResult && (
                      <div className="mt-1 text-xs text-slate-400">
                        2시 결과 {dailyResultLabel(row.dailyPipelineResult)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isPipelineRunActive(row) ? (
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-blue-600"><Clock3 size={13} />자동화 실행 중</div>
                    ) : isPipelineRunStale(row) ? (
                      <>
                        <div className="inline-flex items-center gap-1 text-xs font-bold text-amber-600"><AlertTriangle size={13} />{row.pipelineRun.label || '파이프라인 자동 복구 가능'}</div>
                        <div className="mt-0.5 max-w-[260px] text-xs text-slate-400">
                          {row.pipelineRun.stage ? `${row.pipelineRun.stage} · ` : ''}
                          마지막 진행 {row.pipelineRun.lastProgressAt ? dateTime(row.pipelineRun.lastProgressAt) : '-'}
                        </div>
                      </>
                    ) : row.lastActivity ? (
                      <>
                        <div className="text-xs font-medium text-slate-600">{row.lastActivity.label || activityLabel(row.lastActivity.action)}</div>
                        <div className="mt-0.5 max-w-[220px] truncate text-xs text-slate-400" title={row.lastActivity.rawMessage || row.lastActivity.message || ''}>{activityMessage(row.lastActivity) || '-'}</div>
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
                        disabled={runningAccountId === row.accountId || isPipelineRunActive(row)}
                        className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-panel disabled:opacity-50"
                      >
                        {runningAccountId === row.accountId || isPipelineRunActive(row) ? <Spinner /> : <Play size={13} />}
                        실행
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-sm text-slate-400">검색 결과가 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {preflightModal && (
        <PreflightModal
          accountName={preflightModal.accountName}
          result={preflightModal.result}
          onClose={() => setPreflightModal(null)}
          onOpenSettings={() => {
            const accountId = preflightModal.result?.accountId;
            setPreflightModal(null);
            if (accountId) openAccountSettings?.(accountId);
          }}
        />
      )}
      {runSummaryModal && (
        <RunSummaryModal
          results={runSummaryModal.results}
          onClose={() => setRunSummaryModal(null)}
        />
      )}
      {eventModal && (
        <OperationEventsModal
          modal={eventModal}
          loading={eventLoading}
          onClose={() => setEventModal(null)}
          onOpenSettings={openAccountSettings}
          onOpenQueue={openAccountQueue}
        />
      )}
      <ContentQualityPanel />
    </div>
  );
}

function buildAccountFilterCounts(rows) {
  return {
    all: rows.length,
    ok: rows.filter((row) => row.health === 'ok').length,
    warn: rows.filter((row) => row.health === 'warn').length,
    error: rows.filter((row) => row.health === 'error').length,
    running: rows.filter((row) => row.health === 'running' || isPipelineRunActive(row)).length,
    threads_reconnect: rows.filter((row) => row.runCategory === 'threads_reconnect' || row.threads?.status === 'error').length,
    coupang_settings: rows.filter((row) => row.runCategory === 'coupang_settings' || row.coupang?.status === 'error').length,
    no_schedule: rows.filter((row) => Number(row.todayScheduled || 0) === 0 && row.accountStatus === 'active').length,
    failed_review: rows.filter((row) => Number(row.failedCount || 0) > 0 || Number(row.retryAvailableCount || 0) > 0 || Number(row.replyWarningCount || 0) > 0 || Number(row.contentBlockedCount || 0) > 0).length,
    pipeline_check: rows.filter((row) => row.runCategory === 'pipeline_stuck' || ['stuck', 'failed', 'expired'].includes(row.pipelineRun?.status)).length
  };
}

function isPipelineRunStale(row) {
  const run = row?.pipelineRun;
  return Boolean(run?.stale || run?.staleCode || run?.status === 'stuck' || row?.runCategory === 'pipeline_stuck');
}

function isPipelineRunActive(row) {
  const run = row?.pipelineRun;
  if (!run || isPipelineRunStale(row)) return false;
  return run.status === 'running' || run.rawStatus === 'running';
}

function buildAccountFilters(counts) {
  return [
    { key: 'all', label: '전체', count: counts.all || 0 },
    { key: 'ok', label: '정상', count: counts.ok || 0 },
    { key: 'warn', label: '주의', count: counts.warn || 0 },
    { key: 'error', label: '오류', count: counts.error || 0 },
    { key: 'running', label: '실행 중', count: counts.running || 0 },
    { key: 'threads_reconnect', label: 'Threads 재연결', count: counts.threads_reconnect || 0 },
    { key: 'coupang_settings', label: '쿠팡 설정', count: counts.coupang_settings || 0 },
    { key: 'no_schedule', label: '오늘 예약 없음', count: counts.no_schedule || 0 },
    { key: 'failed_review', label: '실패/검토', count: counts.failed_review || 0 },
    { key: 'pipeline_check', label: '파이프라인 확인', count: counts.pipeline_check || 0 }
  ];
}

function matchesAccountFilter(row, filter) {
  if (filter === 'ok') return row.health === 'ok';
  if (filter === 'warn') return row.health === 'warn';
  if (filter === 'error') return row.health === 'error';
  if (filter === 'running') return row.health === 'running' || isPipelineRunActive(row);
  if (filter === 'threads_reconnect') return row.runCategory === 'threads_reconnect' || row.threads?.status === 'error';
  if (filter === 'coupang_settings') return row.runCategory === 'coupang_settings' || row.coupang?.status === 'error';
  if (filter === 'no_schedule') return Number(row.todayScheduled || 0) === 0 && row.accountStatus === 'active';
  if (filter === 'failed_review') {
    return Number(row.failedCount || 0) > 0
      || Number(row.retryAvailableCount || 0) > 0
      || Number(row.replyWarningCount || 0) > 0
      || Number(row.contentBlockedCount || 0) > 0;
  }
  if (filter === 'pipeline_check') return row.runCategory === 'pipeline_stuck' || ['stuck', 'failed', 'expired'].includes(row.pipelineRun?.status);
  return true;
}

function compareAccountRows(a, b) {
  const healthRank = { error: 0, warn: 1, running: 2, ok: 3 };
  const rankDiff = (healthRank[a.health] ?? 4) - (healthRank[b.health] ?? 4);
  if (rankDiff !== 0) return rankDiff;
  const aTime = new Date(a.lastActivity?.createdAt || a.pipelineRun?.startedAt || a.lastPostedAt || 0).getTime();
  const bTime = new Date(b.lastActivity?.createdAt || b.pipelineRun?.startedAt || b.lastPostedAt || 0).getTime();
  if (aTime !== bTime) return bTime - aTime;
  return String(a.accountName || '').localeCompare(String(b.accountName || ''));
}

function RiskPanel({ conflicts, misassignments, onOpenUsers }) {
  const separable = misassignments?.separable || [];
  const needsReview = misassignments?.needsReview || [];
  const total = (conflicts?.length || 0) + separable.length + needsReview.length;
  if (total === 0) return null;
  return (
    <section className="rounded border border-amber-200 bg-amber-50">
      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-sm font-black text-amber-800">
            <AlertTriangle size={16} />
            계정 배정/연결 점검 필요
          </div>
          <div className="mt-1 text-xs text-amber-700">
            중복 연결 {conflicts?.length || 0}건 · 확정 분리 가능 {separable.length}건 · 검토 필요 {needsReview.length}건
          </div>
        </div>
        <button onClick={onOpenUsers} className="rounded bg-white px-3 py-2 text-xs font-bold text-amber-800 ring-1 ring-amber-200">
          고객/권한 관리에서 확인
        </button>
      </div>
      <div className="grid divide-y divide-amber-100 border-t border-amber-100 bg-white/50">
        {(conflicts || []).slice(0, 3).map((conflict, index) => (
          <div key={`${conflict.type}-${conflict.key}-${index}`} className="px-5 py-3 text-xs text-amber-800">
            <span className="font-bold">{conflict.label}</span>
            <span className="ml-2 text-amber-700">{conflict.key}</span>
          </div>
        ))}
        {separable.slice(0, 2).map((row) => (
          <div key={`separable-${row.userId}-${row.accountId}`} className="px-5 py-3 text-xs text-amber-800">
            <span className="font-bold">잘못 배정 의심</span>
            <span className="ml-2 text-amber-700">{row.userEmail} · {row.accountName}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadinessPanel({ readiness, issueBreakdown }) {
  if (!readiness) return null;
  const ready = readiness.ready || 0;
  const skipped = readiness.skipped || 0;
  const blockers = [
    { label: 'Threads 재연결', value: readiness.threadsReconnect || 0 },
    { label: '쿠팡 설정', value: readiness.coupangSettings || 0 },
    { label: '큐 정리', value: readiness.queueCleanup || 0 },
    { label: '멈춘 파이프라인', value: readiness.pipelineStuck || 0 }
  ];
  return (
    <section className="rounded border border-line bg-white">
      <div className="grid gap-3 p-4 md:grid-cols-[1.2fr_2fr] md:items-center">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900">
            {ready > 0 ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-rose-600" />}
            전체 자동화 실행 전 확인
          </div>
          <div className="mt-1 text-xs text-slate-400">
            실행 가능 {ready}개 · 스킵 예정 {skipped}개 · 과거 테스트 업로드 {issueBreakdown?.mockUploads || 0}개
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          {blockers.map((item) => (
            <div key={item.label} className={`rounded border px-3 py-2 ${item.value > 0 ? 'border-amber-200 bg-amber-50' : 'border-line bg-panel'}`}>
              <div className="text-[11px] font-bold text-slate-400">{item.label}</div>
              <div className={`mt-1 text-lg font-black ${item.value > 0 ? 'text-amber-700' : 'text-slate-700'}`}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreflightModal({ accountName, result, onClose, onOpenSettings }) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded bg-white shadow-2xl">
        <div className="shrink-0 border-b border-line px-5 py-4">
          <div className="text-lg font-black text-slate-900">{accountName} 실행 전 점검</div>
          <div className="mt-1 text-sm font-semibold text-rose-600">자동화 전에 조치가 필요합니다</div>
        </div>
        <div className="grid gap-2 overflow-y-auto p-5">
          {checks.map((check) => (
            <div key={`${check.key}-${check.title}`} className={`rounded border px-4 py-3 ${check.status === 'error' ? 'border-rose-100 bg-rose-50 text-rose-700' : check.status === 'warn' ? 'border-amber-100 bg-amber-50 text-amber-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
              <div className="text-sm font-black">{check.title}</div>
              <div className="mt-1 break-words text-xs leading-relaxed opacity-80">{check.message}</div>
              <CheckDetails details={check.details} />
            </div>
          ))}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-line px-5 py-4">
          <button onClick={onClose} className="flex-1 rounded border border-line py-3 text-sm font-bold text-slate-500">닫기</button>
          <button onClick={onOpenSettings} className="flex-1 rounded bg-slate-900 py-3 text-sm font-bold text-white">설정 열기</button>
        </div>
      </div>
    </div>
  );
}

function CheckDetails({ details }) {
  if (!details || typeof details !== 'object') return null;
  if (details.realProductCount === undefined && details.selectedRealCount === undefined) return null;
  return (
    <div className="mt-3 grid gap-1 rounded bg-white/70 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-600">
      <div>실상품 {details.realProductCount ?? 0}개 · 선택된 실상품 {details.selectedRealCount ?? 0}개</div>
      <div className="font-medium text-slate-500">사용불가 상품 {details.fallbackProductCount ?? 0}개 · 과거/무효 선택 {details.selectedInvalidCount ?? 0}개</div>
    </div>
  );
}

function RunSummaryModal({ results, onClose }) {
  const rows = Array.isArray(results) ? results : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded bg-white shadow-2xl">
        <div className="shrink-0 border-b border-line px-5 py-4">
          <div className="text-lg font-black text-slate-900">전체 자동화 실행 결과</div>
          <div className="mt-1 text-xs text-slate-400">문제 계정은 자동으로 스킵하거나 오류로 분리했습니다.</div>
        </div>
        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">계정</th>
                <th className="px-4 py-3">결과</th>
                <th className="px-4 py-3">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr key={`${row.accountId || row.accountName}-${index}`}>
                  <td className="px-4 py-3 font-semibold">{row.accountName || row.accountId || '-'}</td>
                  <td className="px-4 py-3"><StatusPill status={row.status === 'ok' ? 'ok' : row.status === 'skipped' ? 'warn' : 'error'} label={runResultLabel(row)} /></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{row.error || row.reason || row.label || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="shrink-0 border-t border-line px-5 py-4 text-right">
          <button onClick={onClose} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white">닫기</button>
        </div>
      </div>
    </div>
  );
}

function OperationEventsModal({ modal, loading, onClose, onOpenSettings, onOpenQueue }) {
  const events = Array.isArray(modal?.events) ? modal.events : [];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="text-lg font-black text-slate-900">{modal?.title || '상세 보기'}</div>
            <div className="mt-1 text-xs text-slate-400">관련 항목 {modal?.count ?? events.length}개를 시간순으로 모았습니다.</div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded border border-line text-slate-500 hover:bg-panel">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto">
          {loading ? (
            <div className="grid place-items-center gap-2 px-5 py-12 text-sm font-bold text-slate-500">
              <Spinner />
              불러오는 중
            </div>
          ) : events.length > 0 ? (
            <div className="grid divide-y divide-line">
              {events.map((event) => (
                <div key={event.id} className="grid gap-3 px-5 py-4 md:grid-cols-[1.1fr_1.6fr_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={event.severity || 'warn'} label={eventSeverityLabel(event.severity)} />
                      <span className="font-bold text-slate-900">{event.accountName}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {event.customer || '고객 미할당'} {event.accountHandle ? `· ${event.accountHandle}` : ''}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-700">{friendlyOpsText(event.title)}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{friendlyOpsText(event.message) || '-'}</div>
                    {event.time && <div className="mt-1 text-[11px] font-medium text-slate-400">{dateTime(event.time)}</div>}
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <IconButton title="설정 열기" onClick={() => onOpenSettings?.(event.accountId)}><Settings size={15} /></IconButton>
                    <IconButton title="큐 보기" onClick={() => onOpenQueue?.(event.accountId)}><ListChecks size={15} /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-12 text-center text-sm text-slate-400">표시할 항목이 없습니다.</div>
          )}
        </div>
        <div className="shrink-0 border-t border-line px-5 py-4 text-right">
          <button onClick={onClose} className="rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white">닫기</button>
        </div>
      </div>
    </div>
  );
}

function ContentQualityPanel() {
  const checkpoints = [
    '상품 매칭 성공률을 먼저 보고, 링크 후보가 자주 부족한 계정을 분리합니다.',
    '최근 주제와 각도가 반복되는지 확인해 다음 생성 정책에 반영합니다.',
    '공감형, 체크리스트형, 문제해결형, 질문형이 한쪽으로 몰리지 않게 봅니다.',
    '클릭이 나온 주제와 상품 패턴은 이후 프롬프트 개선 자료로 모읍니다.'
  ];
  return (
    <section className="rounded border border-line bg-white">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded border border-blue-100 bg-blue-50 text-blue-600">
          <BarChart3 size={18} />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-slate-900">콘텐츠 품질 체크포인트</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            이번 단계에서는 생성 로직을 크게 바꾸지 않고, 운영자가 품질 병목을 판단할 기준을 먼저 정리합니다.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {checkpoints.map((item) => (
              <div key={item} className="rounded border border-line bg-panel px-3 py-2 text-xs font-medium leading-relaxed text-slate-600">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function runResultLabel(row) {
  if (row.status === 'ok') return '성공';
  if (row.reason === 'already_running') return '이미 실행 중';
  if (/Threads|토큰|연결|access token|OAuth/i.test(row.error || row.reason || '')) return '재연결 필요';
  if (row.status === 'skipped') return '스킵';
  return '실패';
}

function OpsCard({ label, value, hint, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`rounded border bg-white p-4 text-left transition ${onClick ? 'hover:-translate-y-0.5 hover:shadow-sm' : ''} ${tone === 'error' ? 'border-rose-200' : tone === 'warn' ? 'border-amber-200' : 'border-line'}`}
    >
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span>{hint}</span>
        {onClick && <ExternalLink size={13} className="shrink-0" />}
      </div>
    </Tag>
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

function dailyPipelineLabel(dailyPipeline) {
  if (!dailyPipeline) return '-';
  if (dailyPipeline.missing) return '누락';
  if (dailyPipeline.status === 'completed') return '성공';
  if (dailyPipeline.status === 'running') return '실행중';
  if (dailyPipeline.status === 'failed') return '실패';
  return '대기';
}

function dailyPipelineTone(dailyPipeline) {
  if (!dailyPipeline) return 'warn';
  if (dailyPipeline.missing || dailyPipeline.status === 'failed') return 'error';
  if (dailyPipeline.status === 'running' || dailyPipeline.status === 'pending') return 'warn';
  return 'ok';
}

function dailyPipelineHint(dailyPipeline) {
  if (!dailyPipeline) return '오늘 2시 실행 기록 확인 중';
  if (dailyPipeline.missing) return '오늘 02:00 실행 기록 없음';
  const summary = dailyPipeline.run?.summary || {};
  if (dailyPipeline.status === 'completed') {
    return `대상 ${summary.total || 0} · 성공 ${summary.ok || 0} · 후보없음 ${summary.noLinkCandidates || 0}`;
  }
  if (dailyPipeline.status === 'running') return '현재 자동 실행 중';
  if (dailyPipeline.status === 'failed') return dailyPipeline.run?.errorMessage || '자동 실행 실패';
  return 'KST 02:00 대기';
}

function dailyResultLabel(result) {
  if (!result) return '';
  if (result.status === 'no_link_candidates' || result.reason === 'pipeline_skipped_no_link_candidates') return '상품 후보 없음';
  if (result.status === 'ok') return '성공';
  if (result.status === 'skipped') return '스킵';
  if (result.status === 'error') return '실패';
  return result.status || '확인 필요';
}

function runCategoryLabel(category) {
  return ({
    ready: '수동 실행 가능',
    threads_reconnect: 'Threads 재연결 필요',
    coupang_settings: '쿠팡 설정 필요',
    queue_cleanup: '큐 정리 필요',
    pipeline_stuck: '멈춘 파이프라인 정리 필요',
    blocked: '실행 차단'
  })[category] || '상태 확인 필요';
}

function activityLabel(action) {
  return ({
    operations_safety_pause: '운영 안전 일시정지',
    operations_link_setup_hold: '링크 설정 확인 대기',
    emergency_pipeline_stopped: '긴급 중지',
    pipeline_background_already_running: '이미 예약 작업 확인 중',
    pipeline_failed_paused: '예약 생성 실패로 자동화 일시중지',
    automation_start_failed_paused: '자동화 시작 점검 필요',
    post_style_blocked: '콘텐츠 후보 제외',
    queue_guardrail_skipped: '콘텐츠 후보 제외',
    upload_reply_failed: '댓글/링크 답글 실패',
    upload_failed: '업로드 실패',
    upload_completed: '업로드 완료',
    threads_oauth_connected: 'Threads 연결됨',
    pipeline_queue_created: '예약 큐 생성',
    account_generated_content_cleared: '생성 산출물 삭제',
    upload_skipped_inactive_account: '비활성 계정 제외'
  })[action] || action;
}

function activityMessage(activity) {
  if (!activity) return '';
  if (activity.action === 'post_style_blocked') return `톤 불일치: ${activity.message || '계정 톤 규칙에 맞지 않아 제외'}`;
  if (activity.action === 'queue_guardrail_skipped') return activity.message || '콘텐츠 안전 규칙에 맞지 않아 제외';
  if (activity.action === 'upload_reply_failed') return '본문 업로드 완료, 댓글/링크 답글은 재시도 필요';
  return activity.message || '';
}

function eventSeverityLabel(severity) {
  if (severity === 'ok') return '완료';
  if (severity === 'running') return '예약';
  if (severity === 'error') return '오류';
  return '주의';
}

function friendlyOpsText(value) {
  return ({
    pipeline_background_already_running: '이미 예약 작업을 확인 중입니다',
    queue_empty: '오늘 예약 가능한 링크 글이 없습니다',
    threads_reconnect: 'Threads 재연결 필요',
    threads_reconnect_required: 'Threads 재연결 필요',
    pipeline_stuck: '예약 작업 확인 필요',
    operations_safety_pause: '운영 안전 점검으로 일시정지',
    operations_link_setup_hold: '상품 링크 설정 확인 필요',
    DB: '서버 저장소',
    preflight: '실행 전 점검',
    probe: '연결 확인'
  })[value] || value;
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
