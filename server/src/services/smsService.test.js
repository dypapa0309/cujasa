import assert from 'node:assert/strict';
import test from 'node:test';
import { sendSetupSms } from './smsService.js';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('sendSetupSms sends to all setup manager phones', async () => {
  const previous = {
    ALIGO_USER_ID: process.env.ALIGO_USER_ID,
    ALIGO_API_KEY: process.env.ALIGO_API_KEY,
    ALIGO_SENDER: process.env.ALIGO_SENDER,
    SETUP_MANAGER_PHONE: process.env.SETUP_MANAGER_PHONE,
    SETUP_MANAGER_PHONES: process.env.SETUP_MANAGER_PHONES
  };
  const previousFetch = globalThis.fetch;
  const receivers = [];
  process.env.ALIGO_USER_ID = 'user';
  process.env.ALIGO_API_KEY = 'key';
  process.env.ALIGO_SENDER = '01000000000';
  process.env.SETUP_MANAGER_PHONE = '01075416143';
  process.env.SETUP_MANAGER_PHONES = '01040941666,01075416143';
  globalThis.fetch = async (url, options) => {
    const body = new URLSearchParams(options.body);
    receivers.push(body.get('receiver'));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result_code: '1', message: 'success' })
    };
  };

  try {
    const result = await sendSetupSms('셋팅 요청 테스트');
    assert.equal(result.ok, true);
    assert.deepEqual(receivers.sort(), ['01040941666', '01075416143']);
    assert.equal(result.recipients.length, 2);
  } finally {
    Object.entries(previous).forEach(([key, value]) => restoreEnv(key, value));
    globalThis.fetch = previousFetch;
  }
});
