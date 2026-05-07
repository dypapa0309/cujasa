import crypto from 'node:crypto';
import { dbGet, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { normalizeQueueClassification } from './queueErrorService.js';
import { autoHidePastTokenFailures } from './queueVisibilityService.js';
import { sendOpsAlert } from './notificationService.js';

const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';
const THREADS_GRAPH_URL = 'https://graph.threads.net';
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const usedStateSignatures = new Map();

function normalizeThreadsHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function getConfig() {
  const appId = process.env.THREADS_APP_ID;
  const appSecret = process.env.THREADS_APP_SECRET;
  const redirectUri = process.env.THREADS_REDIRECT_URI || `${process.env.APP_BASE_URL || ''}/api/auth/threads/callback`;
  if (!appId || !appSecret || !redirectUri) {
    const error = new Error('Threads OAuth is not configured');
    error.status = 503;
    throw error;
  }
  return { appId, appSecret, redirectUri };
}

function stateSecret() {
  return process.env.THREADS_APP_SECRET || process.env.JWT_SECRET || 'cujasa-threads-state';
}

function signState({ accountId, userId, exp, actorType = 'user' }) {
  return crypto
    .createHmac('sha256', stateSecret())
    .update(`${accountId}.${userId}.${exp}.${actorType}`)
    .digest('base64url');
}

function rememberStateSignature(sig) {
  const now = Date.now();
  for (const [key, expiresAt] of usedStateSignatures.entries()) {
    if (expiresAt <= now) usedStateSignatures.delete(key);
  }
  if (usedStateSignatures.has(sig)) {
    const error = new Error('Threads OAuth state was already used');
    error.status = 400;
    throw error;
  }
  usedStateSignatures.set(sig, now + STATE_TTL_MS);
}

export function createThreadsState({ accountId, userId, actorType = 'user' }) {
  const payload = { accountId, userId, actorType, exp: Date.now() + STATE_TTL_MS };
  return Buffer.from(JSON.stringify({ ...payload, sig: signState(payload) })).toString('base64url');
}

export function verifyThreadsState(state) {
  let payload;
  try {
    payload = JSON.parse(Buffer.from(state || '', 'base64url').toString('utf8'));
  } catch {
    const error = new Error('Invalid Threads OAuth state');
    error.status = 400;
    throw error;
  }
  const { accountId, userId, actorType = 'user', exp, sig } = payload;
  if (!accountId || !userId || !exp || !sig || exp < Date.now()) {
    const error = new Error('Expired or invalid Threads OAuth state');
    error.status = 400;
    throw error;
  }
  const expected = signState({ accountId, userId, actorType, exp });
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    const error = new Error('Invalid Threads OAuth state signature');
    error.status = 400;
    throw error;
  }
  rememberStateSignature(sig);
  return { accountId, userId, actorType };
}

export async function createThreadsAuthUrl({ accountId, user }) {
  const account = await dbGet('accounts', { id: accountId });
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (user?.type === 'user' && !user.allowedAccountIds.includes(accountId)) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }
  const { appId, redirectUri } = getConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: 'threads_basic,threads_content_publish',
    response_type: 'code',
    state: createThreadsState({
      accountId,
      userId: user?.userId || user?.email || 'admin',
      actorType: user?.type || 'admin'
    })
  });
  return `${THREADS_AUTH_URL}?${params.toString()}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok || json.error) {
    const message = json.error?.message || json.error || text || `HTTP ${response.status}`;
    throw new Error(`Threads OAuth failed: ${message}`);
  }
  return json;
}

export async function markPastTokenFailuresRetryable(accountId) {
  const rows = await dbList('post_queue', { account_id: accountId });
  const targets = rows.filter((row) => {
    if (!['failed', 'retry', 'manual_required'].includes(row.status)) return false;
    const classified = normalizeQueueClassification(row);
    return classified.category === 'threads_reconnect_required';
  });
  for (const row of targets) {
    await dbUpdate('post_queue', { id: row.id }, {
      error_category: 'retry_available',
      error_message: row.error_message || 'Threads 재연결 후 재시도 가능'
    });
  }
  await autoHidePastTokenFailures(accountId, {
    reason: 'threads_reconnected_auto_hidden',
    includeRecent: false
  }).catch(() => []);
  return targets.length;
}

export async function completeThreadsOAuth({ code, state }) {
  if (!code) {
    const error = new Error('Missing Threads OAuth code');
    error.status = 400;
    throw error;
  }
  const { accountId, userId, actorType } = verifyThreadsState(state);
  const accountBeforeConnect = await dbGet('accounts', { id: accountId });
  if (!accountBeforeConnect) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (actorType !== 'admin') {
    const allowed = (await dbList('user_accounts', { user_id: userId })).some((row) => row.account_id === accountId);
    if (!allowed) {
      const error = new Error('Access denied');
      error.status = 403;
      throw error;
    }
  }
  const { appId, appSecret, redirectUri } = getConfig();

  const shortToken = await requestJson(`${THREADS_GRAPH_URL}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })
  });

  const longParams = new URLSearchParams({
    grant_type: 'th_exchange_token',
    client_secret: appSecret,
    access_token: shortToken.access_token
  });
  const longToken = await requestJson(`${THREADS_GRAPH_URL}/access_token?${longParams.toString()}`);
  const expiresAt = new Date(Date.now() + Number(longToken.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString();

  const meParams = new URLSearchParams({
    fields: 'id,username',
    access_token: longToken.access_token
  });
  const me = await requestJson(`${THREADS_GRAPH_URL}/me?${meParams.toString()}`);
  const connectedHandle = normalizeThreadsHandle(me.username);
  const expectedHandle = normalizeThreadsHandle(accountBeforeConnect.account_handle);
  if (expectedHandle && connectedHandle && expectedHandle !== connectedHandle) {
    const error = new Error(`선택한 계정은 @${expectedHandle}인데, 현재 Threads 로그인은 @${connectedHandle}입니다. Threads에서 올바른 계정으로 로그인한 뒤 다시 연결해주세요.`);
    error.status = 409;
    throw error;
  }
  if (me.id) {
    const duplicate = (await dbList('accounts', { threads_user_id: me.id, status: 'active' }))
      .find((row) => row.id !== accountId);
    if (duplicate) {
      const duplicateHandle = duplicate.account_handle || duplicate.name || '다른 계정';
      const error = new Error(`이 Threads 계정은 이미 ${duplicateHandle}에 연결되어 있습니다. 기존 연결을 해제한 뒤 다시 시도해주세요.`);
      error.status = 409;
      throw error;
    }
  }

  const patch = {
    threads_access_token: longToken.access_token,
    threads_user_id: me.id || null,
    threads_token_expires_at: expiresAt,
    threads_token_status: 'connected',
    threads_connected_at: new Date().toISOString(),
    last_threads_refresh_at: null
  };
  if (me.username) patch.account_handle = `@${String(me.username).replace(/^@/, '')}`;

  const [account] = await dbUpdate('accounts', { id: accountId }, patch);
  const retryableQueueCount = await markPastTokenFailuresRetryable(accountId).catch(() => 0);
  await logActivity({
    account_id: accountId,
    project_id: account?.project_id,
    action: 'threads_oauth_connected',
    message: me.username || me.id,
    payload: { threadsUserId: me.id, expiresAt, retryableQueueCount }
  });
  return account;
}

export async function refreshThreadsToken(account) {
  const params = new URLSearchParams({
    grant_type: 'th_refresh_token',
    access_token: account.threads_access_token
  });
  const refreshed = await requestJson(`${THREADS_GRAPH_URL}/refresh_access_token?${params.toString()}`);
  const expiresAt = new Date(Date.now() + Number(refreshed.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString();
  const [updated] = await dbUpdate('accounts', { id: account.id }, {
    threads_access_token: refreshed.access_token,
    threads_token_expires_at: expiresAt,
    threads_token_status: 'connected',
    last_threads_refresh_at: new Date().toISOString()
  });
  await logActivity({
    account_id: account.id,
    project_id: account.project_id,
    action: 'threads_token_refreshed',
    message: expiresAt
  });
  return updated;
}

export async function refreshExpiringThreadsTokens() {
  const accounts = await dbList('accounts', { status: 'active' });
  const now = Date.now();
  let refreshed = 0;
  let failed = 0;
  for (const account of accounts) {
    if (!account.threads_access_token || !account.threads_token_expires_at) continue;
    const expiresAt = new Date(account.threads_token_expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt - now > REFRESH_WINDOW_MS) continue;
    try {
      await refreshThreadsToken(account);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      await dbUpdate('accounts', { id: account.id }, { threads_token_status: 'refresh_failed' });
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        action: 'threads_token_refresh_failed',
        level: 'error',
        message: error.message
      });
      await sendOpsAlert('threads_token_refresh_failed', {
        title: 'Threads 토큰 갱신 실패',
        account,
        code: 'THREADS_TOKEN_REFRESH_FAILED',
        message: error.message,
        hint: '고객/관리자 화면에서 Threads 재연결 상태를 확인하세요.',
        payload: { accountId: account.id, projectId: account.project_id }
      });
    }
  }
  return { refreshed, failed };
}
