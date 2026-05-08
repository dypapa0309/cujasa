import assert from 'node:assert/strict';
import test from 'node:test';
import { getProductRepairDefaults } from './productRepairService.js';

test('uses medium-strength product repair defaults', () => {
  assert.deepEqual(getProductRepairDefaults(), {
    attemptLimit: 1,
    keywordsPerAttempt: 2
  });
});
