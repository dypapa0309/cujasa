import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { runFullPipeline } from './pipelineService.js';
import { cleanupOldQueueIssues } from './queueVisibilityService.js';
import { cleanupUnusedPipelineArtifacts } from './unusedArtifactCleanupService.js';
import { sendOpsAlert } from './notificationService.js';

export const DAILY_PIPELINE_JOB = 'daily-pipeline';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAILY_PIPELINE_HOUR_KST = 2;

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

function summarizePipelineResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const byStatus = rows.reduce((acc, row) => {
    const key = row.status || (row.ok ? 'ok' : 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total: rows.length,
    ok: rows.filter((row) => row.ok === true || row.status === 'ok').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
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

async function startSchedulerRun({ jobName, runDateKst, triggeredBy }) {
  const existing = await dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst }).catch(() => null);
  if (existing) return { run: existing, acquired: false };
  try {
    const run = await dbInsert('scheduler_runs', {
      job_name: jobName,
      run_date_kst: runDateKst,
      status: 'running',
      triggered_by: triggeredBy,
      started_at: now().toISOString(),
      summary: {}
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
  return {
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    windowPassed,
    missing: windowPassed && !run,
    status: run?.status || (windowPassed ? 'missing' : 'pending'),
    run: run ? {
      id: run.id,
      status: run.status,
      triggeredBy: run.triggered_by || null,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      summary: run.summary || {},
      errorMessage: run.error_message || null
    } : null
  };
}

export async function runDailyPipelineOnce({ triggeredBy = 'scheduler', runDateKst = kstDateString() } = {}) {
  const { run, acquired } = await startSchedulerRun({
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    triggeredBy
  });
  if (!acquired) {
    return {
      ok: run?.status === 'completed',
      duplicate: true,
      status: run?.status || 'unknown',
      run,
      summary: run?.summary || {},
      message: '이미 오늘 2시 자동 실행 기록이 있습니다.'
    };
  }

  await logActivity({
    action: 'scheduler_daily_pipeline_started',
    level: 'info',
    message: `${runDateKst} daily-pipeline 시작`,
    payload: { triggeredBy }
  }).catch(() => {});

  try {
    const pipeline = await runFullPipeline({ requestedBy: triggeredBy });
    const cleanup = await cleanupUnusedPipelineArtifacts({ mode: 'apply' });
    const oldIssues = await cleanupOldQueueIssues({ mode: 'apply' });
    const summary = {
      ...summarizePipelineResults(pipeline),
      cleanup,
      oldIssues,
      completedAt: now().toISOString()
    };
    const updated = await finishSchedulerRun(run.id, 'completed', { summary, error_message: null });
    await logActivity({
      action: 'scheduler_daily_pipeline_completed',
      level: 'info',
      message: `${runDateKst} daily-pipeline 완료`,
      payload: summary
    }).catch(() => {});
    return { ok: true, duplicate: false, status: 'completed', run: updated, summary };
  } catch (error) {
    const summary = {
      failedAt: now().toISOString(),
      message: error.message,
      code: error.code || null
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
    return { ok: false, duplicate: false, status: 'failed', run: updated, summary, error: error.message };
  }
}
