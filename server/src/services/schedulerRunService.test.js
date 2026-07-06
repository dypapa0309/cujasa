import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyPipelineError, computeTransientBackoffMs, dailyPipelineStatus, deriveCircuitBreakerState, deriveTransientBackoffState, evaluateDailyQueueSla, expireStaleSchedulerRuns, hasDailyPipelineWindowPassed, kstDateString, runDailyPipelineOnce, runDailyPipelineWatchdog } from './schedulerRunService.js';
import { dbGet, dbInsert } from './supabaseService.js';

test('kstDateString resolves dates in Korea time', () => {
  assert.equal(kstDateString(new Date('2026-05-08T16:59:00.000Z')), '2026-05-09');
  assert.equal(kstDateString(new Date('2026-05-08T14:59:00.000Z')), '2026-05-08');
});

test('hasDailyPipelineWindowPassed uses 02:00 KST as the daily cutoff', () => {
  assert.equal(hasDailyPipelineWindowPassed(new Date('2026-05-08T16:59:00.000Z')), false);
  assert.equal(hasDailyPipelineWindowPassed(new Date('2026-05-08T17:00:00.000Z')), true);
});

test('runDailyPipelineOnce records a daily run once and returns duplicates afterward', async () => {
  const runDateKst = '2099-01-31';
  const first = await runDailyPipelineOnce({ triggeredBy: 'test_first', runDateKst });
  const second = await runDailyPipelineOnce({ triggeredBy: 'test_second', runDateKst });

  assert.equal(first.duplicate, false);
  assert.equal(first.status, 'completed');
  assert.equal(second.duplicate, true);
  assert.equal(second.status, 'completed');
  assert.equal(second.run.run_date_kst, runDateKst);
});

test('dailyPipelineStatus reports missing after 02:00 KST when no run exists', async () => {
  const status = await dailyPipelineStatus(new Date('2099-02-01T17:30:00.000Z'));

  assert.equal(status.runDateKst, '2099-02-02');
  assert.equal(status.windowPassed, true);
  assert.equal(status.missing, true);
  assert.equal(status.status, 'missing');
});

test('dailyPipelineStatus marks old running records as stale', async () => {
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-02-03',
    status: 'running',
    triggered_by: 'test',
    started_at: '2099-02-02T17:00:00.000Z',
    summary: {}
  });

  const status = await dailyPipelineStatus(new Date('2099-02-03T00:30:00.000Z'));

  assert.equal(status.runDateKst, '2099-02-03');
  assert.equal(status.missing, false);
  assert.equal(status.stale, true);
  assert.equal(status.status, 'stale');
});

test('dailyPipelineStatus keeps fresh heartbeat records running', async () => {
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-02-05',
    status: 'running',
    triggered_by: 'test',
    started_at: '2099-02-04T17:00:00.000Z',
    summary: {
      progress: {
        updatedAt: '2099-02-05T00:20:00.000Z',
        stage: 'products',
        currentAccountName: 'heartbeat test',
        processed: 1,
        pending: 0,
        skipped: 0
      }
    }
  });

  const status = await dailyPipelineStatus(new Date('2099-02-05T00:30:00.000Z'));

  assert.equal(status.runDateKst, '2099-02-05');
  assert.equal(status.stale, false);
  assert.equal(status.status, 'running');
  assert.equal(status.heartbeatAt, '2099-02-05T00:20:00.000Z');
  assert.equal(status.progress.currentAccountName, 'heartbeat test');
});

test('runDailyPipelineOnce restarts stale running records for the same KST day', async () => {
  const runDateKst = '2099-02-04';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'running',
    triggered_by: 'test_stale',
    started_at: '2000-01-01T00:00:00.000Z',
    summary: {}
  });

  const result = await runDailyPipelineOnce({ triggeredBy: 'test_recovery', runDateKst });

  assert.equal(result.duplicate, false);
  assert.equal(result.recoveredStale, true);
  assert.equal(result.status, 'completed');
  assert.equal(result.run.run_date_kst, runDateKst);
  assert.equal(result.run.triggered_by, 'test_recovery');
});

test('expireStaleSchedulerRuns closes stale historical running records', async () => {
  const stale = await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-03-06',
    status: 'running',
    triggered_by: 'test_historical_stale',
    started_at: '2099-03-05T17:00:00.000Z',
    summary: {
      progress: {
        updatedAt: '2099-03-05T17:05:00.000Z',
        stage: 'products'
      }
    }
  });
  const currentDay = await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-03-07',
    status: 'running',
    triggered_by: 'test_current_stale',
    started_at: '2099-03-06T17:00:00.000Z',
    summary: {
      progress: {
        updatedAt: '2099-03-06T17:05:00.000Z',
        stage: 'products'
      }
    }
  });

  const expired = await expireStaleSchedulerRuns({
    beforeRunDateKst: '2099-03-07',
    date: new Date('2099-03-07T00:00:00.000Z')
  });
  const staleSaved = await dbGet('scheduler_runs', { id: stale.id });
  const currentSaved = await dbGet('scheduler_runs', { id: currentDay.id });

  assert.equal(expired.some((row) => row.id === stale.id), true);
  assert.equal(staleSaved.status, 'failed');
  assert.equal(staleSaved.summary.code, 'SCHEDULER_RUN_STALE');
  assert.equal(currentSaved.status, 'running');
});

test('runDailyPipelineOnce closes as partial when account budget leaves pending accounts', async () => {
  const project = await dbInsert('projects', {
    name: 'partial scheduler test',
    type: 'coupang',
    status: 'active'
  });
  const first = await dbInsert('accounts', {
    project_id: project.id,
    name: 'partial account one',
    platform: 'threads',
    account_handle: '@partial-one',
    automation_status: 'running',
    status: 'active'
  });
  const second = await dbInsert('accounts', {
    project_id: project.id,
    name: 'partial account two',
    platform: 'threads',
    account_handle: '@partial-two',
    automation_status: 'running',
    status: 'active'
  });

  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_partial',
    runDateKst: '2099-02-06',
    maxAccounts: 1,
    mode: 'scheduled'
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.status, 'partial');
  assert.equal(result.run.status, 'partial');
  assert.equal(result.summary.pendingCount > 0, true);
  assert.equal(result.summary.pending.some((row) => row.accountId === second.id), true);
  assert.equal(result.summary.results.some((row) => row.accountId === first.id), true);
});

test('runDailyPipelineOnce continuation keeps previous daily results in the summary', async () => {
  const project = await dbInsert('projects', {
    name: 'continuation summary test',
    type: 'coupang',
    status: 'active'
  });
  const first = await dbInsert('accounts', {
    project_id: project.id,
    name: 'continuation account one',
    platform: 'threads',
    account_handle: '@continuation-one',
    automation_status: 'running',
    status: 'active'
  });
  const second = await dbInsert('accounts', {
    project_id: project.id,
    name: 'continuation account two',
    platform: 'threads',
    account_handle: '@continuation-two',
    automation_status: 'running',
    status: 'active'
  });
  const runDateKst = '2099-02-08';

  const firstRun = await runDailyPipelineOnce({
    triggeredBy: 'test_continuation_first',
    runDateKst,
    maxAccounts: 1,
    mode: 'scheduled'
  });
  const secondRun = await runDailyPipelineOnce({
    triggeredBy: 'test_continuation_second',
    runDateKst,
    mode: 'continuation'
  });

  assert.equal(firstRun.status, 'partial');
  assert.equal(secondRun.duplicate, false);
  assert.equal(secondRun.summary.results.some((row) => row.accountId === first.id), true);
  assert.equal(secondRun.summary.results.some((row) => row.accountId === second.id), true);
});

test('runDailyPipelineOnce keeps recoverable accounts pending when no future queue exists', async () => {
  const project = await dbInsert('projects', {
    name: 'future queue coverage test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'coverage throttle account',
    platform: 'threads',
    account_handle: '@coverage-throttle',
    automation_status: 'running',
    status: 'active',
    threads_access_token: 'token',
    threads_user_id: 'threads-user',
    threads_token_status: 'valid',
    coupang_access_key: 'access',
    coupang_secret_key: 'secret',
    coupang_partner_id: 'partner',
    coupang_tracking_code: 'tracking'
  });

  await dbInsert('pipeline_runs', {
    account_id: account.id,
    project_id: project.id,
    status: 'running',
    started_at: new Date().toISOString()
  });

  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_future_queue_coverage',
    runDateKst: '2099-02-07',
    mode: 'scheduled'
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.status, 'partial');
  assert.equal(result.run.status, 'partial');
  assert.equal(result.summary.futureQueueCoverage.missingFutureQueueCount > 0, true);
  assert.equal(result.summary.pending.some((row) => row.accountId === account.id), true);
});

test('dailyPipelineStatus enriches legacy completed runs with live future queue coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'legacy coverage status test',
    type: 'coupang',
    status: 'active'
  });
  await dbInsert('accounts', {
    project_id: project.id,
    name: 'legacy coverage account',
    platform: 'threads',
    account_handle: '@legacy-coverage',
    automation_status: 'running',
    status: 'active'
  });
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-02-09',
    status: 'completed',
    triggered_by: 'legacy_test',
    started_at: '2099-02-08T17:00:00.000Z',
    finished_at: '2099-02-08T17:05:00.000Z',
    summary: {
      results: [],
      pendingCount: 0
    }
  });

  const status = await dailyPipelineStatus(new Date('2099-02-09T00:30:00.000Z'));

  assert.equal(status.status, 'partial');
  assert.equal(status.run.summary.futureQueueCoverage.missingFutureQueueCount > 0, true);
  assert.equal(status.run.summary.futureQueueCoverage.recoverableMissingFutureQueueCount > 0, true);
});

test('dailyPipelineStatus treats posted run-date queues as coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'posted coverage status test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'posted coverage account',
    platform: 'threads',
    account_handle: '@posted-coverage',
    automation_status: 'running',
    status: 'active'
  });
  await dbInsert('post_queue', {
    account_id: account.id,
    project_id: project.id,
    status: 'posted',
    posted_at: '2099-02-10T01:00:00.000Z',
    scheduled_at: '2099-02-10T01:00:00.000Z'
  });
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: '2099-02-10',
    status: 'completed',
    triggered_by: 'posted_coverage_test',
    started_at: '2099-02-09T17:00:00.000Z',
    finished_at: '2099-02-09T17:05:00.000Z',
    summary: {
      results: [],
      pendingCount: 0
    }
  });

  const status = await dailyPipelineStatus(new Date('2099-02-10T12:00:00.000Z'));
  const missingIds = status.run.summary.futureQueueCoverage.missingFutureQueue.map((row) => row.accountId);

  assert.equal(missingIds.includes(account.id), false);
});

test('runDailyPipelineWatchdog resumes completed runs with recoverable missing queue coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'watchdog recovery test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'watchdog missing account',
    platform: 'threads',
    account_handle: '@watchdog-missing',
    automation_status: 'running',
    status: 'active'
  });
  const runDateKst = '2099-02-11';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'completed',
    triggered_by: 'watchdog_legacy_test',
    started_at: '2099-02-10T17:00:00.000Z',
    finished_at: '2099-02-10T17:05:00.000Z',
    summary: {
      results: [],
      pendingCount: 0
    }
  });

  const result = await runDailyPipelineWatchdog({
    triggeredBy: 'test_watchdog',
    date: new Date('2099-02-11T00:30:00.000Z')
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.watchdog.recovered, true);
  assert.equal(result.watchdog.pendingAccountIds.includes(account.id), true);
  const saved = await dbGet('scheduler_runs', { job_name: 'daily-pipeline', run_date_kst: runDateKst });
  assert.equal(saved.triggered_by, 'test_watchdog');
  assert.equal(saved.summary.results.some((row) => row.accountId === account.id), true);
});

test('runDailyPipelineWatchdog does not interrupt fresh running records with live pending coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'watchdog fresh running test',
    type: 'coupang',
    status: 'active'
  });
  await dbInsert('accounts', {
    project_id: project.id,
    name: 'watchdog fresh running account',
    platform: 'threads',
    account_handle: '@watchdog-fresh-running',
    automation_status: 'running',
    status: 'active'
  });
  const runDateKst = '2099-02-12';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'running',
    triggered_by: 'watchdog_fresh_test',
    started_at: '2099-02-11T17:00:00.000Z',
    summary: {
      progress: {
        updatedAt: '2099-02-12T00:20:00.000Z',
        stage: 'products'
      }
    }
  });

  const result = await runDailyPipelineWatchdog({
    triggeredBy: 'test_watchdog_should_skip',
    date: new Date('2099-02-12T00:30:00.000Z')
  });

  assert.equal(result.skipped, true);
  assert.equal(result.status, 'running');
  const saved = await dbGet('scheduler_runs', { job_name: 'daily-pipeline', run_date_kst: runDateKst });
  assert.equal(saved.triggered_by, 'watchdog_fresh_test');
});

test('continuation retries a failed daily run instead of treating it as a permanent duplicate', async () => {
  // Reconciliation note (P3): the fixed DAILY_PIPELINE_FAILED_RETRY_LIMIT gate was replaced by an
  // SLA-based gate (stage-07-revision.md P3 "SLA retry"), so this fixture now needs a real
  // breaching active-running account instead of relying on attempt-count alone.
  const runDateKst = '2099-04-01';
  const project = await dbInsert('projects', { name: 'failed retry sla test', type: 'coupang', status: 'active' });
  await dbInsert('accounts', {
    project_id: project.id,
    name: 'failed retry sla account',
    platform: 'threads',
    account_handle: '@failed-retry-sla',
    automation_status: 'running',
    status: 'active'
  });
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'failed',
    triggered_by: 'test_failed_run',
    started_at: '2099-03-31T17:00:00.000Z',
    finished_at: '2099-03-31T17:01:00.000Z',
    error_message: 'transient db timeout',
    summary: { failedAt: '2099-03-31T17:01:00.000Z', code: 'SUPABASE_UNAVAILABLE' }
  });

  // 2099-04-01T00:30:00Z is 09:30 KST, i.e. past the default 09:00-60min=08:00 KST SLA deadline
  // for the seeded account, so it is a genuine breaching account eligible for SLA-based retry.
  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_failed_retry',
    runDateKst,
    mode: 'continuation',
    date: new Date('2099-04-01T00:30:00.000Z')
  });

  assert.equal(result.duplicate, false, 'a failed run must not block same-day retries while SLA is breaching');
  assert.equal(result.recoveredFailed, true);
  assert.equal(result.run.run_date_kst, runDateKst);
  assert.equal(result.run.triggered_by, 'test_failed_retry');
});

test('a failed run before the SLA deadline is not retried even under the hard retry cap', async () => {
  const runDateKst = '2099-04-04';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'failed',
    triggered_by: 'test_failed_no_breach',
    started_at: '2099-04-03T17:00:00.000Z',
    finished_at: '2099-04-03T17:01:00.000Z',
    summary: { failedAt: '2099-04-03T17:01:00.000Z' }
  });

  // 2099-04-03T20:00:00Z is 05:00 KST on 2099-04-04, three hours before the default 08:00 KST SLA
  // deadline, so no active-running account (regardless of which earlier test created it) can be
  // breaching yet — this exercises the "not recoverable" side of the SLA gate deterministically,
  // independent of any other test's leftover fixture accounts.
  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_failed_no_breach_retry',
    runDateKst,
    mode: 'continuation',
    date: new Date('2099-04-03T20:00:00.000Z')
  });

  assert.equal(result.duplicate, true, 'before the SLA deadline there is nothing urgent enough to recover');
  assert.equal(result.status, 'failed');
});

test('a scheduled re-trigger still treats a failed run as duplicate (only continuation/recovery retries)', async () => {
  const runDateKst = '2099-04-02';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'failed',
    triggered_by: 'test_failed_run',
    started_at: '2099-04-01T17:00:00.000Z',
    finished_at: '2099-04-01T17:01:00.000Z',
    summary: { failedAt: '2099-04-01T17:01:00.000Z' }
  });

  const result = await runDailyPipelineOnce({ triggeredBy: 'test_scheduled_retrigger', runDateKst, mode: 'scheduled' });

  assert.equal(result.duplicate, true);
  assert.equal(result.status, 'failed');
});

test('failed retries stop once the daily retry limit is exhausted', async () => {
  const runDateKst = '2099-04-03';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'failed',
    triggered_by: 'test_failed_exhausted',
    started_at: '2099-04-02T17:00:00.000Z',
    finished_at: '2099-04-02T17:01:00.000Z',
    summary: { failedAt: '2099-04-02T17:01:00.000Z', failedRecoveryAttempts: 4 }
  });

  const result = await runDailyPipelineOnce({ triggeredBy: 'test_over_limit', runDateKst, mode: 'continuation' });

  assert.equal(result.duplicate, true, 'exhausted failed runs stop retrying to avoid runaway retries/alerts');
  assert.equal(result.status, 'failed');
});

test('concurrent stale-run takeover: exactly one caller acquires the CAS lease, the loser gets zero rows', async () => {
  // Mandatory P3 test (stage-07-revision.md pre-mortem 2 / D2): the stale branch is
  // running->running, so the CAS MUST be gated on the mutating started_at column, not status.
  const runDateKst = '2099-05-01';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'running',
    triggered_by: 'test_cas_seed',
    started_at: '2000-01-01T00:00:00.000Z',
    summary: {}
  });

  const [first, second] = await Promise.all([
    runDailyPipelineOnce({ triggeredBy: 'test_cas_first', runDateKst }),
    runDailyPipelineOnce({ triggeredBy: 'test_cas_second', runDateKst })
  ]);

  const winners = [first, second].filter((result) => result.recoveredStale === true && result.duplicate === false);
  const losers = [first, second].filter((result) => result.duplicate === true);

  assert.equal(winners.length, 1, 'exactly one concurrent stale-takeover must win the CAS lease');
  assert.equal(losers.length, 1, 'the loser must observe zero affected rows and yield instead of double-executing');
  assert.ok(['test_cas_first', 'test_cas_second'].includes(winners[0].run.triggered_by));
  assert.equal(losers[0].run.triggered_by, winners[0].run.triggered_by, 'the loser must observe the winner\'s row, not stale pre-CAS state');
});

test('self-kill releases the CAS lease and marks the run failed once the max-run deadline fires', async () => {
  const runDateKst = '2099-05-02';

  let selfKillResolve;
  const selfKillCalled = new Promise((resolve) => { selfKillResolve = resolve; });

  // Real timers only: a mock-timers freeze would also freeze the self-kill setTimeout running
  // inside runDailyPipelineOnce (and every timer the real pipeline touches), deadlocking the
  // call. Instead, force the run body to real-time outlast a tiny maxRunMs via the injectable
  // `runPipeline` seam so the self-kill deadline deterministically wins the race.
  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_self_kill',
    runDateKst,
    mode: 'scheduled',
    maxRunMs: 5,
    selfKillEnabled: true,
    onSelfKill: () => selfKillResolve(),
    runPipeline: () => new Promise((resolve) => {
      setTimeout(() => resolve({ status: 'completed', processed: [], pending: [], skipped: [], total: 0 }), 50);
    })
  });

  await selfKillCalled;

  const saved = await dbGet('scheduler_runs', { job_name: 'daily-pipeline', run_date_kst: runDateKst });
  assert.equal(result.selfKilled, true);
  assert.equal(result.status, 'failed');
  assert.equal(saved.status, 'failed', 'self-kill must finish the run as failed, releasing the lease');
  assert.equal(saved.summary.code, 'DAILY_PIPELINE_SELF_KILL');
  assert.equal(saved.error_message, 'daily-pipeline self-kill: exceeded max run time');
});

test('classifyPipelineError separates transient connectivity errors from permanent ones', () => {
  assert.equal(classifyPipelineError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }), 'transient');
  assert.equal(classifyPipelineError({ message: 'request failed with status code 429' }), 'transient');
  assert.equal(classifyPipelineError({ message: 'Retry-After header present' }), 'transient');
  assert.equal(classifyPipelineError({ code: '42703', message: 'column "foo" does not exist' }), 'permanent');
  assert.equal(classifyPipelineError({ message: 'invalid input syntax for type uuid' }), 'permanent');
});

test('circuit breaker trips after 5 consecutive identical permanent errors and resets on success', () => {
  const runDateKst = '2099-05-03';
  let summary = {};
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { circuit, justTripped } = deriveCircuitBreakerState({
      previousSummary: summary,
      runDateKst,
      classification: 'permanent',
      signature: 'SCHEMA_ERROR:column missing'
    });
    assert.equal(circuit.consecutiveSameError, attempt);
    assert.equal(circuit.tripped, false);
    assert.equal(justTripped, false);
    summary = { circuit };
  }

  const fifth = deriveCircuitBreakerState({
    previousSummary: summary,
    runDateKst,
    classification: 'permanent',
    signature: 'SCHEMA_ERROR:column missing'
  });
  assert.equal(fifth.circuit.consecutiveSameError, 5);
  assert.equal(fifth.circuit.tripped, true);
  assert.equal(fifth.justTripped, true, 'the 5th consecutive identical permanent error must trip the breaker exactly once');

  // A transient error occurring while already tripped must not clear the trip, and a different
  // permanent error signature also stays tripped for the rest of the day.
  const stillTrippedAfterTransient = deriveCircuitBreakerState({
    previousSummary: { circuit: fifth.circuit },
    runDateKst,
    classification: 'transient',
    signature: 'ETIMEDOUT:connect ETIMEDOUT'
  });
  assert.equal(stillTrippedAfterTransient.circuit.tripped, true);
  assert.equal(stillTrippedAfterTransient.justTripped, false, 'an already-tripped breaker must not re-alert');

  // Success resets the breaker for the day (mirrors the { consecutiveSameError: 0, tripped: false }
  // reset that runDailyPipelineOnce writes on a completed/partial run).
  const afterSuccessReset = deriveCircuitBreakerState({
    previousSummary: { circuit: { runDateKst, consecutiveSameError: 0, tripped: false } },
    runDateKst,
    classification: 'permanent',
    signature: 'SCHEMA_ERROR:column missing'
  });
  assert.equal(afterSuccessReset.circuit.consecutiveSameError, 1);
  assert.equal(afterSuccessReset.circuit.tripped, false);

  // A new day always starts the counter over even if yesterday tripped.
  const newDay = deriveCircuitBreakerState({
    previousSummary: { circuit: fifth.circuit },
    runDateKst: '2099-05-04',
    classification: 'permanent',
    signature: 'SCHEMA_ERROR:column missing'
  });
  assert.equal(newDay.circuit.consecutiveSameError, 1);
  assert.equal(newDay.circuit.tripped, false);
});

test('a scheduler_runs failed branch already tripped for the day blocks recovery outright', async () => {
  const runDateKst = '2099-05-05';
  await dbInsert('scheduler_runs', {
    job_name: 'daily-pipeline',
    run_date_kst: runDateKst,
    status: 'failed',
    triggered_by: 'test_tripped_seed',
    started_at: '2099-05-04T17:00:00.000Z',
    finished_at: '2099-05-04T17:01:00.000Z',
    summary: {
      failedAt: '2099-05-04T17:01:00.000Z',
      circuit: { runDateKst, consecutiveSameError: 5, tripped: true }
    }
  });

  const result = await runDailyPipelineOnce({
    triggeredBy: 'test_tripped_retry',
    runDateKst,
    mode: 'continuation',
    date: new Date('2099-05-05T12:00:00.000Z')
  });

  assert.equal(result.duplicate, true, 'a breaker already tripped for the day must halt recovery regardless of SLA state');
  assert.equal(result.status, 'failed');
});

test('deriveTransientBackoffState schedules jitter exponential delay and permanent classification clears it', () => {
  const runDateKst = '2099-05-06';
  const first = deriveTransientBackoffState({
    previousSummary: {},
    runDateKst,
    classification: 'transient',
    date: new Date('2099-05-06T00:00:00.000Z')
  });
  assert.equal(first.attempt, 1);
  assert.ok(first.nextEligibleRetryAt);
  assert.ok(new Date(first.nextEligibleRetryAt).getTime() > new Date('2099-05-06T00:00:00.000Z').getTime());

  const second = deriveTransientBackoffState({
    previousSummary: { transient: first },
    runDateKst,
    classification: 'transient',
    date: new Date('2099-05-06T00:00:00.000Z')
  });
  assert.equal(second.attempt, 2);
  assert.ok(
    new Date(second.nextEligibleRetryAt).getTime() - new Date('2099-05-06T00:00:00.000Z').getTime()
      >= new Date(first.nextEligibleRetryAt).getTime() - new Date('2099-05-06T00:00:00.000Z').getTime(),
    'backoff must grow (or at minimum not shrink) with each consecutive transient attempt'
  );

  const clearedByPermanent = deriveTransientBackoffState({
    previousSummary: { transient: second },
    runDateKst,
    classification: 'permanent',
    date: new Date('2099-05-06T00:00:00.000Z')
  });
  assert.equal(clearedByPermanent.attempt, 0);
  assert.equal(clearedByPermanent.nextEligibleRetryAt, null);
});

test('computeTransientBackoffMs is bounded between the base and cap regardless of jitter', () => {
  const zeroJitter = computeTransientBackoffMs(1, () => 0);
  const maxJitter = computeTransientBackoffMs(1, () => 1);
  assert.ok(zeroJitter > 0);
  assert.ok(maxJitter >= zeroJitter);
  const highAttempt = computeTransientBackoffMs(20, () => 0);
  assert.ok(highAttempt <= 10 * 60 * 1000, 'backoff must respect the configured cap even at a high attempt count');
});

test('evaluateDailyQueueSla only reports a breach once the reference time reaches the configured T-60min deadline', async () => {
  const runDateKst = '2099-05-07';
  const project = await dbInsert('projects', { name: 'sla boundary test', type: 'coupang', status: 'active' });
  await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla boundary account',
    platform: 'threads',
    account_handle: '@sla-boundary',
    automation_status: 'running',
    status: 'active',
    active_time_windows: [{ start: '10:00', end: '12:00' }, { start: '07:30', end: '09:00' }]
  });

  // MIN over ALL configured windows (7:30, not 10:00) minus 60min = 06:30 KST deadline.
  const beforeDeadline = await evaluateDailyQueueSla(new Date('2099-05-06T21:00:00.000Z'), { runDateKst });
  const afterDeadline = await evaluateDailyQueueSla(new Date('2099-05-06T21:30:01.000Z'), { runDateKst });

  assert.equal(beforeDeadline.breaching.some((row) => row.accountHandle === '@sla-boundary'), false);
  assert.equal(afterDeadline.breaching.some((row) => row.accountHandle === '@sla-boundary'), true);
});
