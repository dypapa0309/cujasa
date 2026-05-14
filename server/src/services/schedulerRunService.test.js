import test from 'node:test';
import assert from 'node:assert/strict';

import { dailyPipelineStatus, hasDailyPipelineWindowPassed, kstDateString, runDailyPipelineOnce } from './schedulerRunService.js';
import { dbInsert } from './supabaseService.js';

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
