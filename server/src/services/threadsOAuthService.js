import crypto from 'node:crypto';
import { dbGet, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { normalizeQueueClassification } from './queueErrorService.js';
import { autoHidePastTokenFailures } from './queueVisibilityService.js';
import { sendOpsAlert } from './notificationService.js';
import { markThreadsConnectionRequestConnected, syncLatestThreadsRequestToAccount } from './threadsConnectionRequestService.js';

const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';
const THREADS_GRAPH_URL = 'https://graph.threads.net';
const THREADS_OAUTH_SCOPE = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_read_replies'
].join(',');
const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const usedStateSignatures = new Map();
const AUTO_START_AFTER_OAUTH_MARKER = '[auto_start_after_oauth]';

function normalizeThreadsHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function duplicateTestOwnerEmails() {
  return new Set(String(process.env.THREADS_DUPLICATE_TEST_OWNER_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

async function duplicateAllowedForTestAccount(accountIdA, accountIdB) {
  const allowedEmails = duplicateTestOwnerEmails();
  if (!allowedEmails.size) return false;
  const [rows, users] = await Promise.all([dbList('user_accounts'), dbList('users')]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  return rows
    .filter((row) => row.account_id === accountIdA || row.account_id === accountIdB)
    .some((row) => allowedEmails.has(String(usersById.get(row.user_id)?.email || '').trim().toLowerCase()));
}

async function accountsShareOwner(accountIdA, accountIdB) {
  if (!accountIdA || !accountIdB) return false;
  const rows = await dbList('user_accounts');
  const ownersA = new Set(rows.filter((row) => row.account_id === accountIdA).map((row) => row.user_id).filter(Boolean));
  const ownersB = new Set(rows.filter((row) => row.account_id === accountIdB).map((row) => row.user_id).filter(Boolean));
  if (!ownersA.size || !ownersB.size) return false;
  return [...ownersA].some((ownerId) => ownersB.has(ownerId));
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

export function peekThreadsState(state) {
  try {
    const payload = JSON.parse(Buffer.from(state || '', 'base64url').toString('utf8'));
    return {
      accountId: payload.accountId || null,
      userId: payload.userId || null,
      actorType: payload.actorType || 'user',
      exp: payload.exp || null
    };
  } catch {
    return { accountId: null, userId: null, actorType: null, exp: null };
  }
}

function oauthErrorCode(error = {}) {
  const status = Number(error.status || 0);
  const metaCode = Number(error.metaErrorCode || error.error_code || 0);
  const message = String(error.message || '');
  if (status === 409 && /이미.*연결|다른 계정/i.test(message)) return 'THREADS_DUPLICATE_ACCOUNT';
  if (status === 409 && /선택한 계정|현재 Threads 로그인|핸들/i.test(message)) return 'THREADS_HANDLE_MISMATCH';
  if (metaCode === 1349245 || /permission|review|scope|not authorized|not approved|invite|test the app/i.test(message)) return 'THREADS_META_PERMISSION_REQUIRED';
  if (status === 400 && /state|expired|invalid/i.test(message)) return 'THREADS_OAUTH_STATE_INVALID';
  if (status === 403 || /Access denied|Unauthorized/i.test(message)) return 'THREADS_OAUTH_ACCESS_DENIED';
  if (/redirect_uri|redirect uri/i.test(message)) return 'THREADS_REDIRECT_URI_MISMATCH';
  if (/configured/i.test(message)) return 'THREADS_OAUTH_NOT_CONFIGURED';
  return 'THREADS_OAUTH_FAILED';
}

function userFacingOAuthMessage(error = {}) {
  const code = oauthErrorCode(error);
  if (code === 'THREADS_HANDLE_MISMATCH') return error.message;
  if (code === 'THREADS_DUPLICATE_ACCOUNT') return error.message;
  if (code === 'THREADS_OAUTH_STATE_INVALID') return 'Threads 연결 요청이 만료됐어요. 설정 화면에서 다시 연결을 눌러주세요.';
  if (code === 'THREADS_REDIRECT_URI_MISMATCH') return 'Threads OAuth Redirect URI 설정이 맞지 않습니다. 운영자 확인이 필요합니다.';
  if (code === 'THREADS_META_PERMISSION_REQUIRED') return 'Meta 앱 권한 또는 테스터 초대 수락 상태 확인이 필요합니다. Meta 개발자센터 초대를 수락한 뒤 다시 연결해주세요.';
  if (code === 'THREADS_OAUTH_NOT_CONFIGURED') return 'Threads 연결 환경변수가 아직 설정되지 않았습니다.';
  return error.message || 'Threads 연결에 실패했습니다.';
}

export function threadsOAuthErrorFromCallback(query = {}) {
  const message = String(query.error_message || query.error_description || query.error || '').trim();
  if (!message) return null;
  const error = new Error(`Threads OAuth failed: ${message}`);
  error.status = 400;
  if (query.error_code) error.metaErrorCode = Number(query.error_code);
  if (query.error_subcode) error.metaErrorSubcode = Number(query.error_subcode);
  return error;
}

export async function createThreadsAuthUrl({ accountId, user }) {
  const syncResult = await syncLatestThreadsRequestToAccount(accountId).catch(() => ({ request: null, account: null }));
  const account = syncResult.account || await dbGet('accounts', { id: accountId });
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
    scope: THREADS_OAUTH_SCOPE,
    response_type: 'code',
    state: createThreadsState({
      accountId,
      userId: user?.userId || user?.email || 'admin',
      actorType: user?.type || 'admin'
    })
  });
  await logActivity({
    account_id: accountId,
    project_id: account.project_id,
    action: 'threads_oauth_started',
    level: 'info',
    message: account.account_handle || account.name || accountId,
    payload: {
      actorType: user?.type || 'admin',
      userId: user?.userId || user?.email || 'admin',
      appIdSuffix: appId.slice(-6),
      redirectHost: (() => {
        try { return new URL(redirectUri).host; } catch { return null; }
      })(),
      scope: THREADS_OAUTH_SCOPE,
      expectedHandle: account.account_handle || null,
      latestRequestHandleMatchesAccount: syncResult.request?.threads_handle
        ? normalizeThreadsHandle(syncResult.request.threads_handle) === normalizeThreadsHandle(account.account_handle)
        : null,
      latestRequest: syncResult.request ? {
        id: syncResult.request.id,
        status: syncResult.request.status,
        threadsHandle: syncResult.request.threads_handle || null
      } : null
    }
  }).catch(() => null);
  return `${THREADS_AUTH_URL}?${params.toString()}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok || json.error) {
    const message = json.error?.message || json.error || text || `HTTP ${response.status}`;
    const error = new Error(`Threads OAuth failed: ${message}`);
    error.status = response.status;
    if (json.error?.code) error.metaErrorCode = Number(json.error.code);
    if (json.error?.error_subcode) error.metaErrorSubcode = Number(json.error.error_subcode);
    throw error;
  }
  return json;
}

export async function markPastTokenFailuresRetryable(accountId) {
  const rows = await dbList('post_queue', { account_id: accountId });
  const targets = rows.filter((row) => {
    if (!['failed', 'retry', 'manual_required'].includes(row.status)) return false;
    const classified = normalizeQueueClassification(row);
    return ['threads_reconnect_required', 'reply_permission_required'].includes(classified.category);
  });
  for (const row of targets) {
    await dbUpdate('post_queue', { id: row.id }, {
      error_category: 'retry_available',
      error_message: 'Threads 재연결 후 재시도 가능'
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
    const sharedOwner = duplicate ? await accountsShareOwner(accountId, duplicate.id).catch(() => false) : false;
    const testAllowed = duplicate ? await duplicateAllowedForTestAccount(accountId, duplicate.id).catch(() => false) : false;
    if (duplicate && !sharedOwner && !testAllowed) {
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

  let [account] = await dbUpdate('accounts', { id: accountId }, patch);
  const connectionRequest = await markThreadsConnectionRequestConnected(accountId).catch(() => null);
  const retryableQueueCount = await markPastTokenFailuresRetryable(accountId).catch(() => 0);
  const shouldAutoStart = account?.status === 'active'
    && String(connectionRequest?.admin_memo || '').includes(AUTO_START_AFTER_OAUTH_MARKER);
  if (shouldAutoStart) {
    [account] = await dbUpdate('accounts', { id: accountId }, {
      automation_status: 'running',
      automation_started_at: new Date().toISOString(),
      automation_stopped_at: null
    });
    const { runPipelineForAccountInBackground } = await import('./pipelineBackgroundService.js');
    runPipelineForAccountInBackground(accountId, {
      requestedBy: 'threads_oauth_auto_start',
      mode: 'start',
      allowInitialLinkDiscovery: true,
      failureAction: 'oauth_auto_start_failed_kept_running'
    });
  }
  await logActivity({
    account_id: accountId,
    project_id: account?.project_id,
    action: 'threads_oauth_connected',
    message: me.username || me.id,
    payload: { threadsUserId: me.id, expiresAt, retryableQueueCount, autoStarted: shouldAutoStart }
  });
  return account;
}

export async function recordThreadsOAuthFailure({ state, error }) {
  const statePayload = peekThreadsState(state);
  const accountId = statePayload.accountId;
  const code = oauthErrorCode(error);
  const message = userFacingOAuthMessage(error);
  let account = null;
  if (accountId) account = await dbGet('accounts', { id: accountId }).catch(() => null);
  if (accountId) {
    const requests = await dbList('threads_connection_requests', { account_id: accountId }, { order: 'created_at', ascending: false, limit: 1 }).catch(() => []);
    const request = requests[0];
    if (request && !['connected', 'canceled'].includes(request.status)) {
      await dbUpdate('threads_connection_requests', { id: request.id }, {
        admin_memo: `${message} (${code})`
      }).catch(() => []);
    }
  }
  await logActivity({
    account_id: accountId || null,
    project_id: account?.project_id || null,
    action: 'threads_oauth_failed',
    level: 'error',
    message,
    payload: {
      code,
      status: error?.status || null,
      rawMessage: error?.message || null,
      state: statePayload
    }
  }).catch(() => null);
  return { code, message, accountId };
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
