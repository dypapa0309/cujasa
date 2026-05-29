import assert from 'node:assert/strict';
import test from 'node:test';
import { createUser, loginUser } from './authService.js';
import { dbGet, dbUpdate } from './supabaseService.js';

function reqFor(userAgent = 'Mozilla/5.0') {
  return {
    headers: {
      'user-agent': userAgent,
      'x-forwarded-for': '127.0.0.1'
    },
    socket: {}
  };
}

test('annual users can register one desktop and one mobile device', async () => {
  const email = `device-limit-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const user = await createUser(email, 'password123', 2, '기기제한');
  await dbUpdate('users', { id: user.id }, {
    plan: 'onetime',
    billing_status: 'active',
    paid_until: '2027-05-29T00:00:00.000Z'
  });

  const desktop = await loginUser(email, 'password123', {
    req: reqFor('Mozilla/5.0 Mac'),
    device: { deviceId: 'desktop-1', deviceType: 'desktop', fingerprintHash: 'desktop-fp' }
  });
  assert.equal(desktop.device.type, 'desktop');

  const mobile = await loginUser(email, 'password123', {
    req: reqFor('Mozilla/5.0 iPhone Mobile'),
    device: { deviceId: 'mobile-1', deviceType: 'mobile', fingerprintHash: 'mobile-fp' }
  });
  assert.equal(mobile.device.type, 'mobile');

  await assert.rejects(
    () => loginUser(email, 'password123', {
      req: reqFor('Mozilla/5.0 Windows'),
      device: { deviceId: 'desktop-2', deviceType: 'desktop', fingerprintHash: 'desktop-fp-2' }
    }),
    /이미 등록된 PC 기기/
  );

  const stored = await dbGet('user_login_devices', { user_id: user.id, device_id: 'desktop-1' });
  assert.equal(stored.status, 'active');
});
