import { dbGet, dbList, dbUpdate, logActivity } from './supabaseService.js';

const DEFAULT_FREE_LIMIT = 3;

function isFreePlan(user) {
  return (user?.plan || 'free') === 'free';
}

function isPaidPlan(user) {
  return ['onetime', 'monthly'].includes(user?.plan);
}

function blockedError(status) {
  const error = new Error('무료 체험 포스팅 3회를 모두 사용했습니다.');
  error.status = 403;
  error.code = 'FREE_TRIAL_LIMIT_REACHED';
  error.limit = status.limit;
  error.used = status.used;
  error.remaining = status.remaining;
  error.upgradeRequired = true;
  return error;
}

export function mapTrialStatus(user, { role = 'user' } = {}) {
  if (role === 'admin') {
    return {
      plan: 'admin',
      limit: null,
      used: null,
      remaining: null,
      blocked: false,
      paidUntil: null
    };
  }
  if (isPaidPlan(user)) {
    return {
      plan: 'paid',
      paidPlan: user.plan,
      limit: null,
      used: null,
      remaining: null,
      blocked: false,
      paidUntil: user.paid_until || null
    };
  }
  const limit = Number(user?.free_post_limit ?? DEFAULT_FREE_LIMIT);
  const used = Number(user?.free_post_used ?? 0);
  return {
    plan: 'free',
    limit,
    used,
    remaining: Math.max(0, limit - used),
    blocked: used >= limit,
    paidUntil: null
  };
}

export async function getTrialStatusForUser(userId, options = {}) {
  if (options.role === 'admin') return mapTrialStatus(null, { role: 'admin' });
  const user = await dbGet('users', { id: userId });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  return mapTrialStatus(user);
}

export async function assertUserCanStartTrialAction(userId) {
  const user = await dbGet('users', { id: userId });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  const status = mapTrialStatus(user);
  if (status.plan === 'free' && status.blocked) throw blockedError(status);
  return status;
}

export async function ownerForAccount(accountId) {
  const owners = await dbList('user_accounts', { account_id: accountId }, { limit: 1 });
  return owners[0] || null;
}

export async function assertAccountCanUpload(accountId) {
  const owner = await ownerForAccount(accountId);
  if (!owner) return null;
  return assertUserCanStartTrialAction(owner.user_id);
}

export async function getTrialStatusForAccount(accountId) {
  const owner = await ownerForAccount(accountId);
  if (!owner) return null;
  return getTrialStatusForUser(owner.user_id);
}

async function pauseFreeTrialUserAutomation(userId, sourceAccountId, status) {
  const assignments = await dbList('user_accounts', { user_id: userId });
  const accountIds = assignments.map((row) => row.account_id).filter(Boolean);
  const now = new Date().toISOString();
  for (const accountId of accountIds) {
    await dbUpdate('accounts', { id: accountId }, {
      automation_status: 'paused',
      automation_stopped_at: now
    }).catch(() => []);
    const queueRows = await dbList('post_queue', { account_id: accountId }).catch(() => []);
    for (const row of queueRows.filter((item) => ['scheduled', 'retry'].includes(item.status))) {
      await dbUpdate('post_queue', { id: row.id }, {
        status: 'skipped',
        error_message: '무료 체험 포스팅 3회 완료로 자동화가 중지되었습니다.'
      }).catch(() => []);
    }
  }
  await logActivity({
    account_id: sourceAccountId,
    user_id: userId,
    action: 'free_trial_limit_reached_automation_paused',
    level: 'info',
    message: '무료 체험 3회 업로드 완료로 자동화를 중지했습니다.',
    payload: { limit: status.limit, used: status.used, accountIds }
  }).catch(() => null);
}

export async function recordSuccessfulUpload(accountId) {
  const owner = await ownerForAccount(accountId);
  if (!owner) return null;
  const user = await dbGet('users', { id: owner.user_id });
  if (!isFreePlan(user)) return mapTrialStatus(user);

  // TODO: 체험 남용 방지 확장 지점. 같은 connected_threads_username/coupang_partner_id
  // 조합의 반복 가입을 추적하려면 여기에서 별도 audit 테이블에 기록한다.
  const limit = Number(user.free_post_limit ?? DEFAULT_FREE_LIMIT);
  const nextUsed = Number(user.free_post_used ?? 0) + 1;
  const patch = {
    free_post_used: nextUsed,
    ...(nextUsed >= limit ? { trial_blocked_at: new Date().toISOString() } : {})
  };
  const [updated] = await dbUpdate('users', { id: user.id }, patch);
  const status = mapTrialStatus(updated || { ...user, ...patch });
  if (nextUsed >= limit && Number(user.free_post_used ?? 0) < limit) {
    await pauseFreeTrialUserAutomation(owner.user_id, accountId, status);
  }
  return status;
}
