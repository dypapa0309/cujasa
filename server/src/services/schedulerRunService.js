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
const DEFAULT_DAILY_PIPELINE_FAILED_RETRY_LIMIT = 4;
const DAILY_PIPELINE_FAILED_RETRY_LIMIT = Math.max(0, Math.round(positiveNumber(
  process.env.DAILY_PIPELINE_FAILED_RETRY_LIMIT,
  DEFAULT_DAILY_PIPELINE_FAILED_RETRY_LIMIT
)));
const DEFAULT_DAILY_PIPELINE_LEASE_TTL_MS = 15 * 60 * 1000;
const DAILY_PIPELINE_LEASE_TTL_MS = positiveNumber(
  process.env.DAILY_PIPELINE_LEASE_TTL_MS,
  DEFAULT_DAILY_PIPELINE_LEASE_TTL_MS
);
const DEFAULT_DAILY_PIPELINE_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
const DAILY_PIPELINE_HEARTBEAT_INTERVAL_MS = positiveNumber(
  process.env.DAILY_PIPELINE_HEARTBEAT_INTERVAL_MS,
  DEFAULT_DAILY_PIPELINE_HEARTBEAT_INTERVAL_MS
);
const DEFAULT_DAILY_PIPELINE_CIRCUIT_BREAKER_THRESHOLD = 5;
const DAILY_PIPELINE_CIRCUIT_BREAKER_THRESHOLD = Math.max(1, Math.round(positiveNumber(
  process.env.DAILY_PIPELINE_CIRCUIT_BREAKER_THRESHOLD,
  DEFAULT_DAILY_PIPELINE_CIRCUIT_BREAKER_THRESHOLD
)));
const DEFAULT_DAILY_PIPELINE_TRANSIENT_BACKOFF_BASE_MS = 30 * 1000;
const DAILY_PIPELINE_TRANSIENT_BACKOFF_BASE_MS = positiveNumber(
  process.env.DAILY_PIPELINE_TRANSIENT_BACKOFF_BASE_MS,
  DEFAULT_DAILY_PIPELINE_TRANSIENT_BACKOFF_BASE_MS
);
const DEFAULT_DAILY_PIPELINE_TRANSIENT_BACKOFF_MAX_MS = 10 * 60 * 1000;
const DAILY_PIPELINE_TRANSIENT_BACKOFF_MAX_MS = positiveNumber(
  process.env.DAILY_PIPELINE_TRANSIENT_BACKOFF_MAX_MS,
  DEFAULT_DAILY_PIPELINE_TRANSIENT_BACKOFF_MAX_MS
);

const TRANSIENT_PIPELINE_ERROR_PATTERN = /connect_timeout|econnreset|econnrefused|etimedout|eai_again|pool|429|retry-after|timeout|timed out|aborted|temporarily unavailable|unavailable|network/i;

// Transient (connectivity/rate-limit) failures get jitter exponential backoff and never
// increment the circuit breaker; permanent (schema/validation/programmer) failures fast-fail
// and increment it (pre-mortem 3: a Supabase/429 storm must never trip a false critical stop).
export function classifyPipelineError(error) {
  const text = [error?.code, error?.name, error?.message].filter(Boolean).join(' ');
  return TRANSIENT_PIPELINE_ERROR_PATTERN.test(text) ? 'transient' : 'permanent';
}

function pipelineErrorSignature(error) {
  return `${error?.code || ''}:${error?.message || ''}`;
}

// D2 note: lease TTL must exceed DAILY_PIPELINE_PER_ACCOUNT_MAX_MS (worst-case blocked-event-loop
// span) with margin, so a healthy executor's lease never expires mid-step.
export function computeTransientBackoffMs(attempt, randomFn = Math.random) {
  const exponent = Math.max(0, Number(attempt) - 1);
  const raw = DAILY_PIPELINE_TRANSIENT_BACKOFF_BASE_MS * (2 ** exponent);
  const capped = Math.min(DAILY_PIPELINE_TRANSIENT_BACKOFF_MAX_MS, raw);
  const jitter = capped * 0.25 * randomFn();
  return Math.round(capped * 0.75 + jitter);
}

function now() {
  return new Date();
}

// Pure circuit-breaker bookkeeping (P3 invariant 7), split out so it is unit-testable without
// forcing an actual pipeline failure: 5 consecutive IDENTICAL permanent errors (same runDateKst)
// trip a critical stop; a transient error neither increments nor resets the counter; any
// already-tripped state for the day stays tripped until a success or a new day resets it
// (see the `circuit: { consecutiveSameError: 0, tripped: false }` reset in the success path).
export function deriveCircuitBreakerState({ previousSummary = {}, runDateKst, classification, signature }) {
  const previousCircuit = previousSummary.circuit || {};
  const sameDay = previousCircuit.runDateKst === runDateKst;
  let consecutiveSameError = sameDay ? Number(previousCircuit.consecutiveSameError || 0) : 0;
  if (classification === 'permanent') {
    consecutiveSameError = (sameDay && previousCircuit.lastErrorSignature === signature)
      ? consecutiveSameError + 1
      : 1;
  }
  const alreadyTripped = Boolean(sameDay && previousCircuit.tripped);
  const tripped = alreadyTripped || (classification === 'permanent' && consecutiveSameError >= DAILY_PIPELINE_CIRCUIT_BREAKER_THRESHOLD);
  return {
    circuit: { runDateKst, lastErrorSignature: signature, lastClassification: classification, consecutiveSameError, tripped },
    justTripped: tripped && !alreadyTripped
  };
}

// Pure transient-backoff bookkeeping (P3 invariants 6+8): a transient classification schedules a
// jitter exponential delay before the failed-run CAS gate will even attempt the next retry; a
// permanent classification clears any pending backoff (it is fast-failed/gated by the breaker
// instead).
export function deriveTransientBackoffState({ previousSummary = {}, runDateKst, classification, date = now() }) {
  const previousTransient = previousSummary.transient || {};
  const sameDay = previousTransient.runDateKst === runDateKst;
  if (classification !== 'transient') {
    return { runDateKst, attempt: 0, nextEligibleRetryAt: null };
  }
  const attempt = (sameDay ? Number(previousTransient.attempt || 0) : 0) + 1;
  const delayMs = computeTransientBackoffMs(attempt);
  return { runDateKst, attempt, nextEligibleRetryAt: new Date(date.getTime() + delayMs).toISOString() };
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

function isAutomationRunningAccount(account = {}) {
  return account?.status === 'active' && account?.automation_status === 'running';
}

function kstDayRangeFromDateString(runDateKst = kstDateString()) {
  const [year, month, day] = String(runDateKst).split('-').map((part) => Number(part));
  const start = new Date(Date.UTC(year, month - 1, day) - KST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function hasRunDateQueueCoverage(rows = [], accountId, runDateKst = kstDateString()) {
  const { start, end } = kstDayRangeFromDateString(runDateKst);
  return rows.some((row) => {
    if (row.account_id !== accountId) return false;
    if (!['scheduled', 'retry', 'posting', 'posted'].includes(row.status)) return false;
    const time = new Date(row.posted_at || row.scheduled_at || 0).getTime();
    return time >= start.getTime() && time < end.getTime();
  });
}

function minutesOfDay(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export async function evaluateDailyQueueSla(date = now(), { runDateKst: runDateKstOverride } = {}) {
  const runDateKst = runDateKstOverride || kstDateString(date);
  const { start: dayStartUtc, end: dayEndUtc } = kstDayRangeFromDateString(runDateKst);
  const accounts = await dbList('accounts', { status: 'active' });
  const activeRunning = accounts.filter(isAutomationRunningAccount);
  const queue = await dbList('post_queue', {}, {
    gte: { scheduled_at: dayStartUtc.toISOString() },
    lte: { scheduled_at: dayEndUtc.toISOString() }
  });

  const breaching = [];
  for (const account of activeRunning) {
    if (hasRunDateQueueCoverage(queue, account.id, runDateKst)) continue;

    const validStarts = (Array.isArray(account.active_time_windows) ? account.active_time_windows : [])
      .map((window) => minutesOfDay(window?.start))
      .filter((minutes) => minutes !== null);
    const earliestStartMin = validStarts.length > 0 ? Math.min(...validStarts) : 9 * 60;

    const deadlineUtcMs = dayStartUtc.getTime() + (earliestStartMin - 60) * 60 * 1000;
    if (date.getTime() >= deadlineUtcMs) {
      breaching.push({
        accountId: account.id,
        accountName: account.name,
        accountHandle: account.account_handle,
        earliestStartMin,
        deadlineIso: new Date(deadlineUtcMs).toISOString()
      });
    }
  }

  return { runDateKst, breaching, checkedActiveRunning: activeRunning.length };
}

function missingFutureQueueReason(row = {}) {
  const code = row.code || row.reason || row.status || 'NO_FUTURE_QUEUE';
  const message = row.message || row.error || row.reason || '당일 예약 큐가 없습니다.';
  if (/threads_reconnect|reply_permission|token|oauth/i.test(code) || /Threads.*토큰|재연결|댓글 권한/i.test(message)) {
    return { code: 'THREADS_RECONNECT_REQUIRED', recoverable: false };
  }
  if (['deferred_coupang_throttle', 'DEFERRED_COUPANG_THROTTLE', 'deferred_time_budget', 'PIPELINE_ACCOUNT_TIME_BUDGET_EXCEEDED', 'COUPANG_RATE_LIMIT', 'COUPANG_LOCK_UNAVAILABLE', 'already_running'].includes(code)) {
    return { code, recoverable: true };
  }
  if (['BILLING_EXPIRED', 'BILLING_REQUIRED', 'billing_expired', 'billing_required', 'NO_DRAFT_POSTS', 'QUALITY_FILTER_REJECTED_DRAFTS', 'NO_REAL_COUPANG_LINKS', 'NO_REAL_PRODUCTS', 'NO_QUEUEABLE_DRAFTS', 'preflight_failed', 'coupang_settings'].includes(code)) {
    return { code, recoverable: false };
  }
  return { code, recoverable: true };
}

async function buildFutureQueueCoverage(pipeline = [], { runDateKst = kstDateString() } = {}) {
  const rows = Array.isArray(pipeline) ? pipeline : (Array.isArray(pipeline?.results) ? pipeline.results : []);
  const resultByAccountId = new Map(rows.map((row) => [row.accountId, row]));
  const [accounts, queue] = await Promise.all([
    dbList('accounts', { status: 'active' }),
    dbList('post_queue')
  ]);
  const activeRunning = accounts.filter(isAutomationRunningAccount);
  const missingFutureQueue = [];
  for (const account of activeRunning) {
    if (hasRunDateQueueCoverage(queue, account.id, runDateKst)) continue;
    const result = resultByAccountId.get(account.id) || {};
    const reason = missingFutureQueueReason(result);
    missingFutureQueue.push({
      accountId: account.id,
      accountName: account.name,
      accountHandle: account.account_handle || '',
      status: result.status || null,
      code: reason.code,
      reason: result.reason || result.message || result.error || '당일 예약 큐가 없습니다.',
      recoverable: reason.recoverable
    });
  }
  const recoverableMissingFutureQueue = missingFutureQueue.filter((row) => row.recoverable);
  const blockedMissingFutureQueue = missingFutureQueue.filter((row) => !row.recoverable);
  return {
    activeRunningCount: activeRunning.length,
    missingFutureQueue,
    missingFutureQueueCount: missingFutureQueue.length,
    recoverableMissingFutureQueue,
    recoverableMissingFutureQueueCount: recoverableMissingFutureQueue.length,
    blockedMissingFutureQueue,
    blockedMissingFutureQueueCount: blockedMissingFutureQueue.length
  };
}

function mergePendingWithRecoverableMissing(pending = [], recoverableMissingFutureQueue = []) {
  const merged = [...pending];
  const seen = new Set(merged.map((row) => row.accountId).filter(Boolean));
  for (const row of recoverableMissingFutureQueue) {
    if (!row.accountId || seen.has(row.accountId)) continue;
    merged.push({
      accountId: row.accountId,
      accountName: row.accountName,
      reason: row.code || 'missing_future_queue'
    });
    seen.add(row.accountId);
  }
  return merged;
}

function mergeDailyPipelineResultRows(previousRows = [], currentRows = []) {
  const merged = new Map();
  for (const row of [...previousRows, ...currentRows]) {
    const key = row.accountId || row.pipelineRunId || `${row.accountName || 'row'}:${merged.size}`;
    merged.set(key, row);
  }
  return [...merged.values()];
}

function summarizeDailyPipelineRows(rows = [], base = {}) {
  const byStatus = rows.reduce((acc, row) => {
    const key = row.status || (row.ok ? 'ok' : 'unknown');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const reconnectRequired = rows.filter((row) => {
    const text = [
      row.status,
      row.code,
      row.reason,
      row.message,
      row.error
    ].filter(Boolean).join(' ');
    return /reply_permission_required|threads_reconnect|threads_reconnect_required|Threads.*재연결|댓글 권한|재연결 필요|access token|OAuth/i.test(text);
  }).length;
  return {
    ...base,
    total: rows.length,
    processed: rows.length,
    ok: rows.filter((row) => row.ok === true || row.status === 'ok').length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    reconnectRequired,
    skippedOther: Math.max(0, rows.filter((row) => row.status === 'skipped').length - reconnectRequired),
    noLinkCandidates: rows.filter((row) => row.status === 'no_link_candidates').length,
    error: rows.filter((row) => row.ok === false || row.status === 'error').length,
    byStatus,
    results: rows
  };
}

function isDuplicateSchedulerRunError(error) {
  return /scheduler_runs|duplicate key|idx_scheduler_runs_job_date|unique/i.test(error.message || '');
}

// D2: lease TTL used ONLY for the takeover/reclaim decision on the running->running (stale)
// path. isStaleSchedulerRun (30min) is left untouched for existing display/status callers.
function isLeaseReclaimable(run, date = now()) {
  if (!run || run.status !== 'running') return false;
  const progress = schedulerProgress(run);
  const lastSeen = new Date(progress.updatedAt || run.finished_at || run.started_at).getTime();
  return Number.isFinite(lastSeen) && date.getTime() - lastSeen > DAILY_PIPELINE_LEASE_TTL_MS;
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

async function startSchedulerRun({ jobName, runDateKst, triggeredBy, allowPartialResume = false, forceResume = false, date = now() }) {
  const existing = await dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst }).catch(() => null);
  if (existing) {
    const existingSummary = schedulerRunSummary(existing);
    const resumePending = Array.isArray(existingSummary.pending) ? existingSummary.pending : [];

    // D2 (pass-2 fix): the STALE branch is running->running, so status guards nothing. Gate the
    // CAS on the MUTATING started_at column instead: win iff the conditional update affects
    // exactly one row. The winner rewrites started_at so a concurrent loser's identical
    // { started_at: priorStartedAt } filter matches zero rows.
    if (isLeaseReclaimable(existing, date)) {
      const priorStartedAt = existing.started_at;
      const nowIso = now().toISOString();
      const rows = await dbUpdate('scheduler_runs', { id: existing.id, started_at: priorStartedAt }, {
        status: 'running',
        triggered_by: triggeredBy,
        started_at: nowIso,
        finished_at: null,
        summary: {
          ...existingSummary,
          recoveredStaleAt: nowIso,
          progress: {
            ...schedulerProgress(existing),
            updatedAt: nowIso,
            stage: 'recovered_stale'
          }
        },
        error_message: null
      });
      if (rows.length === 1) return { run: rows[0], acquired: true, recoveredStale: true };
      const refetched = await dbGet('scheduler_runs', { id: existing.id }).catch(() => existing);
      return { run: refetched, acquired: false };
    }

    // PARTIAL-RESUME branch: gate on the current stored status (always 'completed' in practice,
    // 'partial' kept defensively) so the CAS win-check is also an effective status transition.
    if (allowPartialResume && ['partial', 'completed'].includes(existing.status) && (forceResume || resumePending.length > 0)) {
      const nowIso = now().toISOString();
      const rows = await dbUpdate('scheduler_runs', { id: existing.id, status: existing.status }, {
        status: 'running',
        triggered_by: triggeredBy,
        started_at: nowIso,
        finished_at: null,
        summary: {
          ...existingSummary,
          resumedPartialAt: nowIso,
          progress: {
            ...schedulerProgress(existing),
            updatedAt: nowIso,
            stage: 'resumed_partial'
          }
        },
        error_message: null
      });
      if (rows.length === 1) return { run: rows[0], acquired: true, resumedPartial: true };
      const refetched = await dbGet('scheduler_runs', { id: existing.id }).catch(() => existing);
      return { run: refetched, acquired: false };
    }

    // FAILED branch: hard safety cap first (never exceed DAILY_PIPELINE_FAILED_RETRY_LIMIT
    // regardless of SLA), then circuit-breaker (halts recovery for the day once tripped), then
    // transient backoff (jitter exponential delay before the next retry is even attempted), then
    // the SLA gate itself — recovery is allowed only while some active-running account is still
    // breaching (before its MIN-configured-window-start minus 60min).
    const failedRecoveryAttempts = Number(existingSummary.failedRecoveryAttempts || 0);
    const circuitState = existingSummary.circuit || {};
    const circuitTrippedToday = Boolean(circuitState.tripped) && circuitState.runDateKst === runDateKst;
    const hardCapReached = failedRecoveryAttempts >= DAILY_PIPELINE_FAILED_RETRY_LIMIT;
    const transientState = existingSummary.transient || {};
    const backoffActive = transientState.runDateKst === runDateKst
      && transientState.nextEligibleRetryAt
      && date.getTime() < new Date(transientState.nextEligibleRetryAt).getTime();

    if (allowPartialResume && existing.status === 'failed' && !circuitTrippedToday && !hardCapReached && !backoffActive) {
      const sla = await evaluateDailyQueueSla(date, { runDateKst }).catch(() => ({ breaching: [] }));
      if (sla.breaching.length > 0) {
        const nowIso = now().toISOString();
        const rows = await dbUpdate('scheduler_runs', { id: existing.id, status: 'failed' }, {
          status: 'running',
          triggered_by: triggeredBy,
          started_at: nowIso,
          finished_at: null,
          summary: {
            ...existingSummary,
            failedRecoveryAttempts: failedRecoveryAttempts + 1,
            recoveredFailedAt: nowIso,
            slaRecovery: { breachingCount: sla.breaching.length, runDateKst: sla.runDateKst },
            progress: {
              ...schedulerProgress(existing),
              updatedAt: nowIso,
              stage: 'recovered_failed'
            }
          },
          error_message: null
        });
        if (rows.length === 1) return { run: rows[0], acquired: true, recoveredFailed: true };
        const refetched = await dbGet('scheduler_runs', { id: existing.id }).catch(() => existing);
        return { run: refetched, acquired: false };
      }
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

async function finishSchedulerRun(runId, status, patch = {}, leaseToken = null) {
  const filters = leaseToken ? { id: runId, started_at: leaseToken } : { id: runId };
  const [updated] = await dbUpdate('scheduler_runs', filters, {
    status,
    finished_at: now().toISOString(),
    ...patch
  });
  return updated || null;
}

async function updateSchedulerRunProgress(runId, patch = {}, leaseToken = null) {
  const run = await dbGet('scheduler_runs', { id: runId });
  if (leaseToken && run?.started_at !== leaseToken) return run || null;
  const summary = schedulerRunSummary(run);
  const progress = schedulerProgress(run);
  const updatedAt = now().toISOString();
  const filters = leaseToken ? { id: runId, started_at: leaseToken } : { id: runId };
  const [updated] = await dbUpdate('scheduler_runs', filters, {
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
  return updated || run || null;
}

export async function getSchedulerRun(jobName, runDateKst = kstDateString()) {
  return dbGet('scheduler_runs', { job_name: jobName, run_date_kst: runDateKst });
}

export async function latestSchedulerRun(jobName = DAILY_PIPELINE_JOB) {
  const rows = await dbList('scheduler_runs', { job_name: jobName }, { order: 'started_at', ascending: false, limit: 1 });
  return rows[0] || null;
}

export async function expireStaleSchedulerRuns({
  jobName = DAILY_PIPELINE_JOB,
  date = now(),
  beforeRunDateKst = null,
  excludeRunId = null,
  limit = 100
} = {}) {
  const rows = await dbList('scheduler_runs', { job_name: jobName, status: 'running' }, {
    order: 'started_at',
    ascending: true,
    limit: Math.max(1, Math.min(Number(limit) || 100, 500))
  });
  const expired = [];
  for (const run of rows) {
    if (excludeRunId && run.id === excludeRunId) continue;
    if (beforeRunDateKst && String(run.run_date_kst) >= String(beforeRunDateKst)) continue;
    if (!isStaleSchedulerRun(run, date)) continue;
    const summary = schedulerRunSummary(run);
    const progress = schedulerProgress(run);
    const expiredAt = date.toISOString();
    const [updated] = await dbUpdate('scheduler_runs', { id: run.id }, {
      status: 'failed',
      finished_at: expiredAt,
      error_message: 'daily-pipeline 실행 기록이 오래 갱신되지 않아 만료 처리했습니다.',
      summary: {
        ...summary,
        failedAt: expiredAt,
        code: 'SCHEDULER_RUN_STALE',
        message: 'daily-pipeline 실행 기록이 오래 갱신되지 않아 만료 처리했습니다.',
        staleStage: progress.stage || null,
        lastHeartbeatAt: progress.updatedAt || summary.heartbeatAt || run.started_at || null
      }
    });
    if (updated) expired.push(updated);
  }
  return expired;
}

export async function dailyPipelineStatus(date = now()) {
  const runDateKst = kstDateString(date);
  const run = await getSchedulerRun(DAILY_PIPELINE_JOB, runDateKst).catch(() => null);
  const windowPassed = hasDailyPipelineWindowPassed(date);
  const stale = isStaleSchedulerRun(run, date);
  const summary = schedulerRunSummary(run);
  const liveFutureQueueCoverage = run
    ? await buildFutureQueueCoverage({ results: summary.results || [] }, { runDateKst }).catch((error) => ({
      coverageError: error.message || 'future queue coverage check failed',
      activeRunningCount: null,
      missingFutureQueue: [],
      missingFutureQueueCount: null,
      recoverableMissingFutureQueue: [],
      recoverableMissingFutureQueueCount: 0,
      blockedMissingFutureQueue: [],
      blockedMissingFutureQueueCount: 0
    }))
    : null;
  const enrichedSummary = liveFutureQueueCoverage
    ? { ...summary, futureQueueCoverage: liveFutureQueueCoverage }
    : summary;
  const progress = schedulerProgress(run);
  const startedAt = run?.started_at ? new Date(run.started_at).getTime() : 0;
  const finishedAt = run?.finished_at ? new Date(run.finished_at).getTime() : 0;
  const durationMs = enrichedSummary.durationMs ?? (finishedAt && startedAt ? finishedAt - startedAt : (run?.status === 'running' && startedAt ? date.getTime() - startedAt : null));
  const basePendingCount = enrichedSummary.pendingCount ?? (Array.isArray(enrichedSummary.pending) ? enrichedSummary.pending.length : 0);
  const livePendingCount = enrichedSummary.futureQueueCoverage?.recoverableMissingFutureQueueCount;
  const pendingCount = Number.isFinite(Number(livePendingCount))
    ? Number(livePendingCount)
    : basePendingCount;
  const publicStatus = run
    ? schedulerPublicStatus({
      ...run,
      summary: {
        ...enrichedSummary,
        pendingCount
      }
    }, date)
    : schedulerPublicStatus(run, date);
  return {
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    windowPassed,
    missing: windowPassed && !run,
    stale,
    status: publicStatus,
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
      summary: enrichedSummary,
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
  deferOnCoupangThrottle,
  forceResume = false,
  date = now(),
  // Bounded self-kill (P3 invariant 4) MUST be opted into by the caller. It is enabled only by
  // the dedicated `runDailyPipelineTask.js` entrypoint (the Render cron process AND the isolated
  // admin_recovery child forked from the always-on worker) and MUST stay disabled for any call
  // made from inside the shared per-minute `runInternalSchedulerWorker.js` process.
  selfKillEnabled = false,
  // Injectable termination hook so tests can observe the self-kill decision without actually
  // tearing down the host process. Production default is a real, unconditional process.exit(1) —
  // the whole point of the hard deadline is to end a hung/blocked run that a graceful return can't.
  onSelfKill = () => process.exit(1),
  // Test-only injection seam (defaults to the real pipeline): lets tests deterministically make
  // the run body outlast a tiny maxRunMs with real timers instead of freezing every timer in the
  // process via mock timers (which would also freeze this function's own self-kill setTimeout).
  runPipeline = runFullPipeline
} = {}) {
  const allowPartialResume = ['continuation', 'admin_recovery'].includes(mode);
  const { run, acquired, recoveredStale = false, resumedPartial = false, recoveredFailed = false } = await startSchedulerRun({
    jobName: DAILY_PIPELINE_JOB,
    runDateKst,
    triggeredBy,
    allowPartialResume,
    forceResume,
    date
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

  // Holder-side write fencing (P3 invariant 5): every progress/finish write below is
  // conditioned on this lease token (the started_at value this call just won). If a takeover
  // ever evicts this holder mid-run, started_at changes and the fenced update becomes a no-op
  // instead of clobbering the new holder's row.
  const leaseToken = run.started_at;
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
    message: `${runDateKst} daily-pipeline ${recoveredStale ? 'stale 재시작' : recoveredFailed ? 'failed 재시도' : resumedPartial ? 'partial 이어받기' : '시작'}`,
    payload: { triggeredBy, recoveredStale, recoveredFailed, resumedPartial, mode, options: effectiveOptions }
  }).catch(() => {});

  let heartbeatTimer = null;
  let selfKillTimer = null;
  let selfKillFired = false;

  try {
    // Heartbeat with mandatory cleanup (P3 invariant 3): refresh heartbeatAt every
    // ~2min so a healthy run's lease never looks reclaimable. MUST be cleared + unref'd (below,
    // in `finally`) so a successful run drains the event loop and the cron process actually exits.
    heartbeatTimer = setInterval(() => {
      updateSchedulerRunProgress(run.id, { mode, stage: 'heartbeat' }, leaseToken).catch(() => {});
    }, DAILY_PIPELINE_HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();

    // Bounded self-kill (P3 invariant 4): hard executor deadline. Only armed when the caller
    // opted in via selfKillEnabled (dedicated cron / isolated admin_recovery child) — never inside
    // the shared always-on worker process.
    if (selfKillEnabled) {
      selfKillTimer = setTimeout(() => {
        selfKillFired = true;
        (async () => {
          await finishSchedulerRun(run.id, 'failed', {
            summary: {
              ...previousSummary,
              failedAt: now().toISOString(),
              code: 'DAILY_PIPELINE_SELF_KILL',
              message: `daily-pipeline exceeded max run time of ${effectiveOptions.maxRunMs}ms and was self-terminated`,
              mode
            },
            error_message: 'daily-pipeline self-kill: exceeded max run time'
          }, leaseToken).catch(() => {});
          await sendOpsAlert('scheduler_daily_pipeline_self_kill', {
            title: '새벽 2시 자동 실행 강제 종료',
            code: 'DAILY_PIPELINE_SELF_KILL',
            message: `실행 시간이 ${effectiveOptions.maxRunMs}ms를 초과하여 강제 종료되었습니다.`,
            hint: 'scheduler_runs와 서버 로그를 확인하세요.',
            payload: { runDateKst, triggeredBy, mode }
          }).catch(() => {});
        })().finally(() => onSelfKill());
      }, effectiveOptions.maxRunMs);
      selfKillTimer.unref?.();
    }

    await updateSchedulerRunProgress(run.id, {
      mode,
      stage: 'maintenance',
      processed: 0,
      pending: previousPending.length,
      skipped: 0,
      total: null
    }, leaseToken).catch(() => {});
    const expiredPipelines = await expireStalePipelineRuns();
    const expiredSchedulerRuns = await expireStaleSchedulerRuns({
      beforeRunDateKst: runDateKst,
      excludeRunId: run.id
    });
    const dailyQueueLimits = await enforceDailyQueueLimits();
    const replyRepair = await repairReplyLinkFailures({ dryRun: true, limit: 50 });
    const trendRefresh = process.env.TREND_SOURCE_AUTO_REFRESH === 'false'
      ? { skipped: true, reason: 'TREND_SOURCE_AUTO_REFRESH=false' }
      : await refreshAnonymousTrendPatternAssets().catch((error) => ({
        skipped: true,
        error: error.message,
        code: error.code || null
      }));
    const pipeline = await runPipeline({
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
      }, leaseToken).catch(() => {})
    });
    if (selfKillFired) {
      return { ok: false, duplicate: false, status: 'failed', selfKilled: true, run: await dbGet('scheduler_runs', { id: run.id }) };
    }
    await updateSchedulerRunProgress(run.id, {
      mode,
      stage: pipeline.status === 'partial' ? 'partial' : 'pipeline_completed',
      processed: pipeline.processed?.length || 0,
      pending: pipeline.pending?.length || 0,
      skipped: pipeline.skipped?.length || 0,
      total: pipeline.total || 0
    }, leaseToken).catch(() => {});
    const cleanup = await cleanupUnusedPipelineArtifacts({ mode: 'apply' });
    const oldIssues = await cleanupOldQueueIssues({ mode: 'apply' });
    const oldActivityLogs = await cleanupOldActivityLogs({ mode: 'apply' });
    const summarized = summarizePipelineResults(pipeline);
    const mergedResults = mergeDailyPipelineResultRows(previousSummary.results, summarized.results);
    const aggregate = allowPartialResume
      ? summarizeDailyPipelineRows(mergedResults, {
        pipelineStatus: summarized.pipelineStatus,
        durationMs: (Number(previousSummary.durationMs) || 0) + (Number(summarized.durationMs) || 0)
      })
      : summarized;
    const futureCoverage = await buildFutureQueueCoverage(pipeline, { runDateKst }).catch((error) => ({
      coverageError: error.message || 'future queue coverage check failed',
      activeRunningCount: null,
      missingFutureQueue: [],
      missingFutureQueueCount: null,
      recoverableMissingFutureQueue: [],
      recoverableMissingFutureQueueCount: 0,
      blockedMissingFutureQueue: [],
      blockedMissingFutureQueueCount: 0
    }));
    const pending = mergePendingWithRecoverableMissing(
      summarized.pending,
      futureCoverage.recoverableMissingFutureQueue
    );
    const finishedAt = now().toISOString();
    const summary = {
      ...aggregate,
      pending,
      pendingCount: pending.length,
      futureQueueCoverage: futureCoverage,
      mode,
      options: effectiveOptions,
      expiredPipelines: expiredPipelines.length,
      expiredSchedulerRuns: expiredSchedulerRuns.length,
      dailyQueueLimits,
      replyRepair,
      trendRefresh,
      cleanup,
      oldIssues,
      oldActivityLogs,
      completedAt: finishedAt,
      durationMs: allowPartialResume ? aggregate.durationMs : Date.now() - runStartedAt,
      heartbeatAt: finishedAt,
      // Reset the circuit breaker + transient backoff state on any successful completion.
      circuit: { runDateKst, consecutiveSameError: 0, tripped: false },
      transient: { runDateKst, attempt: 0, nextEligibleRetryAt: null }
    };
    const status = summary.pendingCount > 0 || pipeline.status === 'partial' ? 'partial' : 'completed';
    const storedStatus = status === 'partial' ? 'completed' : status;
    const updated = await finishSchedulerRun(run.id, storedStatus, { summary, error_message: null }, leaseToken);
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
      recoveredFailed,
      resumedPartial,
      status,
      run: updated ? { ...updated, status } : run,
      summary,
      processed: summary.processed,
      pending: summary.pending,
      skipped: summary.skipped,
      durationMs: summary.durationMs
    };
  } catch (error) {
    // Error classification (P3 invariants 6-8): transient failures get jitter exponential
    // backoff and never move the circuit breaker; permanent failures fast-fail and increment it.
    // Five consecutive identical permanent errors trip a critical stop for the rest of the day.
    const classification = classifyPipelineError(error);
    const signature = pipelineErrorSignature(error);
    const { circuit, justTripped } = deriveCircuitBreakerState({
      previousSummary,
      runDateKst,
      classification,
      signature
    });
    const transient = deriveTransientBackoffState({ previousSummary, runDateKst, classification });
    const consecutiveSameError = circuit.consecutiveSameError;
    const breakerTripped = circuit.tripped;

    const summary = {
      failedAt: now().toISOString(),
      message: error.message,
      code: error.code || null,
      mode,
      classification,
      circuit,
      transient,
      failedRecoveryAttempts: previousSummary.failedRecoveryAttempts,
      durationMs: Date.now() - runStartedAt
    };
    const updated = await finishSchedulerRun(run.id, 'failed', {
      summary,
      error_message: error.message || 'daily-pipeline failed'
    }, leaseToken);
    await sendOpsAlert('scheduler_daily_pipeline_failed', {
      title: '새벽 2시 자동 실행 실패',
      code: error.code || 'DAILY_PIPELINE_FAILED',
      message: error.message,
      hint: 'scheduler_runs와 서버 로그를 확인하세요.',
      payload: { runDateKst, triggeredBy, classification }
    }).catch(() => {});
    if (justTripped) {
      await sendOpsAlert('circuit_breaker_stopped', {
        title: '자동 실행 회로 차단기 작동',
        code: 'CIRCUIT_BREAKER_STOPPED',
        severity: 'critical',
        message: `동일한 영구 오류가 ${consecutiveSameError}회 연속 발생하여 오늘 자동 복구를 중단합니다.`,
        hint: 'scheduler_runs.summary.circuit와 서버 로그를 확인하세요.',
        payload: { runDateKst, triggeredBy, consecutiveSameError, errorSignature: signature }
      }).catch(() => {});
    }
    return {
      ok: false,
      duplicate: false,
      recoveredStale,
      recoveredFailed,
      status: 'failed',
      run: updated || run,
      summary,
      error: error.message,
      circuitBreakerTripped: breakerTripped
    };
  } finally {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    if (selfKillTimer) { clearTimeout(selfKillTimer); selfKillTimer = null; }
  }
}

function pendingAccountIdsFromStatus(status = {}) {
  const summary = status.run?.summary || {};
  const pending = Array.isArray(summary.pending) ? summary.pending : [];
  const recoverableMissing = Array.isArray(summary.futureQueueCoverage?.recoverableMissingFutureQueue)
    ? summary.futureQueueCoverage.recoverableMissingFutureQueue
    : [];
  return [...new Set(
    [...pending, ...recoverableMissing]
      .map((row) => row.accountId)
      .filter(Boolean)
  )];
}

export async function runDailyPipelineWatchdog({
  triggeredBy = 'daily_pipeline_watchdog',
  date = now(),
  maxRunMs,
  maxAccounts,
  perAccountMaxMs,
  coupangWaitBudgetMs
} = {}) {
  const status = await dailyPipelineStatus(date);
  const pendingAccountIds = pendingAccountIdsFromStatus(status);
  const shouldRecover = status.missing
    || status.stale
    || ['partial', 'stale', 'missing', 'failed'].includes(status.status);
  if (!shouldRecover) {
    return {
      ok: true,
      skipped: true,
      status: status.status,
      runDateKst: status.runDateKst,
      pendingCount: status.pendingCount || 0,
      message: 'daily-pipeline watchdog skipped; no recoverable gap detected.'
    };
  }
  const result = await runDailyPipelineOnce({
    triggeredBy,
    runDateKst: status.runDateKst,
    mode: status.missing ? 'scheduled' : 'admin_recovery',
    accountIds: pendingAccountIds.length ? pendingAccountIds : undefined,
    forceResume: !status.missing,
    maxRunMs,
    maxAccounts,
    perAccountMaxMs,
    coupangWaitBudgetMs
  });
  return {
    ...result,
    watchdog: {
      recovered: true,
      previousStatus: status.status,
      pendingAccountIds,
      runDateKst: status.runDateKst
    }
  };
}
