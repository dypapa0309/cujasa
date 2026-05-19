function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || 'https://api.jasain.kr';
  if (typeof window === 'undefined') return configured;
  const host = window.location.hostname;
  const configuredUrl = (() => {
    try {
      return new URL(configured);
    } catch {
      return null;
    }
  })();
  const isLocalApp = host === 'localhost' || host === '127.0.0.1';
  const configuredLocalApi = configuredUrl && ['localhost', '127.0.0.1'].includes(configuredUrl.hostname);
  if (!isLocalApp && configuredLocalApi) return 'https://api.jasain.kr';
  return configured;
}

const baseUrl = resolveApiBaseUrl();
const tokenKey = 'cujasa_admin_token';
const defaultTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 45000);
let activeRequests = 0;
let loadingTimer = null;
let loadingVisible = false;

function emitLoading(loading) {
  if (typeof window === 'undefined') return;
  loadingVisible = loading;
  window.dispatchEvent(new CustomEvent('jasain-api-loading', { detail: { loading } }));
}

function beginRequest() {
  if (typeof window === 'undefined') return;
  activeRequests += 1;
  if (activeRequests === 1) {
    loadingTimer = window.setTimeout(() => {
      if (activeRequests > 0) emitLoading(true);
    }, 400);
  }
}

function endRequest() {
  if (typeof window === 'undefined') return;
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) {
    if (loadingTimer) window.clearTimeout(loadingTimer);
    loadingTimer = null;
    if (loadingVisible) emitLoading(false);
  }
}

export function getAuthToken() {
  return localStorage.getItem(tokenKey);
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
}

export function postEvent(path, body = {}) {
  const token = getAuthToken();
  if (!token) return;
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body),
    keepalive: true
  }).catch(() => {});
}

async function request(path, options = {}) {
  beginRequest();
  const { timeoutMs = defaultTimeoutMs, ...requestOptions } = options;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller && timeoutMs > 0
    ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const token = getAuthToken();
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(requestOptions.headers || {})
        },
        ...requestOptions,
        ...(controller && !requestOptions.signal ? { signal: controller.signal } : {}),
        body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined
      });
    } catch (fetchError) {
      const timedOut = fetchError?.name === 'AbortError';
      const error = new Error(timedOut
        ? '자료를 불러오는 데 시간이 오래 걸립니다. 잠시 후 다시 시도해주세요.'
        : '요청 연결이 끊겼습니다. 잠시 후 다시 시도해주세요.');
      error.code = timedOut ? 'NETWORK_REQUEST_TIMEOUT' : 'NETWORK_REQUEST_FAILED';
      error.networkError = true;
      error.cause = fetchError;
      throw error;
    }
    if (res.status === 401) setAuthToken('');
    if (!res.ok) {
      const text = await res.text();
      let message = text || `Request failed (${res.status})`;
      let data = null;
      try {
        data = JSON.parse(text);
        message = data.error || data.message || message;
      } catch {
        if (/<!doctype html|<html/i.test(text)) {
          const pre = text.match(/<pre>(.*?)<\/pre>/is)?.[1]
            ?.replace(/<[^>]+>/g, '')
            ?.trim();
          message = pre
            ? `API 경로를 찾지 못했습니다: ${pre}`
            : `API 요청에 실패했습니다. (${res.status})`;
        }
      }
      const error = new Error(message);
      error.status = res.status;
      if (data && typeof data === 'object') Object.assign(error, data);
      throw error;
    }
    if (res.status === 204) return null;
    return res.json();
  } finally {
    if (timer) globalThis.clearTimeout(timer);
    endRequest();
  }
}

export const api = {
  get: (path, options = {}) => request(path, options),
  post: (path, body, options = {}) => request(path, { method: 'POST', body, ...options }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' })
};
