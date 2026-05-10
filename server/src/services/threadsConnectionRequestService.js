import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { sendSetupSms } from './smsService.js';
import { sendSlackMessage } from './slackService.js';

const STATUSES = new Set(['requested', 'meta_registered', 'customer_action_required', 'connected', 'canceled']);

function normalizeHandle(value = '') {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function displayHandle(value = '') {
  const handle = normalizeHandle(value);
  return handle ? `@${handle}` : '';
}

async function notifyThreadsRequest(row, { user, account } = {}) {
  const text = [
    '[CUJASA Threads 연결 요청]',
    `고객: ${user?.buyer_name || user?.username || user?.email || row.user_id}`,
    `이메일: ${user?.email || '-'}`,
    `계정: ${account?.name || row.account_id}`,
    `Threads: ${row.threads_handle}`,
    `요청 ID: ${row.id}`
  ].join('\n');
  const [sms, slack] = await Promise.allSettled([
    sendSetupSms(text),
    sendSlackMessage(`:link: ${text}`)
  ]);
  return {
    sms: sms.status === 'fulfilled' ? sms.value : { ok: false, error: sms.reason?.message || 'SMS failed' },
    slack: slack.status === 'fulfilled' ? slack.value : { ok: false, error: slack.reason?.message || 'Slack failed' }
  };
}

export async function listThreadsConnectionRequests(filters = {}) {
  const rows = await dbList('threads_connection_requests', {}, { order: 'created_at', ascending: false });
  const [users, accounts] = await Promise.all([dbList('users'), dbList('accounts')]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  return rows
    .filter((row) => !filters.status || row.status === filters.status)
    .map((row) => ({
      ...row,
      user: usersById.get(row.user_id) || null,
      account: accountsById.get(row.account_id) || null
    }));
}

export async function listThreadsConnectionRequestsForUser(userId, { accountId = null } = {}) {
  const rows = await dbList('threads_connection_requests', { user_id: userId }, { order: 'created_at', ascending: false });
  return accountId ? rows.filter((row) => row.account_id === accountId) : rows;
}

export async function requestThreadsConnection({ userId, accountId, threadsHandle, requestMemo = '' }) {
  const handle = displayHandle(threadsHandle);
  if (!handle) {
    const error = new Error('Threads 핸들을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const [user, account, links, existing] = await Promise.all([
    dbGet('users', { id: userId }),
    dbGet('accounts', { id: accountId }),
    dbList('user_accounts', { user_id: userId }),
    dbList('threads_connection_requests', { account_id: accountId })
  ]);
  if (!user || !account || !links.some((link) => link.account_id === accountId)) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }

  await dbUpdate('accounts', { id: accountId }, { account_handle: handle }).catch(() => []);
  const active = existing
    .filter((row) => ['requested', 'meta_registered', 'customer_action_required'].includes(row.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  if (active) {
    const [updated] = await dbUpdate('threads_connection_requests', { id: active.id }, {
      threads_handle: handle,
      request_memo: String(requestMemo || active.request_memo || '').trim() || null
    });
    return { request: updated || active, alreadyExists: true };
  }

  const request = await dbInsert('threads_connection_requests', {
    user_id: userId,
    account_id: accountId,
    threads_handle: handle,
    status: 'requested',
    request_memo: String(requestMemo || '').trim() || null
  });
  const notification = await notifyThreadsRequest(request, { user, account }).catch((error) => ({ error: error.message }));
  await logActivity({
    account_id: accountId,
    project_id: account.project_id,
    action: 'threads_connection_requested',
    level: 'info',
    message: handle,
    payload: { requestId: request.id, notification }
  }).catch(() => null);
  return { request, alreadyExists: false, notification };
}

export async function updateThreadsConnectionRequest(id, patch = {}, actor = {}) {
  const current = await dbGet('threads_connection_requests', { id });
  if (!current) {
    const error = new Error('Threads 연결 요청을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  const next = {};
  if (patch.status !== undefined) {
    if (!STATUSES.has(patch.status)) {
      const error = new Error('유효하지 않은 Threads 연결 요청 상태입니다.');
      error.status = 400;
      throw error;
    }
    next.status = patch.status;
    if (patch.status === 'meta_registered' || patch.status === 'customer_action_required') {
      next.meta_registered_at = current.meta_registered_at || new Date().toISOString();
      next.status = 'customer_action_required';
    }
    if (patch.status === 'connected') next.connected_at = current.connected_at || new Date().toISOString();
    if (patch.status === 'canceled') next.canceled_at = current.canceled_at || new Date().toISOString();
  }
  if (patch.adminMemo !== undefined || patch.admin_memo !== undefined) {
    next.admin_memo = String(patch.adminMemo ?? patch.admin_memo ?? '').trim() || null;
  }
  if (patch.threadsHandle !== undefined || patch.threads_handle !== undefined) {
    next.threads_handle = displayHandle(patch.threadsHandle ?? patch.threads_handle);
  }
  const [updated] = await dbUpdate('threads_connection_requests', { id }, next);
  await logActivity({
    account_id: current.account_id,
    action: 'threads_connection_request_updated',
    level: 'info',
    message: updated?.status || current.status,
    payload: { requestId: id, actor: actor?.email || actor?.type || 'admin', patch: next }
  }).catch(() => null);
  return updated || current;
}

export async function markThreadsConnectionRequestConnected(accountId) {
  const rows = (await dbList('threads_connection_requests', { account_id: accountId }, { order: 'created_at', ascending: false }))
    .filter((row) => row.status !== 'connected' && row.status !== 'canceled');
  const target = rows[0];
  if (!target) return null;
  const [updated] = await dbUpdate('threads_connection_requests', { id: target.id }, {
    status: 'connected',
    connected_at: new Date().toISOString()
  });
  return updated || target;
}
