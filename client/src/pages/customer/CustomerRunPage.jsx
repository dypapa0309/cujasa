import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, PauseCircle, PlayCircle, RotateCw } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../lib/toast.jsx';
import TrialStatusCard from './TrialStatusCard.jsx';
import PreflightModal from './PreflightModal.jsx';
import ErrorReportButton from '../../components/ErrorReportButton.jsx';

export default function CustomerRunPage({
  account,
  currentUser,
  trialStatus,
  reloadTrialStatus,
  reloadAccounts,
  onPipelineDone,
  onPipelineRunningChange,
  setTab
}) {
  const toast = useToast();
  const actionRef = useRef(false);
  const [checking, setChecking] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [preflight, setPreflight] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [runError, setRunError] = useState(null);

  const trialBlocked = trialStatus?.plan === 'free' && trialStatus.blocked;
  const automationStatus = account?.automation_status === 'running' ? 'running' : 'paused';
  const automationRunning = automationStatus === 'running';
  const scheduleText = formatSchedule(account);

  const runPreflight = async ({ showModal = true, mode = null } = {}) => {
    if (!account?.id) return null;
    setChecking(true);
    setRunError(null);
    try {
      const suffix = mode ? `?mode=${encodeURIComponent(mode)}` : '';
      const result = await api.get(`/api/accounts/${account.id}/preflight${suffix}`);
      setLastCheck(result);
      if (showModal) setPreflight(result);
      toast(result.canPublish ? '현재 설정 점검을 통과했습니다.' : '자동화 전에 조치할 항목이 있습니다.', result.canPublish ? 'success' : 'error');
      return result;
    } catch (err) {
      const fallback = err.preflight || {
        canPublish: false,
        severity: 'error',
        checks: [{ status: 'error', title: '점검에 실패했습니다', message: err.message || '잠시 후 다시 시도해주세요.' }]
      };
      setLastCheck(fallback);
      if (showModal) setPreflight(fallback);
      toast('사전 점검에 실패했습니다.', 'error');
      return fallback;
    } finally {
      setChecking(false);
    }
  };

  const setAutomation = async (nextStatus) => {
    if (!account?.id || actionRef.current) return;
    if (nextStatus === 'running' && trialBlocked) {
      toast('무료 체험 포스팅 5회를 모두 사용했습니다. 결제 후 계속 이용할 수 있습니다.', 'error');
      setTab?.('billing');
      return;
    }

    actionRef.current = true;
    setActioning(true);
    setRunError(null);

    try {
      if (nextStatus === 'running') {
        const check = await runPreflight({ showModal: false, mode: 'start' });
        if (!check?.canPublish) {
          setPreflight(check);
          toast('자동화 실행 전에 조치할 항목이 있습니다.', 'error');
          return;
        }
        onPipelineRunningChange?.(true, {
          percent: 0,
          stage: 'starting',
          label: '예약 작업을 준비하고 있습니다'
        });
      }

      const result = await api.patch(`/api/accounts/${account.id}/automation`, {
        automationStatus: nextStatus,
        runNow: nextStatus === 'running'
      });

      reloadAccounts?.();
      reloadTrialStatus?.();

      if (nextStatus === 'paused') {
        onPipelineRunningChange?.(false);
        toast('자동화가 중지됐습니다. 기존 예약은 포스팅 현황에서 확인해주세요.', 'success');
        return;
      }

      if (result?.alreadyRunning) {
        toast(result.message || '이미 예약 작업이 진행 중입니다.', 'info');
        onPipelineRunningChange?.(true, result.run?.progress || {
          percent: 10,
          stage: 'running',
          label: '예약 작업이 진행 중입니다'
        });
        return;
      }

      if (result?.status === 'accepted') {
        toast(result.message || '자동화가 켜졌고 예약 작업을 시작했습니다.', 'success');
        onPipelineRunningChange?.(true, result.run?.progress || {
          percent: 5,
          stage: 'starting',
          label: '예약 작업을 시작했습니다'
        });
        return;
      }

      const pipelineResult = result?.pipelineResult || result;
      const queuedCount = pipelineResult?.queuedCount ?? pipelineResult?.steps?.queued ?? null;
      if (pipelineResult?.status === 'no_link_candidates' || pipelineResult?.code === 'NO_REAL_COUPANG_LINKS') {
        toast(pipelineResult.message || '오늘은 수익화 가능한 상품 링크 후보가 없어 업로드하지 않았습니다.', 'info');
        onPipelineDone?.(pipelineResult);
        onPipelineRunningChange?.(false);
        return;
      }
      if (pipelineResult?.ok === false || pipelineResult?.status === 'error' || queuedCount === 0) {
        const normalized = normalizeRunError(pipelineResult);
        setRunError(normalized);
        toast(normalized.message, 'error');
        onPipelineRunningChange?.(false);
        return;
      }

      toast('자동화가 켜졌고 오늘 예약을 생성했습니다.', 'success');
      onPipelineDone?.(pipelineResult);
    } catch (err) {
      if (err.code === 'FREE_TRIAL_LIMIT_REACHED' || err.upgradeRequired) {
        toast('무료 체험 포스팅 5회를 모두 사용했습니다. 결제 후 계속 이용할 수 있습니다.', 'error');
        setTab?.('billing');
        onPipelineRunningChange?.(false);
        return;
      }
      if (err.networkError && nextStatus === 'running') {
        toast(err.message || '요청 연결이 끊겼지만 서버 작업 상태를 확인하고 있습니다.', 'info');
        onPipelineRunningChange?.(true, {
          percent: 5,
          stage: 'checking',
          label: '서버 작업 상태를 확인하고 있습니다'
        });
        return;
      }
      if (err.preflight) {
        setPreflight(err.preflight);
        toast('자동화 실행 전에 조치할 항목이 있습니다.', 'error');
        onPipelineRunningChange?.(false);
        return;
      }
      const normalized = normalizeRunError(err);
      setRunError(normalized);
      toast(normalized.message, 'error');
      onPipelineRunningChange?.(false);
    } finally {
      actionRef.current = false;
      setActioning(false);
    }
  };

  const warningCount = (lastCheck?.checks || []).filter((check) => check.status === 'warn').length;
  const blockingCount = (lastCheck?.checks || []).filter((check) => check.status === 'error').length;

  return (
    <div className="grid gap-5">
      <TrialStatusCard trialStatus={trialStatus} onUpgrade={() => setTab?.('billing')} />

      <div className={`rounded-2xl border p-5 ${automationRunning ? 'border-emerald-100 bg-emerald-50' : 'border-gray-100 bg-white'}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-2xl p-3 ${automationRunning ? 'bg-white text-emerald-600' : 'bg-blue-50 text-coupang'}`}>
            {automationRunning ? <RotateCw size={24} /> : <PlayCircle size={24} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-lg font-black ${automationRunning ? 'text-emerald-800' : 'text-gray-900'}`}>
              {automationRunning ? '자동화 진행 중' : '자동화 중지됨'}
            </div>
            <p className={`mt-1 text-sm leading-relaxed ${automationRunning ? 'text-emerald-700' : 'text-gray-500'}`}>
              {automationRunning
                ? '중지하기 전까지 서버가 매일 설정값 기준으로 예약을 만들고, 예약 시간이 되면 업로드합니다.'
                : '자동화를 시작하면 오늘 예약을 만들고, 이후 매일 설정값 기준으로 계속 운영합니다.'}
            </p>
            <div className="mt-3 rounded-xl bg-white/75 px-4 py-3 text-sm text-gray-600">
              <span className="font-bold text-gray-800">{account?.name}</span>
              {account?.account_handle && <span className="ml-1 text-gray-400">{account.account_handle}</span>}
              <div className="mt-1 text-xs text-gray-500">{scheduleText}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="font-black text-gray-900">현재 점검 상태</div>
            <p className="mt-1 text-sm text-gray-400">사전 점검은 글을 올리지 않고 현재 설정과 토큰만 확인합니다.</p>
          </div>
          <StatusPill lastCheck={lastCheck} />
        </div>

        {lastCheck && (
          <div className="mb-4 grid gap-2 text-sm">
            {lastCheck.canPublish ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-700">
                <CheckCircle2 size={18} />
                <span className="font-bold">현재 설정 점검을 통과했습니다.</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-rose-700">
                <AlertTriangle size={18} />
                <span className="font-bold">현재 실행을 막는 항목 {blockingCount}개가 있습니다.</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-700">
                과거 실패 기록이나 댓글 실패 같은 경고 {warningCount}개가 있습니다. 현재 실행은 막지 않습니다.
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => runPreflight()}
            disabled={checking || actioning}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-black text-gray-700 disabled:opacity-50"
          >
            {checking ? '점검 중...' : '사전 점검'}
          </button>
          <button
            type="button"
            onClick={() => setAutomation(automationRunning ? 'paused' : 'running')}
            disabled={checking || actioning}
            className={`rounded-xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50 ${
              automationRunning
                ? 'border border-rose-200 bg-white text-rose-600'
                : 'bg-coupang text-white'
            }`}
          >
            {actioning
              ? '처리 중...'
              : automationRunning
                ? <span className="inline-flex items-center justify-center gap-2"><PauseCircle size={18} /> 자동화 중지</span>
                : trialBlocked ? '결제하고 계속하기' : '자동화 시작'}
          </button>
        </div>
      </div>

      {runError && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 p-5 text-rose-700">
          <div className="font-black">자동화 실행이 중단됐습니다</div>
          <p className="mt-2 text-sm leading-relaxed">{runError.message}</p>
          <div className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-xs leading-relaxed">
            <div className="font-bold">현재 예약 후보 상태</div>
            {runError.diagnostics && (
              <div className="mt-2">
                예약 후보 {runError.diagnostics.scheduleCount ?? 0}개 · 연결 가능한 글 {runError.diagnostics.availableLinkPosts ?? 0}개
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => setTab?.('settings')} className="rounded-xl bg-white px-4 py-3 text-xs font-bold text-rose-700">
              설정 확인
            </button>
            <button type="button" onClick={() => runPreflight()} className="rounded-xl border border-rose-200 px-4 py-3 text-xs font-bold text-rose-700">
              다시 점검
            </button>
            <ErrorReportButton
              account={account}
              currentUser={currentUser}
              context={{
                message: runError.message,
                code: runError.code,
                apiSummary: runError
              }}
            />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex items-center gap-2 font-black text-gray-900">
          <ClipboardCheck size={18} />
          운영 방식
        </div>
        <ul className="mt-3 grid gap-2 text-sm leading-relaxed text-gray-500">
          <li>자동화 시작은 오늘 예약을 한 번 만들고, 계정을 자동화 진행 중 상태로 유지합니다.</li>
          <li>서버는 매일 정해진 시간에 진행 중 계정만 다시 예약 생성합니다.</li>
          <li>하루 업로드 수는 최대 5개이며, 실제 쿠팡 상품 매칭이 완료된 글만 예약됩니다.</li>
          <li>과거 실패 기록은 경고로만 표시하고, 현재 토큰이 정상이면 실행을 막지 않습니다.</li>
        </ul>
      </div>

      {preflight && (
        <PreflightModal
          result={preflight}
          onClose={() => setPreflight(null)}
          onReconnect={() => {
            setPreflight(null);
            setTab?.('settings');
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ lastCheck }) {
  if (!lastCheck) return <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-400">점검 전</span>;
  if (lastCheck.canPublish) return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-600">실행 가능</span>;
  return <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-600">조치 필요</span>;
}

function normalizeRunError(error) {
  const queuedCount = error?.queuedCount ?? error?.steps?.queued;
  const noQueue = queuedCount === 0;
  return {
    code: error?.code || error?.error || (noQueue ? 'NO_QUEUE_CREATED' : 'PIPELINE_FAILED'),
    stage: error?.stage || error?.result?.stage || 'pipeline',
    message: error?.message || error?.errorMessage || (noQueue
      ? '오늘은 수익화 가능한 상품 링크 후보가 없어 업로드하지 않았습니다. 상품 매칭 결과를 확인해주세요.'
      : '예약 생성 중 오류가 발생했습니다. 사전 점검 결과를 확인해주세요.'),
    blocking: error?.blocking || [],
    diagnostics: error?.queueDiagnostics || error?.diagnostics || null
  };
}

function formatSchedule(account) {
  const max = Number(account?.daily_post_max ?? 3);
  const limit = Math.min(5, Math.max(0, Number.isFinite(max) ? max : 5));
  return `상품 매칭 성공분만 최대 ${limit}개 예약`;
}
