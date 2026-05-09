import assert from 'node:assert/strict';
import test from 'node:test';
import {
  productMaintenancePayload,
  productServiceClosedInProduction,
  throwIfProductServiceClosed
} from './productAvailability.js';

function withEnv(patch, callback) {
  const previous = {};
  Object.keys(patch).forEach((key) => {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  });
  try {
    callback();
  } finally {
    Object.keys(patch).forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('closes gated products in production until the beta flag is enabled', () => {
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: undefined, INFLUDEX_SERVICE_OPEN: undefined }, () => {
    assert.equal(productServiceClosedInProduction('spread'), true);
    assert.equal(productServiceClosedInProduction('infludex'), true);
    assert.equal(productServiceClosedInProduction('dexor'), false);
    assert.deepEqual(productMaintenancePayload('infludex'), {
      error: 'INFLUDEX_SERVICE_MAINTENANCE',
      message: 'INFLUDEX는 현재 서비스 점검 중입니다.'
    });
    assert.throws(
      () => throwIfProductServiceClosed('spread'),
      (error) => error.status === 503 && error.code === 'SPREAD_SERVICE_MAINTENANCE'
    );
  });
});

test('opens gated products outside production or with explicit production flag', () => {
  withEnv({ NODE_ENV: 'development', SPREAD_SERVICE_OPEN: undefined }, () => {
    assert.equal(productServiceClosedInProduction('spread'), false);
  });
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: 'true' }, () => {
    assert.equal(productServiceClosedInProduction('spread'), false);
  });
});
