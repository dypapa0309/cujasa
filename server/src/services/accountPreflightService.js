import { dbGet, dbList, dbUpdate } from './supabaseService.js';
import { classificationForCategory, classifyQueueError } from './queueErrorService.js';

const THREADS_GRAPH_URL = 'https://graph.threads.net';

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function makeCheck(key, status, title, message, action = null) {
  return { key, status, title, message, action };
}

function isTokenError(message = '') {
  return /OAuth|access token|Cannot parse access token|token|code"?\s*:\s*190|code 190/i.test(message);
}

async function requestThreadsMe(token) {
  const params = new URLSearchParams({
    fields: 'id,username',
    access_token: token
  });
  const response = await fetch(`${THREADS_GRAPH_URL}/me?${params.toString()}`);
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!response.ok || json.error) {
    const message = json.error?.message || json.error || text || `HTTP ${response.status}`;
    const error = new Error(message);
    if (isTokenError(message)) error.code = 'THREADS_TOKEN_INVALID';
    throw error;
  }
  return json;
}

export async function preflightAccount(accountId, options = {}) {
  const account = await dbGet('accounts', { id: accountId });
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }

  const checks = [];
  let currentThreadsError = false;
  if (account.status !== 'active') {
    checks.push(makeCheck('account_status', 'error', '계정이 비활성 상태입니다', `현재 상태가 ${account.status || 'unknown'}입니다. active 상태에서만 자동화가 실행됩니다.`));
  } else {
    checks.push(makeCheck('account_status', 'ok', '계정 상태 정상', '계정이 active 상태입니다.'));
  }

  if (!account.threads_access_token) {
    currentThreadsError = true;
    checks.push(makeCheck('threads_token', 'error', 'Threads 연결이 필요합니다', '이 계정은 Threads 액세스 토큰이 없습니다. 연결을 먼저 완료해주세요.', 'reconnect_threads'));
  } else if (account.threads_token_status === 'refresh_failed') {
    currentThreadsError = true;
    checks.push(makeCheck('threads_token', 'error', 'Threads 연결이 만료되었습니다', '토큰 갱신에 실패한 상태입니다. 다시 연결해주세요.', 'reconnect_threads'));
  } else {
    try {
      const me = await requestThreadsMe(account.threads_access_token);
      const connectedHandle = normalizeHandle(me.username);
      const expectedHandle = normalizeHandle(account.account_handle);
      if (expectedHandle && connectedHandle && expectedHandle !== connectedHandle) {
        currentThreadsError = true;
        checks.push(makeCheck(
          'threads_handle',
          'error',
          '연결된 Threads 계정이 다릅니다',
          `이 CUJASA 계정은 @${expectedHandle} 전용인데 현재 토큰은 @${connectedHandle} 계정입니다. 올바른 Threads 계정으로 다시 연결해주세요.`,
          'reconnect_threads'
        ));
      } else {
        checks.push(makeCheck('threads_token', 'ok', 'Threads 연결 정상', `@${me.username || account.account_handle || 'Threads'} 계정 토큰이 확인되었습니다.`));
      }
      if (me.id && me.id !== account.threads_user_id) {
        await dbUpdate('accounts', { id: account.id }, { threads_user_id: me.id, threads_token_status: 'connected' });
      }
    } catch (error) {
      if (error.code === 'THREADS_TOKEN_INVALID') {
        await dbUpdate('accounts', { id: account.id }, { threads_token_status: 'refresh_failed' });
      }
      currentThreadsError = true;
      checks.push(makeCheck(
        'threads_token',
        'error',
        'Threads 연결이 만료되었습니다',
        'Threads가 저장된 토큰을 거절했습니다. 설정에서 다시 연결해주세요.',
        'reconnect_threads'
      ));
    }
  }

  const expiresAt = account.threads_token_expires_at ? new Date(account.threads_token_expires_at).getTime() : null;
  if (expiresAt && Number.isFinite(expiresAt)) {
    const daysLeft = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
    if (daysLeft <= 0) {
      currentThreadsError = true;
      checks.push(makeCheck('threads_expiry', 'error', 'Threads 토큰 만료일이 지났습니다', '다시 연결이 필요합니다.', 'reconnect_threads'));
    } else if (daysLeft <= 7) {
      checks.push(makeCheck('threads_expiry', 'warn', 'Threads 토큰 만료가 임박했습니다', `${daysLeft}일 안에 토큰 갱신이 필요할 수 있습니다.`));
    }
  }

  if (!String(account.target_audience || '').trim()) {
    checks.push(makeCheck('target_audience', 'error', '타겟 오디언스가 비어 있습니다', '설정 화면에서 타겟 오디언스를 입력해주세요.'));
  }
  if (!String(account.content_scope || '').trim()) {
    checks.push(makeCheck('content_scope', 'error', '다룰 카테고리가 비어 있습니다', '설정 화면에서 콘텐츠 범위를 입력해주세요.'));
  }

  const linkRatio = Number(account.link_post_ratio ?? 0.3);
  if (linkRatio > 0) {
    const hasCoupang = account.coupang_access_key && account.coupang_secret_key && account.coupang_partner_id;
    if (!hasCoupang) {
      checks.push(makeCheck('coupang', 'warn', '쿠팡 API 설정을 확인해주세요', '링크 포함 글을 만들려면 쿠팡 Access Key, Secret Key, Partner ID가 필요합니다.'));
    } else {
      checks.push(makeCheck('coupang', 'ok', '쿠팡 API 설정 확인', '링크 포함 글을 만들 수 있는 기본 설정이 있습니다.'));
    }
  }

  if (options.includeQueue !== false) {
    const queues = await dbList('post_queue', { account_id: account.id });
    const broken = queues
      .filter((row) => ['retry', 'manual_required', 'failed'].includes(row.status))
      .slice(-3);
    if (broken.length > 0) {
      const latest = broken[broken.length - 1];
      const first = latest?.error_category
        ? classificationForCategory(latest.error_category, latest.error_message)
        : classifyQueueError(latest?.error_message);
      const isReconnectProblem = first?.category === 'threads_reconnect_required';
      checks.push(makeCheck(
        'recent_queue_errors',
        isReconnectProblem && currentThreadsError ? 'error' : 'warn',
        isReconnectProblem && !currentThreadsError ? '과거 토큰 실패 기록이 있습니다' : '최근 업로드 실패가 있습니다',
        first?.message || `${broken.length}개의 확인 필요한 포스팅이 있습니다.`,
        isReconnectProblem && currentThreadsError ? 'reconnect_threads' : null
      ));
    }
  }

  const hasError = checks.some((check) => check.status === 'error');
  const hasWarn = checks.some((check) => check.status === 'warn');
  return {
    ok: !hasError,
    canPublish: !hasError,
    severity: hasError ? 'error' : (hasWarn ? 'warn' : 'ok'),
    accountId: account.id,
    accountName: account.name,
    accountHandle: account.account_handle,
    checks
  };
}

export function assertPreflightCanPublish(preflight) {
  if (preflight.canPublish) return;
  const first = preflight.checks.find((check) => check.status === 'error');
  const error = new Error(first?.message || '계정 점검에서 오류가 발견되어 자동화를 실행할 수 없습니다.');
  error.status = 422;
  error.code = first?.key || 'PREFLIGHT_FAILED';
  error.preflight = preflight;
  throw error;
}
