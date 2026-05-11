import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { normalizeAutomationStatus } from './accountAutomationService.js';

const CONTENT_MODES = new Set(['auto', 'daily', 'empathy', 'problem_solution', 'checklist', 'question', 'safe_debate']);
const CONTENT_INTENSITIES = new Set(['soft', 'normal', 'strong']);
const COMMENT_STYLES = new Set(['none', 'soft_question', 'experience_question', 'choice_question']);
const PRODUCT_MENTION_STYLES = new Set(['none', 'natural', 'direct']);
const EMOJI_LEVELS = new Set(['none', 'low', 'medium']);
const MAX_DAILY_POSTS = 5;
const BALANCED_LINK_RATIO = 0.67;
const BALANCED_NO_LINK_RATIO = 0.33;
const SENSITIVE_ACCOUNT_KEYS = new Set([
  'threads_access_token',
  'coupang_access_key',
  'coupang_secret_key',
  'coupang_partner_id',
  'coupang_tracking_code'
]);
const ACCOUNT_COLUMNS = new Set([
  'project_id',
  'name',
  'platform',
  'account_handle',
  'target_audience',
  'content_scope',
  'forbidden_topics',
  'forbidden_words',
  'tone',
  'cta_style',
  'content_mode',
  'content_intensity',
  'seasonality_enabled',
  'comment_induction_style',
  'product_mention_style',
  'emoji_level',
  'safe_debate_enabled',
  'anonymous_learning_enabled',
  'blog_enabled',
  'blog_slug',
  'blog_title',
  'blog_public_url',
  'blog_created_at',
  'blog_auto_publish_enabled',
  'blog_publish_mode',
  'blog_base_url',
  'toss_share_link_enabled',
  'toss_share_link_url',
  'toss_share_link_label',
  'toss_share_link_memo',
  'content_style_note',
  'daily_post_min',
  'daily_post_max',
  'active_time_windows',
  'min_interval_minutes',
  'link_post_ratio',
  'no_link_post_ratio',
  'rest_days_per_week',
  'threads_access_token',
  'threads_user_id',
  'threads_token_expires_at',
  'threads_token_status',
  'threads_link_delivery_mode',
  'threads_connected_at',
  'last_threads_refresh_at',
  'automation_status',
  'automation_started_at',
  'automation_stopped_at',
  'coupang_access_key',
  'coupang_secret_key',
  'coupang_partner_id',
  'coupang_tracking_code',
  'coupang_search_cooldown_until',
  'coupang_search_status',
  'status'
]);

function isMissingSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return ['42703', '42P01'].includes(error?.code)
    || message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find');
}

function missingColumnFromError(error) {
  const message = String(error?.message || '');
  return message.match(/Could not find the '([^']+)' column/i)?.[1]
    || message.match(/column "([^"]+)" of relation "accounts" does not exist/i)?.[1]
    || message.match(/column "([^"]+)" does not exist/i)?.[1]
    || '';
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function sanitizeAccountPayload(payload = {}) {
  return Object.fromEntries(Object.entries(payload || {}).filter(([key, value]) => {
    if (!ACCOUNT_COLUMNS.has(key)) return false;
    if (SENSITIVE_ACCOUNT_KEYS.has(key) && !String(value ?? '').trim()) return false;
    return true;
  }));
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
    next.active_time_windows = [{ start: '09:00', end: '09:00' }];
  }
  next.active_time_windows = next.active_time_windows
    .filter((window) => window?.start && window?.end)
    .map((window) => ({ start: window.start, end: window.end }));
  next.daily_post_min = 0;
  next.daily_post_max = Math.min(MAX_DAILY_POSTS, Math.max(0, toFiniteNumber(next.daily_post_max, 3)));
  next.min_interval_minutes = Math.max(1, toFiniteNumber(next.min_interval_minutes, 90));
  next.link_post_ratio = Math.min(1, Math.max(0, toFiniteNumber(next.link_post_ratio, BALANCED_LINK_RATIO)));
  next.no_link_post_ratio = Math.min(1, Math.max(0, toFiniteNumber(next.no_link_post_ratio, BALANCED_NO_LINK_RATIO)));
  next.rest_days_per_week = Math.min(7, Math.max(0, toFiniteNumber(next.rest_days_per_week, 1)));
  if (!CONTENT_MODES.has(next.content_mode)) next.content_mode = 'auto';
  if (!CONTENT_INTENSITIES.has(next.content_intensity)) next.content_intensity = 'normal';
  if (!COMMENT_STYLES.has(next.comment_induction_style)) next.comment_induction_style = 'soft_question';
  if (!PRODUCT_MENTION_STYLES.has(next.product_mention_style)) next.product_mention_style = 'natural';
  if (!EMOJI_LEVELS.has(next.emoji_level)) next.emoji_level = 'low';
  next.seasonality_enabled = next.seasonality_enabled !== false;
  next.safe_debate_enabled = Boolean(next.safe_debate_enabled);
  next.anonymous_learning_enabled = Boolean(next.anonymous_learning_enabled);
  next.blog_enabled = Boolean(next.blog_enabled);
  next.blog_slug = next.blog_slug == null ? '' : String(next.blog_slug).trim().slice(0, 120);
  next.blog_title = next.blog_title == null ? '' : String(next.blog_title).trim().slice(0, 120);
  next.blog_public_url = next.blog_public_url == null ? '' : String(next.blog_public_url).trim().slice(0, 300);
  next.blog_auto_publish_enabled = Boolean(next.blog_auto_publish_enabled);
  next.blog_publish_mode = ['test_only', 'manual', 'auto'].includes(next.blog_publish_mode) ? next.blog_publish_mode : 'test_only';
  next.blog_base_url = next.blog_base_url == null ? '' : String(next.blog_base_url).trim().slice(0, 300);
  next.toss_share_link_enabled = Boolean(next.toss_share_link_enabled);
  next.toss_share_link_url = next.toss_share_link_url == null ? '' : String(next.toss_share_link_url).trim().slice(0, 500);
  next.toss_share_link_label = next.toss_share_link_label == null ? '' : String(next.toss_share_link_label).trim().slice(0, 80);
  next.toss_share_link_memo = next.toss_share_link_memo == null ? '' : String(next.toss_share_link_memo).trim().slice(0, 500);
  if (!Array.isArray(next.personal_reference_patterns)) next.personal_reference_patterns = [];
  if (next.content_mode === 'safe_debate' && !next.safe_debate_enabled) next.content_mode = 'question';
  next.threads_link_delivery_mode = 'reply';
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
export async function createAccount(payload) {
  const normalized = normalizeAccount({
    platform: 'threads',
    status: 'active',
    automation_status: 'paused',
    forbidden_topics: [],
    forbidden_words: ['100%', '무조건', '완벽', '보장', '치료', '예방', '다이어트 약', '보조제', '가르시니아', '효과 보장', '체중감량 보장'],
    content_mode: 'auto',
    content_intensity: 'normal',
    seasonality_enabled: true,
    comment_induction_style: 'soft_question',
    product_mention_style: 'natural',
    emoji_level: 'low',
    safe_debate_enabled: false,
    anonymous_learning_enabled: false,
    personal_reference_patterns: [],
    blog_enabled: false,
    blog_slug: '',
    blog_title: '',
    blog_public_url: '',
    blog_created_at: null,
    blog_auto_publish_enabled: false,
    blog_publish_mode: 'test_only',
    blog_base_url: '',
    toss_share_link_enabled: false,
    toss_share_link_url: '',
    toss_share_link_label: '',
    toss_share_link_memo: '',
    content_style_note: '',
    daily_post_min: 0,
    daily_post_max: 3,
    active_time_windows: [{ start: '09:00', end: '23:00' }],
    min_interval_minutes: 90,
    threads_link_delivery_mode: 'reply',
    link_post_ratio: BALANCED_LINK_RATIO,
    no_link_post_ratio: BALANCED_NO_LINK_RATIO,
    rest_days_per_week: 1,
    ...sanitizeAccountPayload(payload)
  });
  const insertPayload = { ...normalized };
  const droppedColumns = new Set();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await dbInsert('accounts', insertPayload);
    } catch (error) {
      const missingColumn = isMissingSchemaError(error) ? missingColumnFromError(error) : '';
      if (!missingColumn || droppedColumns.has(missingColumn) || !Object.prototype.hasOwnProperty.call(insertPayload, missingColumn)) {
        if (isMissingSchemaError(error)) {
          const nextError = new Error('계정 생성에 필요한 DB 스키마가 아직 적용되지 않았습니다. 운영 DB 마이그레이션 상태를 확인해주세요.');
          nextError.status = 503;
          nextError.code = 'ACCOUNT_SCHEMA_NOT_READY';
          throw nextError;
        }
        throw error;
      }
      delete insertPayload[missingColumn];
      droppedColumns.add(missingColumn);
    }
  }
  const error = new Error('계정 생성 DB 스키마 확인이 필요합니다.');
  error.status = 503;
  error.code = 'ACCOUNT_SCHEMA_NOT_READY';
  throw error;
}
export const updateAccount = async (id, payload) => {
  const current = await getAccount(id);
  if (!current) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const sanitized = sanitizeAccountPayload(payload);
  const normalized = normalizeAccount({ ...current, ...sanitized });
  const patch = Object.fromEntries(Object.keys(sanitized).map((key) => [key, normalized[key]]));
  if (Object.keys(patch).length === 0) return current;
  let updatedRows;
  try {
    updatedRows = await dbUpdate('accounts', { id }, patch);
  } catch (error) {
    if (isMissingSchemaError(error)) {
      const nextError = new Error('계정 설정 저장 준비가 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      nextError.status = 503;
      nextError.code = 'ACCOUNT_SCHEMA_NOT_READY';
      throw nextError;
    }
    throw error;
  }
  const [updated] = updatedRows;
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
