import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

function normalizeAccount(payload) {
  const next = { ...payload };
  if (next.status && !['active', 'paused', 'archived'].includes(next.status)) next.status = 'paused';
  if (!Array.isArray(next.forbidden_topics)) next.forbidden_topics = next.forbidden_topics ? [String(next.forbidden_topics)] : [];
  if (!Array.isArray(next.forbidden_words)) next.forbidden_words = next.forbidden_words ? [String(next.forbidden_words)] : [];
  if (!Array.isArray(next.active_time_windows) || next.active_time_windows.length === 0) {
    next.active_time_windows = [{ start: '09:00', end: '11:00' }];
  }
  next.active_time_windows = next.active_time_windows
    .filter((window) => window?.start && window?.end)
    .map((window) => ({ start: window.start, end: window.end }));
  next.daily_post_min = Math.max(0, Number(next.daily_post_min ?? 1));
  next.daily_post_max = Math.max(next.daily_post_min, Number(next.daily_post_max ?? next.daily_post_min));
  next.min_interval_minutes = Math.max(1, Number(next.min_interval_minutes ?? 50));
  next.link_post_ratio = Math.min(1, Math.max(0, Number(next.link_post_ratio ?? 0.3)));
  next.no_link_post_ratio = Math.min(1, Math.max(0, Number(next.no_link_post_ratio ?? (1 - next.link_post_ratio))));
  next.rest_days_per_week = Math.min(7, Math.max(0, Number(next.rest_days_per_week ?? 1)));
  return next;
}

export const listAccounts = () => dbList('accounts', { status: 'active' }, { order: 'created_at', ascending: true });
export const listAllAccounts = () => dbList('accounts', {}, { order: 'created_at', ascending: true });
export const getAccount = (id) => dbGet('accounts', { id });
export function assertAccountActive(account, action = 'run automation') {
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  if (account.status !== 'active') {
    const error = new Error(`Account is ${account.status}; cannot ${action}`);
    error.status = 409;
    throw error;
  }
}
export const createAccount = (payload) => dbInsert('accounts', normalizeAccount({
  platform: 'threads',
  status: 'active',
  forbidden_topics: [],
  forbidden_words: ['100%', '무조건', '완벽', '보장', '치료', '예방', '다이어트 약', '보조제', '가르시니아', '효과 보장', '체중감량 보장'],
  daily_post_min: 1,
  daily_post_max: 3,
  active_time_windows: [{ start: '09:00', end: '11:00' }, { start: '20:00', end: '23:00' }],
  min_interval_minutes: 50,
  link_post_ratio: 0.3,
  no_link_post_ratio: 0.7,
  rest_days_per_week: 1,
  ...payload
}));
export const updateAccount = async (id, payload) => {
  const current = await getAccount(id);
  const [updated] = await dbUpdate('accounts', { id }, normalizeAccount({ ...current, ...payload }));
  return updated;
};
export const deleteAccount = (id) => dbDelete('accounts', { id });
