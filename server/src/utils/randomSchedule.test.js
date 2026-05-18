import assert from 'node:assert/strict';
import test from 'node:test';
import { createDailySchedulePlan } from './randomSchedule.js';

const baseDate = new Date('2026-05-09T00:00:00.000Z');
const earlyNow = new Date('2026-05-08T00:00:00.000Z');

function kstTime(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(iso));
}

test('creates random spread schedule using minimum interval as a floor', () => {
  const plan = createDailySchedulePlan({
    daily_post_max: 5,
    min_interval_minutes: 50,
    active_time_windows: [{ start: '09:00', end: '09:00' }]
  }, baseDate, { now: earlyNow, random: () => 0.5 });

  assert.equal(plan.diagnostics.strategy, 'random_day_spread');
  assert.deepEqual(plan.times.map(kstTime), ['10:24', '13:12', '16:00', '18:48', '21:36']);
  assert.equal(plan.diagnostics.minObservedGapMinutes, 168);
});

test('distributes schedule slots across the configured day window', () => {
  const plan = createDailySchedulePlan({
    daily_post_max: 5,
    min_interval_minutes: 60,
    active_time_windows: [
      { start: '09:00', end: '10:00' },
      { start: '13:00', end: '18:00' }
    ]
  }, baseDate, { now: earlyNow, random: () => 0.5 });

  assert.equal(plan.diagnostics.strategy, 'random_day_spread');
  assert.equal(plan.times.length, 5);
  assert.equal(plan.diagnostics.tooCloseSlots.length, 0);
  assert.ok(plan.times.map(kstTime).every((time) => (time >= '09:00' && time <= '09:59') || (time >= '13:00' && time <= '17:59')));
});

test('avoids existing same-day queue times by at least the minimum interval', () => {
  const plan = createDailySchedulePlan({
    daily_post_max: 2,
    min_interval_minutes: 50,
    active_time_windows: [{ start: '09:00', end: '12:00' }]
  }, baseDate, {
    now: earlyNow,
    random: () => 0,
    blockedTimes: ['2026-05-09T00:20:00.000Z']
  });

  assert.equal(plan.times.length, 2);
  assert.equal(plan.diagnostics.tooCloseSlots.length, 0);
  assert.ok(plan.diagnostics.minObservedGapMinutes >= 50);
});

test('reports schedule capacity shortage for narrow windows', () => {
  const plan = createDailySchedulePlan({
    daily_post_max: 5,
    min_interval_minutes: 20,
    active_time_windows: [{ start: '09:00', end: '09:30' }]
  }, baseDate, { now: earlyNow, jitterMinutes: 0 });

  assert.equal(plan.times.length, 2);
  assert.equal(plan.diagnostics.reasonCode, 'SCHEDULE_CAPACITY_SHORTAGE');
  assert.equal(plan.diagnostics.shortage, 3);
});
