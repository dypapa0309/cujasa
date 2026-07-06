import 'dotenv/config';
import cron from 'node-cron';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processCoreDueQueue } from '../services/cujasaCoreService.js';
import { runDueMetricJobs } from '../services/metricsJobService.js';
import { refreshExpiringThreadsTokens } from '../services/threadsOAuthService.js';
import { expireDueEntitlements } from '../services/billingEntitlementService.js';
import { sendOpsAlert } from '../services/notificationService.js';
import { runDailyOpsHealthCheck } from '../services/opsHealthService.js';
import { dailyPipelineStatus, evaluateDailyQueueSla, expireStaleSchedulerRuns, runDailyPipelineOnce, runDailyPipelineWatchdog } from '../services/schedulerRunService.js';
import { loadSystemSettingsIntoEnv } from '../services/systemSettingsService.js';

const runningJobs = new Set();
const enableDailyPipelineCron = process.env.ENABLE_INTERNAL_DAILY_PIPELINE_CRON === 'true';
const enableStartupDailyCatchUp = process.env.ENABLE_STARTUP_DAILY_CATCH_UP === 'true';

const DAILY_QUEUE_SLA_THROTTLE_MS = 5 * 60 * 1000;
let lastDailyQueueSlaCheckAt = 0;
let alertedDailyQueueSla = new Map();

async function checkDailyQueueSlaBreaches() {
  const now = Date.now();
  if (now - lastDailyQueueSlaCheckAt < DAILY_QUEUE_SLA_THROTTLE_MS) return null;
  lastDailyQueueSlaCheckAt = now;

  const sla = await evaluateDailyQueueSla();
  for (const key of [...alertedDailyQueueSla.keys()]) {
    if (!key.startsWith(`${sla.runDateKst}:`)) alertedDailyQueueSla.delete(key);
  }

  for (const breach of sla.breaching) {
    const key = `${sla.runDateKst}:${breach.accountId}`;
    if (alertedDailyQueueSla.has(key)) continue;
    // Only mark this key alerted once sendOpsAlert confirms delivery (status 'sent').
    // If it throws or resolves with status 'failed'/null, the key stays unset so the
    // next ~5-min cycle retries instead of permanently suppressing the CRITICAL alert.
    let delivered = false;
    try {
      const result = await sendOpsAlert('daily_queue_sla_breach', {
        title: '당일 큐 SLA 임박 미완료',
        code: 'DEAD_MANS_SWITCH_SLA_BREACH',
        account: { name: breach.accountName, account_handle: breach.accountHandle },
        message: `${breach.accountName} 계정의 당일 큐가 첫 포스팅 예약 시각 60분 전까지 채워지지 않았습니다.`,
        payload: {
          severity: 'critical',
          accountId: breach.accountId,
          runDateKst: sla.runDateKst,
          deadlineIso: breach.deadlineIso
        }
      });
      delivered = result?.status === 'sent';
    } catch {
      delivered = false;
    }
    if (delivered) alertedDailyQueueSla.set(key, true);
  }

  return sla;
}

// P3 daytime recovery (D3): cheap in-process detection on the always-on per-minute worker,
// throttled to 5min and gated OUTSIDE the 02:30-06:30 KST continuation window (so it never races
// the dedicated cron/continuation crons over the same CAS lease). On a recoverable gap it forks a
// single ISOLATED kill-tolerant child running runDailyPipelineTask.js (mode=admin_recovery) — the
// fork/self-kill happens in that child process, never in this worker's event loop.
const DAYTIME_RECOVERY_THROTTLE_MS = 5 * 60 * 1000;
const CONTINUATION_WINDOW_START_MIN_KST = 2 * 60 + 30;
const CONTINUATION_WINDOW_END_MIN_KST = 6 * 60 + 30;
let lastDaytimeRecoveryCheckAt = 0;
let daytimeRecoveryChildRunning = false;

function isWithinContinuationWindowKst(date = new Date()) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const minuteOfDay = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  return minuteOfDay >= CONTINUATION_WINDOW_START_MIN_KST && minuteOfDay < CONTINUATION_WINDOW_END_MIN_KST;
}

async function checkDaytimeDailyPipelineRecovery() {
  const nowMs = Date.now();
  if (nowMs - lastDaytimeRecoveryCheckAt < DAYTIME_RECOVERY_THROTTLE_MS) return null;
  lastDaytimeRecoveryCheckAt = nowMs;

  if (isWithinContinuationWindowKst()) return { skipped: true, reason: 'within_continuation_window' };
  if (daytimeRecoveryChildRunning) return { skipped: true, reason: 'child_already_running' };

  const status = await dailyPipelineStatus();
  const recoverable = status.missing || ['partial', 'stale'].includes(status.status);
  if (!recoverable) return { skipped: true, status: status.status };

  daytimeRecoveryChildRunning = true;
  const taskScriptPath = fileURLToPath(new URL('./runDailyPipelineTask.js', import.meta.url));
  let child;
  try {
    child = fork(taskScriptPath, [], {
      env: { ...process.env, SCHEDULER_MODE: 'admin_recovery', SCHEDULER_TRIGGERED_BY: 'worker_daytime_recovery' }
    });
  } catch (error) {
    daytimeRecoveryChildRunning = false;
    throw error;
  }
  child.unref();
  child.once('exit', () => { daytimeRecoveryChildRunning = false; });
  child.once('error', () => { daytimeRecoveryChildRunning = false; });
  return { forked: true, status: status.status, runDateKst: status.runDateKst };
}

async function runJob(name, fn) {
  if (runningJobs.has(name)) {
    console.warn(`[Worker:${name}] skipped because previous run is still active`);
    return null;
  }
  runningJobs.add(name);
  const startedAt = Date.now();
  try {
    const result = await fn();
    console.log(`[Worker:${name}] completed`, JSON.stringify({ durationMs: Date.now() - startedAt, result }));
    return result;
  } catch (error) {
    console.error(`[Worker:${name}] failed`, error);
    await sendOpsAlert('cron_failed', {
      title: 'worker 작업 실패',
      code: 'WORKER_JOB_FAILED',
      message: `${name}: ${error.message}`,
      hint: 'worker 로그와 외부 API 상태를 확인하세요.',
      payload: { jobName: name }
    }).catch(() => null);
    return null;
  } finally {
    runningJobs.delete(name);
  }
}

await loadSystemSettingsIntoEnv().catch((error) => {
  console.warn('[worker system settings] failed to load', error?.message || error);
});

cron.schedule('* * * * *', () => runJob('queue-and-metrics', async () => ({
  processedQueue: await processCoreDueQueue(),
  metricJobs: await runDueMetricJobs()
})));
cron.schedule('* * * * *', () => runJob('daily-queue-sla', checkDailyQueueSlaBreaches));
cron.schedule('* * * * *', () => runJob('daily-pipeline-daytime-recovery', checkDaytimeDailyPipelineRecovery));

if (enableDailyPipelineCron) {
  cron.schedule('0 2 * * *', () => runJob('daily-pipeline', () => runDailyPipelineOnce({
    triggeredBy: 'node_worker',
    mode: 'scheduled'
  })), { timezone: 'Asia/Seoul' });

  cron.schedule('30 2-5 * * *', () => runJob('daily-pipeline-continuation', async () => {
    const status = await dailyPipelineStatus();
    if (!['partial', 'stale'].includes(status.status)) return { skipped: true, status: status.status };
    return runDailyPipelineOnce({
      triggeredBy: 'node_worker_continuation',
      mode: 'continuation',
      runDateKst: status.runDateKst
    });
  }), { timezone: 'Asia/Seoul' });

  cron.schedule('0,30 6-23 * * *', () => runJob('daily-pipeline-watchdog', async () => {
    const status = await dailyPipelineStatus();
    const expiredSchedulerRuns = await expireStaleSchedulerRuns({ beforeRunDateKst: status.runDateKst });
    const result = await runDailyPipelineWatchdog({ triggeredBy: 'node_worker_watchdog' });
    return { ...result, expiredSchedulerRuns: expiredSchedulerRuns.length };
  }), { timezone: 'Asia/Seoul' });
}

cron.schedule('0 3 * * *', () => runJob('threads-token-refresh', refreshExpiringThreadsTokens));
cron.schedule('17 * * * *', () => runJob('billing-expire', async () => ({
  expiredCount: (await expireDueEntitlements()).length
})));
cron.schedule('0 8 * * *', () => runJob('daily-ops-healthcheck', runDailyOpsHealthCheck), {
  timezone: 'Asia/Seoul'
});

if (enableStartupDailyCatchUp) {
  setTimeout(() => {
    runJob('daily-pipeline-startup-catch-up', async () => {
      const status = await dailyPipelineStatus();
      const expiredSchedulerRuns = await expireStaleSchedulerRuns({ beforeRunDateKst: status.runDateKst });
      if (!status.missing && !['partial', 'stale'].includes(status.status)) {
        return { skipped: true, status: status.status, expiredSchedulerRuns: expiredSchedulerRuns.length };
      }
      const result = await runDailyPipelineWatchdog({ triggeredBy: 'worker_startup_catch_up' });
      return { ...result, expiredSchedulerRuns: expiredSchedulerRuns.length };
    });
  }, 3000);
}

console.log('[Worker] internal scheduler started');
