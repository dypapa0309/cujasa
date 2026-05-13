import assert from 'node:assert/strict';
import test from 'node:test';
import { isAdminLoginCandidate } from './authService.js';

function withEnv(patch, fn) {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  Object.entries(patch).forEach(([key, value]) => {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  });
  try {
    fn();
  } finally {
    Object.entries(previous).forEach(([key, value]) => {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

test('isAdminLoginCandidate matches primary and extra admin logins without DB lookup', () => {
  withEnv({
    ADMIN_EMAIL: 'owner@example.com',
    ADMIN_PASSWORD_HASH: 'hash',
    ADMIN_EXTRA_CREDENTIALS: 'ops@example.com:hash2, second@example.com:hash3',
    JWT_SECRET: 'secret'
  }, () => {
    assert.equal(isAdminLoginCandidate('OWNER@example.com'), true);
    assert.equal(isAdminLoginCandidate(' ops@example.com '), true);
    assert.equal(isAdminLoginCandidate('customer@example.com'), false);
  });
});

test('isAdminLoginCandidate stays closed when admin auth is not configured', () => {
  withEnv({
    ADMIN_EMAIL: 'owner@example.com',
    ADMIN_PASSWORD_HASH: null,
    ADMIN_EXTRA_CREDENTIALS: 'ops@example.com:hash2',
    JWT_SECRET: 'secret'
  }, () => {
    assert.equal(isAdminLoginCandidate('owner@example.com'), false);
    assert.equal(isAdminLoginCandidate('ops@example.com'), false);
  });
});
