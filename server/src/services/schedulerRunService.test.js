import test from 'node:test';
import assert from 'node:assert/strict';

import { dailyPipelineStatus, expireStaleSchedulerRuns, hasDailyPipelineWindowPassed, kstDateString, runDailyPipelineOnce, runDailyPipelineWatchdog } from './schedulerRunService.js';
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
