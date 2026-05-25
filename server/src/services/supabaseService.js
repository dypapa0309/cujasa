import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { redactSensitivePayload } from './redactionService.js';

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const DB_CIRCUIT_BREAKER_MS = Math.max(0, Number(process.env.DB_CIRCUIT_BREAKER_MS || 60_000));
let dbCircuitOpenUntil = 0;
let dbCircuitReason = '';

const now = () => new Date().toISOString();
const projectId = randomUUID();
const accountIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const tables = {
  projects: [{
    id: projectId,
    name: '쿠팡 파트너스 자동화',
    type: 'coupang',
    description: '계정별 쿠팡 파트너스 자동 포스팅 MVP',
    status: 'active',
    created_at: now(),
    updated_at: now()
  }],
  accounts: ['자취 꿀템', '육아 꿀템', '직장인 꿀템', '살림 꿀템'].map((name, index) => ({
    id: accountIds[index],
    project_id: projectId,
    name,
    platform: 'threads',
    account_handle: '',
    target_audience: index === 1 ? '육아 중인 부모' : index === 2 ? '직장인' : index === 3 ? '살림 관심 사용자' : '20대 자취생',
    content_scope: name.replace(' 꿀템', '') + ' 생활 문제와 쿠팡 상품 연결',
    forbidden_topics: [],
    forbidden_words: ['100%', '무조건', '완벽', '보장', '치료', '예방', '다이어트 약', '보조제', '가르시니아', '효과 보장', '체중감량 보장'],
    tone: '친근하고 실제 후기처럼 짧게',
    cta_style: '댓글 유도형',
    content_mode: 'question',
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
    active_time_windows: [{ start: '09:00', end: '11:00' }, { start: '20:00', end: '23:00' }],
    min_interval_minutes: 50,
    link_post_ratio: 0.9,
    no_link_post_ratio: 0.1,
    rest_days_per_week: 1,
    coupang_search_status: 'ok',
    coupang_search_cooldown_until: null,
    threads_link_delivery_mode: 'reply',
    status: 'active',
    automation_status: 'paused',
    created_at: now(),
    updated_at: now()
  })),
  topics: [],
  coupang_products: [],
  coupang_search_locks: [],
  posts: [],
  post_products: [],
  cta_variants: [],
  tracking_links: [],
  click_events: [],
  post_queue: [],
  pipeline_runs: [],
  scheduler_runs: [],
  post_metrics_jobs: [],
  post_metrics: [],
  automation_studio_campaigns: [],
  automation_studio_assets: [],
  automation_studio_queue_links: [],
  automation_studio_lead_forms: [],
  automation_studio_lead_submissions: [],
  threads_connection_requests: [],
  sponsor_campaigns: [
    {
      id: 'sponsor-jasain-default',
      name: 'JASAIN 자체 홍보',
      product_name: 'JASAIN',
      destination_url: 'https://jasain.kr',
      category: 'automation',
      label_text: '[광고]',
      comment_text: '[광고] Threads 자동화 수익 플랫폼 JASAIN · https://jasain.kr',
      active: true,
      created_at: now(),
      updated_at: now()
    }
  ],
  trend_reference_patterns: [],
  activity_logs: [],
  account_conflict_audits: [],
  notifications: [],
  announcements: [],
  users: [],
  user_accounts: [],
  jasain_products: [
    {
      id: 'cujasa',
      name: 'CUJASA',
      description: '쿠팡 파트너스 자동화 콘솔',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/cujasa',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'dexor',
      name: 'DEXOR',
      description: '블로그 분석 및 선정 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/dexor',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'spread',
      name: 'SPREAD',
      description: '추천 캠페인 운영 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/spread',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'polibot',
      name: 'POLIBOT',
      description: '보험 보장분석 및 상품 추천 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/polibot',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'infludex',
      name: 'INFLUDEX',
      description: '인스타그램 인플루언서 등급 분석',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/infludex',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'sublog',
      name: 'SUBLOG',
      description: '구독 비용 관리',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/sublog',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'auvibot',
      name: 'AUVIBOT',
      description: '상품 쇼츠 생산 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://store.jasain.kr/store/auvibot',
      status: 'active',
      created_at: now(),
      updated_at: now()
    }
  ],
  user_products: [],
  polibot_ingest_jobs: [],
  polibot_knowledge_sources: [],
  polibot_knowledge_chunks: [],
  polibot_catalog_items: [],
  catalog_items: [],
  premium_examples: [],
  parsed_documents: [],
  polibot_conversation_insights: [],
  polibot_recommendation_feedback: [],
  sublog_subscriptions: [],
  billing_products: [
    {
      id: 'sponsored_monthly_19000',
      app_product_id: 'cujasa',
      name: 'CUJASA 스폰서 스타터',
      plan: 'monthly',
      amount: 19000,
      billing_cycle: 'monthly',
      max_accounts: 1,
      active: false,
      created_at: now()
    },
    {
      id: 'onetime_590000',
      app_product_id: 'cujasa',
      name: 'CUJASA 프로 영구구매',
      plan: 'onetime',
      amount: 590000,
      billing_cycle: 'once',
      max_accounts: 4,
      active: true,
      created_at: now()
    },
    {
      id: 'monthly_59000',
      app_product_id: 'cujasa',
      name: 'CUJASA 베이직 월정액',
      plan: 'monthly',
      amount: 129000,
      billing_cycle: 'monthly',
      max_accounts: 2,
      active: true,
      created_at: now()
    },
    {
      id: 'monthly_129000',
      app_product_id: 'cujasa',
      name: 'CUJASA 베이직 월정액(판매 중단)',
      plan: 'monthly',
      amount: 129000,
      billing_cycle: 'monthly',
      max_accounts: 2,
      active: false,
      created_at: now()
    },
    {
      id: 'dexor_credit_5000',
      app_product_id: 'dexor',
      name: 'DEXOR 크레딧 10회 충전',
      plan: 'onetime',
      amount: 5000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'dexor_credit_10000',
      app_product_id: 'dexor',
      name: 'DEXOR 크레딧 25회 충전',
      plan: 'onetime',
      amount: 10000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'dexor_credit_50000',
      app_product_id: 'dexor',
      name: 'DEXOR 크레딧 150회 충전',
      plan: 'onetime',
      amount: 50000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'dexor_credit_100000',
      app_product_id: 'dexor',
      name: 'DEXOR 크레딧 350회 충전',
      plan: 'onetime',
      amount: 100000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'infludex_credit_5000',
      app_product_id: 'infludex',
      name: 'INFLUDEX 라이트 분석 30회',
      plan: 'onetime',
      amount: 5000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'infludex_credit_10000',
      app_product_id: 'infludex',
      name: 'INFLUDEX 베이직 분석 100회',
      plan: 'onetime',
      amount: 10000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'infludex_credit_50000',
      app_product_id: 'infludex',
      name: 'INFLUDEX 프로 분석 250회',
      plan: 'onetime',
      amount: 50000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'spread_starter_monthly_49000',
      app_product_id: 'spread',
      name: 'SPREAD 스타터 월정액',
      plan: 'monthly',
      amount: 49000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'spread_basic_monthly_149000',
      app_product_id: 'spread',
      name: 'SPREAD 베이직 월정액',
      plan: 'monthly',
      amount: 149000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'spread_pro_monthly_390000',
      app_product_id: 'spread',
      name: 'SPREAD 프로 월정액',
      plan: 'monthly',
      amount: 390000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'polibot_starter_monthly_39000',
      app_product_id: 'polibot',
      name: 'POLIBOT 스타터 월정액',
      plan: 'monthly',
      amount: 29000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'polibot_basic_monthly_99000',
      app_product_id: 'polibot',
      name: 'POLIBOT 베이직 월정액',
      plan: 'monthly',
      amount: 79000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'polibot_pro_monthly_290000',
      app_product_id: 'polibot',
      name: 'POLIBOT 프로 월정액',
      plan: 'monthly',
      amount: 290000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: false,
      created_at: now()
    },
    {
      id: 'polibot_lifetime_590000',
      app_product_id: 'polibot',
      name: 'POLIBOT 프로 영구구매',
      plan: 'onetime',
      amount: 590000,
      billing_cycle: 'once',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'sublog_starter_monthly_49000',
      app_product_id: 'sublog',
      name: 'SUBLOG 스타터 월정액',
      plan: 'monthly',
      amount: 49000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    },
    {
      id: 'auvibot_starter_monthly_49000',
      app_product_id: 'auvibot',
      name: 'AUVIBOT 스타터 월정액',
      plan: 'monthly',
      amount: 49000,
      billing_cycle: 'monthly',
      max_accounts: 0,
      active: true,
      created_at: now()
    }
  ],
  billing_payments: [],
  billing_subscriptions: [],
  billing_agreements: [],
  blog_posts: [],
  setup_tasks: [],
  purchase_inquiries: [],
  system_settings: []
};

const matches = (row, filters) => Object.entries(filters).every(([key, value]) => row[key] === value);
const advancedFilterKeys = ['gte', 'lte', 'gt', 'lt', 'neq', 'in'];
const compareValues = (left, right) => {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
};
const matchesAdvancedFilters = (row, options = {}) => advancedFilterKeys.every((operator) => {
  const clauses = options[operator] || {};
  return Object.entries(clauses).every(([key, value]) => {
    const rowValue = row[key];
    if (operator === 'in') return Array.isArray(value) ? value.includes(rowValue) : false;
    if (operator === 'neq') return rowValue !== value;
    const compared = compareValues(rowValue, value);
    if (operator === 'gte') return compared >= 0;
    if (operator === 'lte') return compared <= 0;
    if (operator === 'gt') return compared > 0;
    if (operator === 'lt') return compared < 0;
    return true;
  });
});
const sortRows = (rows, column, ascending = true) => [...rows].sort((a, b) => {
  const av = a[column] ?? '';
  const bv = b[column] ?? '';
  return ascending ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
});

const updatedAtTables = new Set([
  'projects',
  'accounts',
  'coupang_search_locks',
  'posts',
  'post_queue',
  'pipeline_runs',
  'post_metrics_jobs',
  'automation_studio_campaigns',
  'automation_studio_assets',
  'automation_studio_lead_forms',
  'automation_studio_lead_submissions',
  'threads_connection_requests',
  'sponsor_campaigns',
  'trend_reference_patterns',
  'blog_posts',
  'notifications',
  'announcements',
  'users',
  'user_accounts',
  'jasain_products',
  'user_products',
  'polibot_ingest_jobs',
  'polibot_knowledge_sources',
  'polibot_knowledge_chunks',
  'polibot_catalog_items',
  'catalog_items',
  'premium_examples',
  'parsed_documents',
  'polibot_conversation_insights',
  'polibot_recommendation_feedback',
  'scheduler_runs',
  'billing_payments',
  'billing_subscriptions',
  'billing_agreements',
  'setup_tasks',
  'system_settings'
]);

function stampUpdate(table, patch) {
  return updatedAtTables.has(table)
    ? { ...patch, updated_at: now() }
    : { ...patch };
}

function isTransientSupabaseFailure(error = {}) {
  const message = String(error.message || error || '');
  return /522: Connection timed out|Connection timed out|Cloudflare|fetch failed|network timeout|timeout/i.test(message);
}

function unavailableDbError(reason = '') {
  const error = new Error('현재 데이터베이스 연결이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
  error.status = 503;
  error.code = 'SUPABASE_UNAVAILABLE';
  error.reason = reason || dbCircuitReason || null;
  return error;
}

function assertDbCircuitClosed() {
  if (!supabase || DB_CIRCUIT_BREAKER_MS <= 0) return;
  if (Date.now() < dbCircuitOpenUntil) throw unavailableDbError();
}

function markDbCircuit(error) {
  if (!supabase || DB_CIRCUIT_BREAKER_MS <= 0 || !isTransientSupabaseFailure(error)) return;
  dbCircuitOpenUntil = Date.now() + DB_CIRCUIT_BREAKER_MS;
  dbCircuitReason = String(error.message || error || '').slice(0, 240);
}

function normalizeDbError(error) {
  markDbCircuit(error);
  if (isTransientSupabaseFailure(error)) {
    const next = unavailableDbError(String(error.message || error || '').slice(0, 240));
    next.cause = error;
    return next;
  }
  return error;
}

export async function dbList(table, filters = {}, options = {}) {
  if (supabase) {
    assertDbCircuitClosed();
    let q = supabase.from(table).select(options.select || '*');
    Object.entries(filters).forEach(([key, value]) => {
      q = value === null ? q.is(key, null) : q.eq(key, value);
    });
    Object.entries(options.gte || {}).forEach(([key, value]) => { q = q.gte(key, value); });
    Object.entries(options.lte || {}).forEach(([key, value]) => { q = q.lte(key, value); });
    Object.entries(options.gt || {}).forEach(([key, value]) => { q = q.gt(key, value); });
    Object.entries(options.lt || {}).forEach(([key, value]) => { q = q.lt(key, value); });
    Object.entries(options.neq || {}).forEach(([key, value]) => { q = q.neq(key, value); });
    Object.entries(options.in || {}).forEach(([key, value]) => { q = q.in(key, Array.isArray(value) ? value : [value]); });
    if (options.or) q = q.or(options.or);
    if (options.order) q = q.order(options.order, { ascending: options.ascending ?? false });
    if (options.limit) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) throw normalizeDbError(error);
    return data;
  }
  let rows = (tables[table] || [])
    .filter((row) => matches(row, filters))
    .filter((row) => matchesAdvancedFilters(row, options));
  if (options.order) rows = sortRows(rows, options.order, options.ascending ?? false);
  if (options.limit) rows = rows.slice(0, options.limit);
  return rows;
}

export async function dbGet(table, filters = {}) {
  const rows = await dbList(table, filters, { limit: 1 });
  return rows[0] || null;
}

export async function dbInsert(table, payload) {
  const rows = Array.isArray(payload) ? payload : [payload];
  const stamped = rows.map((row) => ({ id: row.id || randomUUID(), created_at: row.created_at || now(), ...row }));
  if (supabase) {
    assertDbCircuitClosed();
    const { data, error } = await supabase.from(table).insert(stamped).select();
    if (error) throw normalizeDbError(error);
    return Array.isArray(payload) ? data : data[0];
  }
  tables[table].push(...stamped);
  return Array.isArray(payload) ? stamped : stamped[0];
}

export async function dbUpdate(table, filters, patch) {
  const stamped = stampUpdate(table, patch);
  if (supabase) {
    assertDbCircuitClosed();
    const { data, error } = await supabase.from(table).update(stamped).match(filters).select();
    if (error) throw normalizeDbError(error);
    return data;
  }
  const rows = tables[table] || [];
  const changed = [];
  rows.forEach((row) => {
    if (matches(row, filters)) {
      Object.assign(row, stamped);
      changed.push(row);
    }
  });
  return changed;
}

export async function dbDelete(table, filters) {
  if (supabase) {
    assertDbCircuitClosed();
    const { error } = await supabase.from(table).delete().match(filters);
    if (error) throw normalizeDbError(error);
    return true;
  }
  tables[table] = (tables[table] || []).filter((row) => !matches(row, filters));
  return true;
}

const activityKeyAliases = {
  accountId: 'account_id',
  projectId: 'project_id',
  postId: 'post_id',
  queueId: 'queue_id',
  userId: 'user_id',
  pipelineRunId: 'pipeline_run_id'
};

export function normalizeActivityPayload(payload = {}) {
  const normalized = {};
  Object.entries(payload).forEach(([key, value]) => {
    normalized[activityKeyAliases[key] || key] = value;
  });
  return redactSensitivePayload(normalized);
}

export async function logActivity(payload) {
  const normalized = normalizeActivityPayload(payload);
  return dbInsert('activity_logs', {
    level: 'info',
    ...normalized,
    payload: redactSensitivePayload(normalized.payload || {})
  });
}

export async function safeLogActivity(payload) {
  try {
    return await logActivity(payload);
  } catch (error) {
    if (/user_id.*activity_logs|activity_logs.*user_id/i.test(error?.message || '')) {
      const { user_id, userId, ...withoutUserId } = payload || {};
      try {
        return await logActivity(withoutUserId);
      } catch {
        // Fall through to the compact warning below.
      }
    }
    console.warn('[activity_logs] failed to write log', error?.message || error);
    return null;
  }
}
