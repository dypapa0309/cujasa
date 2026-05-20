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

test('leaves launched products open in production by default', () => {
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: undefined, INFLUDEX_SERVICE_OPEN: undefined }, () => {
    assert.equal(productServiceClosedInProduction('spread'), false);
    assert.equal(productServiceClosedInProduction('infludex'), false);
    assert.equal(productServiceClosedInProduction('dexor'), false);
    assert.deepEqual(productMaintenancePayload('infludex'), {
      error: 'INFLUDEX_SERVICE_MAINTENANCE',
      message: 'INFLUDEX는 현재 서비스 점검 중입니다.'
    });
    assert.doesNotThrow(() => throwIfProductServiceClosed('spread'));
  });
});

test('opens products outside production and can explicitly close INFLUDEX in production', () => {
  withEnv({ NODE_ENV: 'development', SPREAD_SERVICE_OPEN: undefined }, () => {
    assert.equal(productServiceClosedInProduction('spread'), false);
  });
  withEnv({ NODE_ENV: 'production', INFLUDEX_SERVICE_OPEN: 'false' }, () => {
    assert.equal(productServiceClosedInProduction('infludex'), true);
    assert.throws(() => throwIfProductServiceClosed('infludex'), /INFLUDEX/);
  });
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: 'true' }, () => {
    assert.equal(productServiceClosedInProduction('spread'), false);
  });
});
