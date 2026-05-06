import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { normalizeAutomationStatus } from './accountAutomationService.js';

const CONTENT_MODES = new Set(['daily', 'empathy', 'problem_solution', 'checklist', 'question', 'safe_debate']);
const CONTENT_INTENSITIES = new Set(['soft', 'normal', 'strong']);
const COMMENT_STYLES = new Set(['none', 'soft_question', 'experience_question', 'choice_question']);
const PRODUCT_MENTION_STYLES = new Set(['none', 'natural', 'direct']);
const EMOJI_LEVELS = new Set(['none', 'low', 'medium']);
const MAX_DAILY_POSTS = 5;

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAccount(payload) {
  const next = { ...payload };
  if (next.status && !['active', 'paused', 'archived'].includes(next.status)) next.status = 'paused';
  if (next.automation_status != null) next.automation_status = normalizeAutomationStatus(next.automation_status);
  if (next.account_handle != null) {
    const handle = String(next.account_handle).trim();
    next.account_handle = handle ? `@${handle.replace(/^@/, '')}` : '';
  }
  if (!Array.isArray(next.forbidden_topics)) next.forbidden_topics = next.forbidden_topics ? [String(next.forbidden_topics)] : [];
  if (!Array.isArray(next.forbidden_words)) next.forbidden_words = next.forbidden_words ? [String(next.forbidden_words)] : [];
  if (!Array.isArray(next.active_time_windows) || next.active_time_windows.length === 0) {
    next.active_time_windows = [{ start: '09:00', end: '11:00' }];
  }
  next.active_time_windows = next.active_time_windows
    .filter((window) => window?.start && window?.end)
    .map((window) => ({ start: window.start, end: window.end }));
  next.daily_post_min = 0;
  next.daily_post_max = Math.min(MAX_DAILY_POSTS, Math.max(0, toFiniteNumber(next.daily_post_max, MAX_DAILY_POSTS)));
  next.min_interval_minutes = Math.max(1, toFiniteNumber(next.min_interval_minutes, 50));
  next.link_post_ratio = Math.min(1, Math.max(0, toFiniteNumber(next.link_post_ratio, 1)));
  next.no_link_post_ratio = Math.min(1, Math.max(0, toFiniteNumber(next.no_link_post_ratio, 0)));
  next.rest_days_per_week = Math.min(7, Math.max(0, toFiniteNumber(next.rest_days_per_week, 1)));
  if (!CONTENT_MODES.has(next.content_mode)) next.content_mode = 'empathy';
  if (!CONTENT_INTENSITIES.has(next.content_intensity)) next.content_intensity = 'normal';
  if (!COMMENT_STYLES.has(next.comment_induction_style)) next.comment_induction_style = 'soft_question';
  if (!PRODUCT_MENTION_STYLES.has(next.product_mention_style)) next.product_mention_style = 'natural';
  if (!EMOJI_LEVELS.has(next.emoji_level)) next.emoji_level = 'low';
  next.seasonality_enabled = next.seasonality_enabled !== false;
  next.safe_debate_enabled = Boolean(next.safe_debate_enabled);
  if (next.content_mode === 'safe_debate' && !next.safe_debate_enabled) next.content_mode = 'question';
  next.content_style_note = next.content_style_note == null ? '' : String(next.content_style_note).slice(0, 1000);
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
  automation_status: 'paused',
  forbidden_topics: [],
  forbidden_words: ['100%', '무조건', '완벽', '보장', '치료', '예방', '다이어트 약', '보조제', '가르시니아', '효과 보장', '체중감량 보장'],
  content_mode: 'empathy',
  content_intensity: 'normal',
  seasonality_enabled: true,
  comment_induction_style: 'soft_question',
  product_mention_style: 'natural',
  emoji_level: 'low',
  safe_debate_enabled: false,
  content_style_note: '',
  daily_post_min: 0,
  daily_post_max: 5,
  active_time_windows: [{ start: '09:00', end: '11:00' }, { start: '20:00', end: '23:00' }],
  min_interval_minutes: 50,
  link_post_ratio: 1,
  no_link_post_ratio: 0,
  rest_days_per_week: 1,
  ...payload
}));
export const updateAccount = async (id, payload) => {
  const current = await getAccount(id);
  const [updated] = await dbUpdate('accounts', { id }, normalizeAccount({ ...current, ...payload }));
  return updated;
};
export async function archiveAccount(id) {
  const current = await getAccount(id);
  if (!current) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const [updated] = await dbUpdate('accounts', { id }, {
    status: 'archived',
    automation_status: 'paused',
    automation_stopped_at: new Date().toISOString()
  });
  return updated;
}
export const deleteAccount = (id) => dbDelete('accounts', { id });
