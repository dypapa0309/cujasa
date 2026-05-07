const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.jasain.kr';
const tokenKey = 'cujasa_admin_token';
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
  try {
    const token = getAuthToken();
    let res;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {})
        },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (fetchError) {
      const error = new Error('요청 연결이 끊겼습니다. 서버 작업 상태를 다시 확인하고 있습니다.');
      error.code = 'NETWORK_REQUEST_FAILED';
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
    endRequest();
  }
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' })
};
