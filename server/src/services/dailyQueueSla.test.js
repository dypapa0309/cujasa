import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDailyQueueSla } from './schedulerRunService.js';
import { dbInsert } from './supabaseService.js';

test('evaluateDailyQueueSla is not breaching before the deadline', async () => {
  const project = await dbInsert('projects', {
    name: 'sla before-deadline test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla before-deadline account',
    platform: 'threads',
    account_handle: '@sla-before',
    automation_status: 'running',
    status: 'active',
    active_time_windows: [{ start: '09:00', end: '11:00' }]
  });

  // 2099-02-11 07:00 KST = 2099-02-10T22:00:00.000Z, well before the 08:00 KST deadline
  const before = new Date('2099-02-10T22:00:00.000Z');
  const result = await evaluateDailyQueueSla(before);

  assert.equal(result.breaching.some((row) => row.accountId === account.id), false);
});

test('evaluateDailyQueueSla breaches once the deadline passes with no queue coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'sla breach test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla breach account',
    platform: 'threads',
    account_handle: '@sla-breach',
    automation_status: 'running',
    status: 'active',
    active_time_windows: [{ start: '09:00', end: '11:00' }]
  });

  // 2099-02-11 08:30 KST = 2099-02-10T23:30:00.000Z, which is >= 09:00 - 60min = 08:00 KST deadline
  const afterDeadline = new Date('2099-02-10T23:30:00.000Z');
  const result = await evaluateDailyQueueSla(afterDeadline);

  const breach = result.breaching.find((row) => row.accountId === account.id);
  assert.ok(breach, 'expected account to be reported as breaching');
  assert.equal(breach.earliestStartMin, 9 * 60);
});

test('evaluateDailyQueueSla is not breaching when the run-date queue already has coverage', async () => {
  const project = await dbInsert('projects', {
    name: 'sla coverage test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla coverage account',
    platform: 'threads',
    account_handle: '@sla-coverage',
    automation_status: 'running',
    status: 'active',
    active_time_windows: [{ start: '09:00', end: '11:00' }]
  });
  await dbInsert('post_queue', {
    account_id: account.id,
    project_id: project.id,
    status: 'scheduled',
    scheduled_at: '2099-02-11T00:00:00.000Z'
  });

  // still 2099-02-11 08:30 KST, past the deadline, but queue coverage exists for the run date
  const afterDeadline = new Date('2099-02-10T23:30:00.000Z');
  const result = await evaluateDailyQueueSla(afterDeadline);

  assert.equal(result.breaching.some((row) => row.accountId === account.id), false);
});

test('evaluateDailyQueueSla uses the MIN start across all active_time_windows, not just the first', async () => {
  const project = await dbInsert('projects', {
    name: 'sla multi-window test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla multi-window account',
    platform: 'threads',
    account_handle: '@sla-multiwindow',
    automation_status: 'running',
    status: 'active',
    active_time_windows: [
      { start: '20:00', end: '23:00' },
      { start: '09:00', end: '11:00' }
    ]
  });

  // 2099-02-11 08:30 KST = 2099-02-10T23:30:00.000Z, past the 08:00 KST deadline (09:00 - 60min)
  // derived from the earlier 09:00 window, not the first-listed 20:00 window.
  const afterDeadline = new Date('2099-02-10T23:30:00.000Z');
  const result = await evaluateDailyQueueSla(afterDeadline);

  const breach = result.breaching.find((row) => row.accountId === account.id);
  assert.ok(breach, 'expected account to be reported as breaching');
  assert.equal(breach.earliestStartMin, 9 * 60);
});

test('evaluateDailyQueueSla excludes paused/inactive accounts', async () => {
  const project = await dbInsert('projects', {
    name: 'sla paused exclusion test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'sla paused account',
    platform: 'threads',
    account_handle: '@sla-paused',
    automation_status: 'paused',
    status: 'active',
    active_time_windows: [{ start: '09:00', end: '11:00' }]
  });

  // well past the 08:00 KST deadline, with no queue coverage
  const afterDeadline = new Date('2099-02-10T23:30:00.000Z');
  const result = await evaluateDailyQueueSla(afterDeadline);

  assert.equal(result.breaching.some((row) => row.accountId === account.id), false);
});
