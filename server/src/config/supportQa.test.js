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

test('support widget advertises direct SPREAD signup now that the product is open', () => {
  withEnv({ NODE_ENV: 'production', SPREAD_SERVICE_OPEN: undefined }, () => {
    const spreadOptions = publicSupportConfig().nodes.spread.options;
    assert.equal(spreadOptions.some((option) => option.action === 'link' && /product=spread/.test(option.href || '')), true);
  });
});
