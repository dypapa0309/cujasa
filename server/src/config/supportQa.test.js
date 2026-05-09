import assert from 'node:assert/strict';
import test from 'node:test';
import { publicSupportConfig } from './supportQa.js';

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

test('support widget does not advertise direct SPREAD signup while the product is gated', () => {
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: undefined }, () => {
    const spreadOptions = publicSupportConfig().nodes.spread.options;
    assert.equal(spreadOptions.length, 1);
    assert.equal(spreadOptions[0].action, 'inquiry');
    assert.equal(spreadOptions[0].topic, 'spread');
  });
});
