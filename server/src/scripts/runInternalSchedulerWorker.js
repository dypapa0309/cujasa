import 'dotenv/config';
import cron from 'node-cron';
import { processCoreDueQueue } from '../services/cujasaCoreService.js';
import { runDueMetricJobs } from '../services/metricsJobService.js';
import { refreshExpiringThreadsTokens } from '../services/threadsOAuthService.js';
import { expireDueEntitlements } from '../services/billingEntitlementService.js';
import { sendOpsAlert } from '../services/notificationService.js';
import { runDailyOpsHealthCheck } from '../services/opsHealthService.js';
import { dailyPipelineStatus, runDailyPipelineOnce } from '../services/schedulerRunService.js';
import { runRepetitionGuard } from '../services/repetitionGuardService.js';
import { loadSystemSettingsIntoEnv } from '../services/systemSettingsService.js';

const runningJobs = new Set();
const enableDailyPipeline = process.env.ENABLE_INTERNAL_DAILY_PIPELINE_CRON === 'true';
const enableRepetitionGuard = process.env.ENABLE_REPETITION_GUARD_CRON !== 'false';
const enableStartupDailyCatchUp = process.env.ENABLE_STARTUP_DAILY_CATCH_UP === 'true';

async function runJob(name, fn) {
  if (runningJobs.has(name)) return null;
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
if (enableDailyPipeline) {
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
}
cron.schedule('0 3 * * *', () => runJob('threads-token-refresh', refreshExpiringThreadsTokens));
cron.schedule('17 * * * *', () => runJob('billing-expire', async () => ({
  expiredCount: (await expireDueEntitlements()).length
})));
cron.schedule('0 8 * * *', () => runJob('daily-ops-healthcheck', runDailyOpsHealthCheck), {
  timezone: 'Asia/Seoul'
});

if (enableRepetitionGuard) {
  cron.schedule('15 * * * *', () => runJob('repetition-guard', () => (
    runRepetitionGuard({ triggeredBy: 'node_worker_repetition_guard' })
  )), { timezone: 'Asia/Seoul' });
}

if (enableStartupDailyCatchUp) {
  setTimeout(() => {
    runJob('daily-pipeline-startup-catch-up', async () => {
      const status = await dailyPipelineStatus();
      if (!status.missing && !['partial', 'stale'].includes(status.status)) return { skipped: true, status: status.status };
      return runDailyPipelineOnce({
        triggeredBy: 'worker_startup_catch_up',
        runDateKst: status.runDateKst,
        mode: status.missing ? 'scheduled' : 'continuation'
      });
    });
  }, 3000);
}

console.log('[Worker] internal scheduler started');
