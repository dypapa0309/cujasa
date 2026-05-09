import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { dbGet, dbInsert } from './supabaseService.js';
import { requestSetupTaskForUser } from './setupTaskService.js';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('requestSetupTaskForUser records email, sms, and slack delivery results', async () => {
  const previous = {
    SETUP_MANAGER_EMAILS: process.env.SETUP_MANAGER_EMAILS,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ALIGO_USER_ID: process.env.ALIGO_USER_ID,
    ALIGO_API_KEY: process.env.ALIGO_API_KEY,
    ALIGO_SENDER: process.env.ALIGO_SENDER,
    SETUP_MANAGER_PHONES: process.env.SETUP_MANAGER_PHONES,
    SETUP_MANAGER_PHONE: process.env.SETUP_MANAGER_PHONE,
    SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL
  };
  const previousFetch = globalThis.fetch;
  process.env.SETUP_MANAGER_EMAILS = 'ops@example.com';
  delete process.env.RESEND_API_KEY;
  delete process.env.ALIGO_USER_ID;
  delete process.env.ALIGO_API_KEY;
  delete process.env.ALIGO_SENDER;
  process.env.SETUP_MANAGER_PHONES = '01040941666,01075416143';
  delete process.env.SETUP_MANAGER_PHONE;
  delete process.env.SLACK_WEBHOOK_URL;
  globalThis.fetch = async () => {
    throw new Error('network should not be called without provider config');
  };

  try {
    const user = await dbInsert('users', {
      email: `setup-${randomUUID()}@example.com`,
      username: `setup-${randomUUID()}`,
      buyer_name: '셋업 고객',
      phone: '01012345678',
      password_hash: 'hash',
      role: 'customer',
      status: 'active',
      max_accounts: 2
    });
    const result = await requestSetupTaskForUser(user.id, { message: '도움 필요' });
    const task = await dbGet('setup_tasks', { id: result.task.id });

    assert.equal(result.alreadyExists, false);
    assert.equal(task.source, 'customer_request');
    assert.ok(result.notification.email);
    assert.ok(result.notification.sms);
    assert.ok(result.notification.slack);
    assert.equal(result.notification.email.configured, true);
    assert.equal(result.notification.email.recipients[0].email, 'ops@example.com');
    assert.equal(result.notification.sms.skipped, true);
    assert.equal(result.notification.sms.recipients.length, 2);
  } finally {
    Object.entries(previous).forEach(([key, value]) => restoreEnv(key, value));
    globalThis.fetch = previousFetch;
  }
});
