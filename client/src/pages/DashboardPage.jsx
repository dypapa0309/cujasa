import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, ListChecks, Play, RefreshCw, Settings, Users, Wrench } from 'lucide-react';
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
  const [conflicts, setConflicts] = useState([]);
  const [misassignments, setMisassignments] = useState(null);
  const [preflightModal, setPreflightModal] = useState(null);
  const [runSummaryModal, setRunSummaryModal] = useState(null);
  const [cleaningQueue, setCleaningQueue] = useState(false);

  const load = async () => {
    const [nextSummary, nextRows, nextConflicts, nextMisassignments] = await Promise.all([
      api.get('/api/admin/operations/summary'),
      api.get('/api/admin/operations/accounts'),
      api.get('/api/admin/account-conflicts').catch(() => []),
      api.get('/api/admin/account-misassignments').catch(() => null)
    ]);
    setSummary(nextSummary);
    setRows(nextRows);
    setConflicts(nextConflicts || []);
    setMisassignments(nextMisassignments);
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
      const preflight = await api.get(`/api/accounts/${row.accountId}/preflight`);
      if (!preflight.canPublish) {
        setPreflightModal({ accountName: row.accountName, result: preflight });
        toast(`${row.accountName} 실행 전 확인이 필요합니다.`, 'error');
        return;
      }
      await api.post(`/api/accounts/${row.accountId}/run-pipeline`, {});
      toast(`${row.accountName} 자동화가 완료됐습니다.`, 'success');
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
          <button
            onClick={cleanupQueueErrors}
            disabled={cleaningQueue}
            className="inline-flex items-center gap-2 rounded border border-line bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {cleaningQueue ? <Spinner /> : <Wrench size={16} />}
            실패 큐 정리
          </button>
        </div>
      </div>

      <RiskPanel
        conflicts={conflicts}
        misassignments={misassignments}
        onOpenUsers={() => setPage?.('admin-users')}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <OpsCard label="계정" value={`${summary?.cards?.accountsActive ?? 0}/${summary?.cards?.accountsTotal ?? 0}`} hint="활성 / 전체" tone="ok" />
        <OpsCard label="오늘 예약" value={summary?.cards?.scheduledToday ?? 0} hint={`오늘 업로드 완료 ${summary?.cards?.postedToday ?? 0}개`} tone="ok" />
        <OpsCard label="실패/검토" value={summary?.cards?.queueProblems ?? 0} hint="failed · retry · manual_required" tone={(summary?.cards?.queueProblems ?? 0) > 0 ? 'error' : 'ok'} />
        <OpsCard label="연결 문제" value={summary?.cards?.threadsProblems ?? 0} hint={`테스트 업로드 ${summary?.cards?.mockUploads ?? 0}개`} tone={(summary?.cards?.threadsProblems ?? 0) > 0 ? 'warn' : 'ok'} />
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
                    <div className="text-xs text-slate-400">실패/검토 {row.failedCount} · 댓글경고 {row.replyWarningCount || 0} · 테스트 {row.mockCount}</div>
                  </td>
                  <td className="px-4 py-3">
                    {row.pipelineRun?.status === 'running' ? (
                      <div className="inline-flex items-center gap-1 text-xs font-bold text-blue-600"><Clock3 size={13} />자동화 실행 중</div>
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
    </div>
  );
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
  if (details.linkPostRatioPercent === undefined) return null;
  return (
    <div className="mt-3 grid gap-1 rounded bg-white/70 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-600">
      <div>실상품 {details.realProductCount ?? 0}개 · 선택된 실상품 {details.selectedRealCount ?? 0}개 · 링크 글 비율 {details.linkPostRatioPercent ?? 0}%</div>
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

function runResultLabel(row) {
  if (row.status === 'ok') return '성공';
  if (row.reason === 'already_running') return '이미 실행 중';
  if (/Threads|토큰|연결|access token|OAuth/i.test(row.error || row.reason || '')) return '재연결 필요';
  if (row.status === 'skipped') return '스킵';
  return '실패';
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

function activityLabel(action) {
  return ({
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

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
