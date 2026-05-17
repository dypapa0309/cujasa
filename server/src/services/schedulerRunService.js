import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { runFullPipeline } from './pipelineService.js';
import { cleanupOldQueueIssues } from './queueVisibilityService.js';
import { cleanupUnusedPipelineArtifacts } from './unusedArtifactCleanupService.js';
import { cleanupOldActivityLogs } from './activityLogCleanupService.js';
import { sendOpsAlert } from './notificationService.js';
import { expireStalePipelineRuns } from './pipelineRunService.js';
import { enforceDailyQueueLimits, repairReplyLinkFailures } from './schedulerService.js';
import { refreshAnonymousTrendPatternAssets } from './trendReferenceLearningService.js';

export const DAILY_PIPELINE_JOB = 'daily-pipeline';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAILY_PIPELINE_HOUR_KST = 2;
const DEFAULT_DAILY_PIPELINE_STALE_MINUTES = 30;
const DEFAULT_DAILY_PIPELINE_MAX_RUN_MS = 45 * 60 * 1000;
const DEFAULT_DAILY_PIPELINE_CONTINUATION_MAX_RUN_MS = 25 * 60 * 1000;
const DEFAULT_DAILY_PIPELINE_PER_ACCOUNT_MAX_MS = 12 * 60 * 1000;
const DEFAULT_DAILY_PIPELINE_COUPANG_WAIT_BUDGET_MS = 3 * 60 * 1000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DAILY_PIPELINE_STALE_MS = positiveNumber(
  process.env.DAILY_PIPELINE_STALE_MINUTES,
  DEFAULT_DAILY_PIPELINE_STALE_MINUTES
) * 60 * 1000;
const DAILY_PIPELINE_MAX_RUN_MS = positiveNumber(
  process.env.DAILY_PIPELINE_MAX_RUN_MS,
  DEFAULT_DAILY_PIPELINE_MAX_RUN_MS
);
const DAILY_PIPELINE_CONTINUATION_MAX_RUN_MS = positiveNumber(
  process.env.DAILY_PIPELINE_CONTINUATION_MAX_RUN_MS,
  DEFAULT_DAILY_PIPELINE_CONTINUATION_MAX_RUN_MS
);
const DAILY_PIPELINE_PER_ACCOUNT_MAX_MS = positiveNumber(
  process.env.DAILY_PIPELINE_PER_ACCOUNT_MAX_MS,
  DEFAULT_DAILY_PIPELINE_PER_ACCOUNT_MAX_MS
);
const DAILY_PIPELINE_COUPANG_WAIT_BUDGET_MS = positiveNumber(
  process.env.DAILY_PIPELINE_COUPANG_WAIT_BUDGET_MS,
  DEFAULT_DAILY_PIPELINE_COUPANG_WAIT_BUDGET_MS
);

function now() {
  return new Date();
}

export function kstDateString(date = now()) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function hasDailyPipelineWindowPassed(date = now()) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return shifted.getUTCHours() >= DAILY_PIPELINE_HOUR_KST;
}

function schedulerRunSummary(run) {
  return run?.summary && typeof run.summary === 'object' ? run.summary : {};
}

function schedulerProgress(run) {
  const summary = schedulerRunSummary(run);
  return summary.progress && typeof summary.progress === 'object' ? summary.progress : {};
}

function summarizePipelineResults(pipeline = []) {
  const rows = Array.isArray(pipeline) ? pipeline : (Array.isArray(pipeline?.results) ? pipeline.results : []);
  const pending = Array.isArray(pipeline?.pending) ? pipeline.pending : [];
  const skipped = Array.isArray(pipeline?.skipped) ? pipeline.skipped : [];
  const reconnectRequiredRows = rows.filter((row) => {
    const text = [
      row.status,
      row.code,
      row.reason,
      row.message,
      row.error,
      row.label
    ].filter(Boolean).join(' ');
    return /reply_permission_required|threads_reconnect|threads_reconnect_required|Threads.*재연결|댓글 권한|재연결 필요|access token|OAuth/i.test(text);
  });
  const skippedRows = rows.filter((row) => row.status === 'skipped');
  const byStatus = rows.reduce((acc, row) => {
    const key = row.status || (row.ok ? 'ok' : 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total: rows.length,
    pipelineStatus: Array.isArray(pipeline) ? 'completed' : (pipeline.status || (pending.length ? 'partial' : 'completed')),
    processed: Array.isArray(pipeline?.processed) ? pipeline.processed.length : rows.length,
    pending,
    pendingCount: pending.length,
    durationMs: pipeline?.durationMs ?? null,
    ok: rows.filter((row) => row.ok === true || row.status === 'ok').length,
    skipped: skippedRows.length,
    skippedAccounts: skipped.length,
    reconnectRequired: reconnectRequiredRows.length,
    skippedOther: Math.max(0, skippedRows.length - reconnectRequiredRows.filter((row) => row.status === 'skipped').length),
    noLinkCandidates: rows.filter((row) => row.status === 'no_link_candidates').length,
    error: rows.filter((row) => row.ok === false || row.status === 'error').length,
    byStatus,
    results: rows.map((row) => ({
      accountId: row.accountId,
      accountName: row.accountName,
      status: row.status || (row.ok ? 'ok' : 'unknown'),
      ok: row.ok ?? null,
      code: row.code || null,
      reason: row.reason || null,
      message: row.message || row.error || null,
      queuedCount: row.queuedCount ?? row.steps?.queued ?? null
    }))
  };
}

function isDuplicateSchedulerRunError(error) {
  return /scheduler_runs|duplicate key|idx_scheduler_runs_job_date|unique/i.test(error.message || '');
}

function isStaleSchedulerRun(run, date = now()) {
  if (!run || run.status !== 'running') return false;
  const progress = schedulerProgress(run);
  const lastSeen = new Date(progress.updatedAt || run.finished_at || run.started_at).getTime();
  return Number.isFinite(lastSeen) && date.getTime() - lastSeen > DAILY_PIPELINE_STALE_MS;
}

function schedulerPublicStatus(run, date = now()) {
  if (!run) return hasDailyPipelineWindowPassed(date) ? 'missing' : 'pending';
  if (isStaleSchedulerRun(run, date)) return 'stale';
  const summary = schedulerRunSummary(run);
  const pendingCount = summary.pendingCount ?? (Array.isArray(summary.pending) ? summary.pending.length : 0);
  if (run.status === 'completed' && pendingCount > 0) return 'partial';
  return run.status;
}

async function startSchedulerRun({ jobName, runDateKst, triggeredBy, allowPartialResume = false }) {
  const existing = await dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst }).catch(() => null);
  if (existing) {
    const existingSummary = schedulerRunSummary(existing);
    if (isStaleSchedulerRun(existing)) {
      const [run] = await dbUpdate('scheduler_runs', { id: existing.id }, {
        status: 'running',
        triggered_by: triggeredBy,
        started_at: now().toISOString(),
        finished_at: null,
        summary: {
          ...existingSummary,
          recoveredStaleAt: now().toISOString(),
          progress: {
            ...schedulerProgress(existing),
            updatedAt: now().toISOString(),
            stage: 'recovered_stale'
          }
        },
        error_message: null
      });
      return { run, acquired: true, recoveredStale: true };
    }
    if (allowPartialResume && ['partial', 'completed'].includes(existing.status) && (existingSummary.pending || []).length > 0) {
      const [run] = await dbUpdate('scheduler_runs', { id: existing.id }, {
        status: 'running',
        triggered_by: triggeredBy,
        started_at: now().toISOString(),
        finished_at: null,
        summary: {
          ...existingSummary,
          resumedPartialAt: now().toISOString(),
          progress: {
            ...schedulerProgress(existing),
            updatedAt: now().toISOString(),
            stage: 'resumed_partial'
          }
        },
        error_message: null
      });
      return { run, acquired: true, resumedPartial: true };
    }
    return { run: existing, acquired: false };
  }
  try {
    const run = await dbInsert('scheduler_runs', {
      job_name: jobName,
      run_date_kst: runDateKst,
      status: 'running',
      triggered_by: triggeredBy,
      started_at: now().toISOString(),
      summary: {
        progress: {
          updatedAt: now().toISOString(),
          stage: 'started',
          processed: 0,
          pending: 0,
          skipped: 0
        }
      }
    });
    return { run, acquired: true };
  } catch (error) {
    if (!isDuplicateSchedulerRunError(error)) throw error;
    return {
      run: await dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst }),
      acquired: false
    };
  }
}

async function finishSchedulerRun(runId, status, patch = {}) {
  const [updated] = await dbUpdate('scheduler_runs', { id: runId }, {
    status,
    finished_at: now().toISOString(),
    ...patch
  });
  return updated;
}

async function updateSchedulerRunProgress(runId, patch = {}) {
  const run = await dbGet('scheduler_runs', { id: runId });
  const summary = schedulerRunSummary(run);
  const progress = schedulerProgress(run);
  const updatedAt = now().toISOString();
  const [updated] = await dbUpdate('scheduler_runs', { id: runId }, {
    summary: {
      ...summary,
      heartbeatAt: updatedAt,
      progress: {
        ...progress,
        ...patch,
        updatedAt
      }
    }
  });
  return updated;
}

export async function getSchedulerRun(jobName, runDateKst = kstDateString()) {
  return dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst });
}

export async function latestSchedulerRun(jobName = DAILY_PIPELINE_JOB) {
  const rows = await dbList('scheduler_runs', { job_name: jobName }, { order: 'started_at', ascending: false, limit: 1 });
  return rows[0] || null;
}

export async function dailyPipelineStatus(date = now()) {
  const runDateKst = kstDateString(date);
  const run = await getSchedulerRun(DAILY_PIPELINE_JOB, runDateKst).catch(() => null);
  const windowPassed = hasDailyPipelineWindowPassed(date);
  const stale = isStaleSchedulerRun(run, date);
  const summary = schedulerRunSummary(run);
  const progress = schedulerProgress(run);
  const startedAt = run?.started_at ? new Date(run.started_at).getTime() : 0;
  const finishedAt = run?.finished_at ? new Date(run.finished_at).getTime() : 0;
  const durationMs = summary.durationMs ?? (finishedAt && startedAt ? finishedAt - startedAt : (run?.status === 'running' && startedAt ? date.getTime() - startedAt : null));
  const pendingCount = summary.pendingCount ?? (Array.isArray(summary.pending) ? summary.pending.length : 0);
  return {
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    windowPassed,
    missing: windowPassed && !run,
    stale,
    status: schedulerPublicStatus(run, date),
    durationMs,
    heartbeatAt: progress.updatedAt || summary.heartbeatAt || null,
    pendingCount,
    progress,
    run: run ? {
      id: run.id,
      status: run.status,
      triggeredBy: run.triggered_by || null,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      durationMs,
      heartbeatAt: progress.updatedAt || summary.heartbeatAt || null,
      pendingCount,
      summary,
      errorMessage: run.error_message || null
    } : null
  };
}

function dailyPipelineRunOptions(mode = 'scheduled', options = {}) {
  const continuation = mode === 'continuation';
  return {
    maxRunMs: positiveNumber(
      options.maxRunMs,
      continuation ? DAILY_PIPELINE_CONTINUATION_MAX_RUN_MS : DAILY_PIPELINE_MAX_RUN_MS
    ),
    maxAccounts: options.maxAccounts != null
      ? Math.max(0, Number(options.maxAccounts))
      : positiveNumber(process.env.DAILY_PIPELINE_MAX_ACCOUNTS, Number.MAX_SAFE_INTEGER),
    perAccountMaxMs: positiveNumber(options.perAccountMaxMs, DAILY_PIPELINE_PER_ACCOUNT_MAX_MS),
    coupangWaitBudgetMs: positiveNumber(options.coupangWaitBudgetMs, DAILY_PIPELINE_COUPANG_WAIT_BUDGET_MS),
    skipFutureScheduled: options.skipFutureScheduled !== false,
    deferOnCoupangThrottle: options.deferOnCoupangThrottle !== false
  };
}

export async function runDailyPipelineOnce({
  triggeredBy = 'scheduler',
  runDateKst = kstDateString(),
  mode = 'scheduled',
  maxRunMs,
  maxAccounts,
  perAccountMaxMs,
  coupangWaitBudgetMs,
  accountIds,
  skipFutureScheduled,
  deferOnCoupangThrottle
} = {}) {
  const allowPartialResume = ['continuation', 'admin_recovery'].includes(mode);
  const { run, acquired, recoveredStale = false, resumedPartial = false } = await startSchedulerRun({
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    triggeredBy,
    allowPartialResume
  });
  if (!acquired) {
    const status = schedulerPublicStatus(run);
    return {
      ok: status === 'completed' || status === 'partial',
      duplicate: true,
      status,
      run,
      summary: run?.summary || {},
      message: '이미 오늘 2시 자동 실행 기록이 있습니다.'
    };
  }

  const previousSummary = schedulerRunSummary(run);
  const previousPending = Array.isArray(previousSummary.pending) ? previousSummary.pending : [];
  const resumedAccountIds = allowPartialResume && previousPending.length
    ? previousPending.map((item) => item.accountId).filter(Boolean)
    : null;
  const effectiveOptions = dailyPipelineRunOptions(mode, {
    maxRunMs,
    maxAccounts,
    perAccountMaxMs,
    coupangWaitBudgetMs,
    skipFutureScheduled,
    deferOnCoupangThrottle
  });
  const runStartedAt = Date.now();

  await logActivity({
    action: 'scheduler_daily_pipeline_started',
    level: 'info',
    message: `${runDateKst} daily-pipeline ${recoveredStale ? 'stale 재시작' : resumedPartial ? 'partial 이어받기' : '시작'}`,
    payload: { triggeredBy, recoveredStale, resumedPartial, mode, options: effectiveOptions }
  }).catch(() => {});

  try {
    await updateSchedulerRunProgress(run.id, {
      mode,
      stage: 'maintenance',
      processed: 0,
      pending: previousPending.length,
      skipped: 0,
      total: null
    }).catch(() => {});
    const expiredPipelines = await expireStalePipelineRuns();
    const dailyQueueLimits = await enforceDailyQueueLimits();
    const replyRepair = await repairReplyLinkFailures({ dryRun: true, limit: 50 });
    const trendRefresh = process.env.TREND_SOURCE_AUTO_REFRESH === 'false'
      ? { skipped: true, reason: 'TREND_SOURCE_AUTO_REFRESH=false' }
      : await refreshAnonymousTrendPatternAssets().catch((error) => ({
        skipped: true,
        error: error.message,
        code: error.code || null
      }));
    const pipeline = await runFullPipeline({
      requestedBy: triggeredBy,
      accountIds: Array.isArray(accountIds) && accountIds.length ? accountIds : resumedAccountIds,
      maxRunMs: effectiveOptions.maxRunMs,
      maxAccounts: effectiveOptions.maxAccounts,
      perAccountMaxMs: effectiveOptions.perAccountMaxMs,
      coupangWaitBudgetMs: effectiveOptions.coupangWaitBudgetMs,
      skipFutureScheduled: effectiveOptions.skipFutureScheduled,
      deferOnCoupangThrottle: effectiveOptions.deferOnCoupangThrottle,
      onProgress: (progress) => updateSchedulerRunProgress(run.id, {
        ...progress,
        mode
      }).catch(() => {})
    });
    await updateSchedulerRunProgress(run.id, {
      mode,
      stage: pipeline.status === 'partial' ? 'partial' : 'pipeline_completed',
      processed: pipeline.processed?.length || 0,
      pending: pipeline.pending?.length || 0,
      skipped: pipeline.skipped?.length || 0,
      total: pipeline.total || 0
    }).catch(() => {});
    const cleanup = await cleanupUnusedPipelineArtifacts({ mode: 'apply' });
    const oldIssues = await cleanupOldQueueIssues({ mode: 'apply' });
    const oldActivityLogs = await cleanupOldActivityLogs({ mode: 'apply' });
    const finishedAt = now().toISOString();
    const summary = {
      ...summarizePipelineResults(pipeline),
      mode,
      options: effectiveOptions,
      expiredPipelines: expiredPipelines.length,
      dailyQueueLimits,
      replyRepair,
      trendRefresh,
      cleanup,
      oldIssues,
      oldActivityLogs,
      completedAt: finishedAt,
      durationMs: Date.now() - runStartedAt,
      heartbeatAt: finishedAt
    };
    const status = summary.pendingCount > 0 || pipeline.status === 'partial' ? 'partial' : 'completed';
    const storedStatus = status === 'partial' ? 'completed' : status;
    const updated = await finishSchedulerRun(run.id, storedStatus, { summary, error_message: null });
    await logActivity({
      action: status === 'partial' ? 'scheduler_daily_pipeline_partial' : 'scheduler_daily_pipeline_completed',
      level: 'info',
      message: `${runDateKst} daily-pipeline ${status === 'partial' ? '부분 완료' : '완료'}`,
      payload: summary
    }).catch(() => {});
    return {
      ok: status === 'completed',
      duplicate: false,
      recoveredStale,
      resumedPartial,
      status,
      run: { ...updated, status },
      summary,
      processed: summary.processed,
      pending: summary.pending,
      skipped: summary.skipped,
      durationMs: summary.durationMs
    };
  } catch (error) {
    const summary = {
      failedAt: now().toISOString(),
      message: error.message,
      code: error.code || null,
      mode,
      durationMs: Date.now() - runStartedAt
    };
    const updated = await finishSchedulerRun(run.id, 'failed', {
      summary,
      error_message: error.message || 'daily-pipeline failed'
    });
    await sendOpsAlert('scheduler_daily_pipeline_failed', {
      title: '새벽 2시 자동 실행 실패',
      code: error.code || 'DAILY_PIPELINE_FAILED',
      message: error.message,
      hint: 'scheduler_runs와 서버 로그를 확인하세요.',
      payload: { runDateKst, triggeredBy }
    }).catch(() => {});
    return { ok: false, duplicate: false, recoveredStale, status: 'failed', run: updated, summary, error: error.message };
  }
}
