import { dbUpdate } from './supabaseService.js';

export const AUTOMATION_RUNNING = 'running';
export const AUTOMATION_PAUSED = 'paused';

export function normalizeAutomationStatus(status) {
  return status === AUTOMATION_RUNNING ? AUTOMATION_RUNNING : AUTOMATION_PAUSED;
}

export function getAutomationStatus(account) {
  return normalizeAutomationStatus(account?.automation_status || AUTOMATION_RUNNING);
}

export function isAutomationRunning(account) {
  return account?.status === 'active' && getAutomationStatus(account) === AUTOMATION_RUNNING;
}

export function assertAutomationRunning(account, action = 'run automation') {
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (account.status !== 'active') {
    const error = new Error(`Account is ${account.status}; cannot ${action}`);
    error.status = 409;
    error.code = 'ACCOUNT_NOT_ACTIVE';
    throw error;
  }
  if (!isAutomationRunning(account)) {
    const error = new Error('자동화가 중지되어 있습니다. 자동화 실행을 켠 뒤 다시 시도해주세요.');
    error.status = 409;
    error.code = 'AUTOMATION_PAUSED';
    throw error;
  }
}

export async function setAutomationStatus(accountId, status) {
  const nextStatus = normalizeAutomationStatus(status);
  const now = new Date().toISOString();
  const patch = nextStatus === AUTOMATION_RUNNING
    ? {
        automation_status: AUTOMATION_RUNNING,
        automation_started_at: now,
        automation_stopped_at: null
      }
    : {
        automation_status: AUTOMATION_PAUSED,
        automation_stopped_at: now
      };
  const [updated] = await dbUpdate('accounts', { id: accountId }, patch);
  return updated;
}
