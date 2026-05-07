const baseUrl = import.meta.env.VITE_API_BASE_URL || 'https://api.jasain.kr';
const tokenKey = 'cujasa_admin_token';

export function getAuthToken() {
  return localStorage.getItem(tokenKey);
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
}

async function request(path, options = {}) {
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
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' })
};
