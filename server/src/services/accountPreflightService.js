import { dbGet, dbList, dbUpdate } from './supabaseService.js';
import { normalizeQueueClassification } from './queueErrorService.js';
import { markPastTokenFailuresRetryable } from './threadsOAuthService.js';
import { autoHidePastTokenFailures } from './queueVisibilityService.js';
import { isCoupangCooldownActive } from './coupangService.js';

const THREADS_GRAPH_URL = 'https://graph.threads.net';
const THREADS_PREFLIGHT_TIMEOUT_MS = 10000;

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function makeCheck(key, status, title, message, action = null) {
  return { key, status, title, message, action };
}

function isTokenError(message = '') {
  return /OAuth|access token|Cannot parse access token|token|code"?\s*:\s*190|code 190/i.test(message);
}

function queueTime(row = {}) {
  return new Date(row.updated_at || row.created_at || row.scheduled_at || 0).getTime() || 0;
}

async function requestThreadsMe(token) {
  const params = new URLSearchParams({
    fields: 'id,username',
    access_token: token
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), THREADS_PREFLIGHT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${THREADS_GRAPH_URL}/me?${params.toString()}`, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  let currentThreadsOk = false;
  if (account.status !== 'active') {
    checks.push(makeCheck('account_status', 'error', '계정이 비활성 상태입니다', `현재 상태가 ${account.status || 'unknown'}입니다. active 상태에서만 자동화가 실행됩니다.`));
  } else {
    checks.push(makeCheck('account_status', 'ok', '계정 상태 정상', '계정이 active 상태입니다.'));
  }

  if (!account.threads_access_token) {
    currentThreadsError = true;
    checks.push(makeCheck('threads_token', 'error', 'Threads 연결이 필요합니다', '이 계정은 Threads 액세스 토큰이 없습니다. 연결을 먼저 완료해주세요.', 'reconnect_threads'));
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
        currentThreadsOk = true;
        checks.push(makeCheck('threads_token', 'ok', 'Threads 연결 정상', `@${me.username || account.account_handle || 'Threads'} 계정 토큰이 확인되었습니다.`));
      }
      if (!currentThreadsError) {
        const patch = { threads_token_status: 'connected' };
        if (me.id && me.id !== account.threads_user_id) patch.threads_user_id = me.id;
        await dbUpdate('accounts', { id: account.id }, patch);
        await markPastTokenFailuresRetryable(account.id).catch(() => 0);
        await autoHidePastTokenFailures(account.id, {
          reason: 'preflight_threads_ok_auto_hidden',
          includeRecent: false
        }).catch(() => []);
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
      if (currentThreadsOk) {
        checks.push(makeCheck('threads_expiry', 'warn', 'Threads 토큰 만료일 정보 확인 필요', '현재 토큰 검증은 성공했습니다. 다음 재연결 때 만료일 정보가 갱신됩니다.'));
      } else {
        currentThreadsError = true;
        checks.push(makeCheck('threads_expiry', 'error', 'Threads 토큰 만료일이 지났습니다', '다시 연결이 필요합니다.', 'reconnect_threads'));
      }
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
    if (isCoupangCooldownActive(account)) {
      checks.push(makeCheck(
        'coupang_rate_limit',
        'error',
        '쿠팡 요청 제한 보호 중입니다',
        `쿠팡 파트너스 요청 제한으로 자동화를 멈췄습니다. ${account.coupang_search_cooldown_until || '쿨다운 해제'} 이후 다시 시도해주세요.`,
        'wait_coupang_cooldown'
      ));
    } else if (!hasCoupang) {
      checks.push(makeCheck('coupang', 'warn', '쿠팡 API 설정을 확인해주세요', '링크 포함 글을 만들려면 쿠팡 Access Key, Secret Key, Partner ID가 필요합니다.'));
    } else {
      checks.push(makeCheck('coupang', 'ok', '쿠팡 API 설정 확인', '링크 포함 글을 만들 수 있는 기본 설정이 있습니다.'));
    }
  }

  if (options.includeQueue !== false) {
    const queues = await dbList('post_queue', { account_id: account.id });
    const broken = queues
      .filter((row) => ['retry', 'manual_required', 'failed'].includes(row.status))
      .sort((a, b) => queueTime(b) - queueTime(a))
      .slice(0, 3);
    if (broken.length > 0) {
      const latest = broken[0];
      const first = normalizeQueueClassification(latest, { currentThreadsOk });
      const isReconnectProblem = first?.category === 'threads_reconnect_required';
      const isPastReconnectProblem = ['retry_available', 'recheck_required'].includes(first?.category);
      checks.push(makeCheck(
        'recent_queue_errors',
        isReconnectProblem && currentThreadsError ? 'error' : 'warn',
        (isReconnectProblem && !currentThreadsError) || isPastReconnectProblem ? '과거 업로드 실패 기록이 있습니다' : '최근 업로드 실패가 있습니다',
        ((isReconnectProblem && !currentThreadsError) || isPastReconnectProblem)
          ? '현재 Threads 연결은 정상입니다. 과거 실패 항목은 본문 게시 여부를 확인한 뒤 재시도하거나 정리할 수 있습니다.'
          : (first?.message || `${broken.length}개의 확인 필요한 포스팅이 있습니다.`),
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
