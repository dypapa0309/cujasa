import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThrottleWaitMs } from './coupangService.js';

test('resolves throttle wait within the remaining pipeline budget', () => {
  assert.equal(resolveThrottleWaitMs({
    retryAfterMs: 90_000,
    throttleWaitBudgetMs: 600_000,
    startedAt: 1_000,
    now: 1_000
  }), 90_000);
});

test('caps throttle wait by the remaining budget', () => {
  assert.equal(resolveThrottleWaitMs({
    retryAfterMs: 90_000,
    throttleWaitBudgetMs: 120_000,
    startedAt: 1_000,
    now: 61_000
  }), 60_000);
});

test('returns zero when throttle budget is exhausted', () => {
  assert.equal(resolveThrottleWaitMs({
    retryAfterMs: 90_000,
    throttleWaitBudgetMs: 60_000,
    startedAt: 1_000,
    now: 61_001
  }), 0);
});
