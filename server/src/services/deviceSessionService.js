import crypto from 'node:crypto';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

const DEVICE_LIMITS = { desktop: 1, mobile: 1 };

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeDeviceType(value = '') {
  return value === 'mobile' ? 'mobile' : 'desktop';
}

function normalizeDeviceContext(input = {}, req = null) {
  const headers = req?.headers || {};
  const rawDeviceId = input.deviceId || input.device_id || headers['x-cujasa-device-id'];
  const rawType = input.deviceType || input.device_type || headers['x-cujasa-device-type'];
  const rawFingerprint = input.fingerprintHash || input.fingerprint_hash || headers['x-cujasa-device-fingerprint'];
  const userAgent = String(headers['user-agent'] || '');
  const deviceId = String(rawDeviceId || '').trim();
  return {
    deviceId,
    deviceType: normalizeDeviceType(String(rawType || 'desktop').trim()),
    fingerprintHash: sha256(rawFingerprint || userAgent || deviceId),
    label: String(input.label || '').trim().slice(0, 80),
    userAgent: userAgent.slice(0, 500),
    ip: String(headers['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 80)
  };
}

function shouldLimitDevices(user = {}) {
  if (user.plan !== 'onetime') return false;
  if (user.billing_status && !['active', 'paid'].includes(user.billing_status)) return false;
  if (user.paid_until && new Date(user.paid_until).getTime() < Date.now()) return false;
  return true;
}

export async function authorizeLoginDevice({ user, device, req }) {
  if (!shouldLimitDevices(user)) return null;
  const context = normalizeDeviceContext(device, req);
  if (!context.deviceId) {
    const error = new Error('기기 확인 정보가 없습니다. 브라우저를 새로고침한 뒤 다시 로그인해주세요.');
    error.status = 403;
    error.code = 'DEVICE_REQUIRED';
    throw error;
  }
  const existing = await dbGet('user_login_devices', {
    user_id: user.id,
    device_id: context.deviceId
  });
  const now = new Date().toISOString();
  if (existing) {
    if (existing.status !== 'active') {
      if (existing.status === 'revoked') {
        const rows = await dbList('user_login_devices', {
          user_id: user.id,
          device_type: context.deviceType,
          status: 'active'
        });
        const limit = DEVICE_LIMITS[context.deviceType] || 1;
        if (rows.length >= limit) {
          const error = new Error(context.deviceType === 'mobile'
            ? '이미 등록된 모바일 기기가 있습니다. 다른 휴대폰에서 사용하려면 기기 초기화가 필요합니다.'
            : '이미 등록된 PC 기기가 있습니다. 다른 PC에서 사용하려면 기기 초기화가 필요합니다.');
          error.status = 403;
          error.code = 'DEVICE_LIMIT_REACHED';
          error.deviceType = context.deviceType;
          throw error;
        }
        const [reactivated] = await dbUpdate('user_login_devices', { id: existing.id }, {
          status: 'active',
          fingerprint_hash: context.fingerprintHash,
          label: context.label || existing.label || (context.deviceType === 'mobile' ? 'Mobile browser' : 'Desktop browser'),
          user_agent: context.userAgent,
          last_seen_at: now,
          last_ip: context.ip
        });
        return reactivated || { ...existing, status: 'active', fingerprint_hash: context.fingerprintHash };
      }
      const error = new Error('이 기기는 사용이 제한되어 있습니다. 관리자에게 기기 초기화를 요청해주세요.');
      error.status = 403;
      error.code = 'DEVICE_BLOCKED';
      throw error;
    }
    if (existing.fingerprint_hash && existing.fingerprint_hash !== context.fingerprintHash) {
      const error = new Error('등록된 기기 정보와 현재 브라우저 정보가 다릅니다. 관리자에게 기기 초기화를 요청해주세요.');
      error.status = 403;
      error.code = 'DEVICE_FINGERPRINT_MISMATCH';
      throw error;
    }
    const [updated] = await dbUpdate('user_login_devices', { id: existing.id }, {
      last_seen_at: now,
      last_ip: context.ip,
      user_agent: context.userAgent
    });
    return updated || existing;
  }

  const rows = await dbList('user_login_devices', {
    user_id: user.id,
    device_type: context.deviceType,
    status: 'active'
  });
  const limit = DEVICE_LIMITS[context.deviceType] || 1;
  if (rows.length >= limit) {
    const error = new Error(context.deviceType === 'mobile'
      ? '이미 등록된 모바일 기기가 있습니다. 다른 휴대폰에서 사용하려면 기기 초기화가 필요합니다.'
      : '이미 등록된 PC 기기가 있습니다. 다른 PC에서 사용하려면 기기 초기화가 필요합니다.');
    error.status = 403;
    error.code = 'DEVICE_LIMIT_REACHED';
    error.deviceType = context.deviceType;
    throw error;
  }

  return dbInsert('user_login_devices', {
    user_id: user.id,
    device_id: context.deviceId,
    device_type: context.deviceType,
    fingerprint_hash: context.fingerprintHash,
    label: context.label || (context.deviceType === 'mobile' ? 'Mobile browser' : 'Desktop browser'),
    user_agent: context.userAgent,
    first_ip: context.ip,
    last_ip: context.ip,
    status: 'active',
    first_seen_at: now,
    last_seen_at: now
  });
}

export async function assertActiveRequestDevice({ user, tokenPayload = {}, req }) {
  if (!shouldLimitDevices(user)) return null;
  const context = normalizeDeviceContext({}, req);
  const tokenDeviceId = String(tokenPayload.deviceId || '').trim();
  if (!tokenDeviceId || !context.deviceId || tokenDeviceId !== context.deviceId) {
    const error = new Error('등록된 기기에서만 이용할 수 있습니다. 다시 로그인해주세요.');
    error.status = 401;
    error.code = 'DEVICE_SESSION_INVALID';
    throw error;
  }
  const device = await dbGet('user_login_devices', {
    user_id: user.id,
    device_id: tokenDeviceId
  });
  if (!device || device.status !== 'active') {
    const error = new Error('이 기기 세션은 더 이상 활성 상태가 아닙니다. 다시 로그인해주세요.');
    error.status = 401;
    error.code = 'DEVICE_SESSION_REVOKED';
    throw error;
  }
  if (device.fingerprint_hash && device.fingerprint_hash !== context.fingerprintHash) {
    const error = new Error('기기 정보가 변경되어 세션을 유지할 수 없습니다. 다시 로그인해주세요.');
    error.status = 401;
    error.code = 'DEVICE_FINGERPRINT_MISMATCH';
    throw error;
  }
  await dbUpdate('user_login_devices', { id: device.id }, {
    last_seen_at: new Date().toISOString(),
    last_ip: context.ip,
    user_agent: context.userAgent
  });
  return device;
}
