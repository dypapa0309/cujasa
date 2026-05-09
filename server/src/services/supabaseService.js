import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { redactSensitivePayload } from './redactionService.js';

const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

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
    link_post_ratio: 0.67,
    no_link_post_ratio: 0.33,
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
      landing_url: 'https://jasain.kr/cujasa',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'dexor',
      name: 'DEXOR',
      description: '블로그 분석 및 선정 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://jasain.kr/dexor',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'spread',
      name: 'SPREAD',
      description: '추천 캠페인 운영 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://jasain.kr',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'polibot',
      name: 'POLIBOT',
      description: '보험 보장분석 및 상품 추천 자동화',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://jasain.kr/polibot',
      status: 'active',
      created_at: now(),
      updated_at: now()
    },
    {
      id: 'infludex',
      name: 'INFLUDEX',
      description: '인스타그램 인플루언서 등급 분석',
      app_url: 'https://app.jasain.kr',
      landing_url: 'https://jasain.kr/infludex',
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
  polibot_conversation_insights: [],
  polibot_recommendation_feedback: [],
  billing_products: [
    {
      id: 'onetime_590000',
      app_product_id: 'cujasa',
      name: 'CUJASA 베이직 일시불',
      plan: 'onetime',
      amount: 590000,
      billing_cycle: 'once',
      max_accounts: 2,
      active: true,
      created_at: now()
    },
    {
      id: 'monthly_59000',
      app_product_id: 'cujasa',
      name: 'CUJASA 베이직 월정액',
      plan: 'monthly',
      amount: 59000,
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
    }
  ],
  billing_payments: [],
  billing_subscriptions: [],
  billing_agreements: [],
  blog_posts: [],
  setup_tasks: [],
  purchase_inquiries: []
};

const matches = (row, filters) => Object.entries(filters).every(([key, value]) => row[key] === value);
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
  'polibot_conversation_insights',
  'polibot_recommendation_feedback',
  'scheduler_runs',
  'billing_payments',
  'billing_subscriptions',
  'billing_agreements',
  'setup_tasks'
]);

function stampUpdate(table, patch) {
  return updatedAtTables.has(table)
    ? { ...patch, updated_at: now() }
    : { ...patch };
}

export async function dbList(table, filters = {}, options = {}) {
  if (supabase) {
    let q = supabase.from(table).select(options.select || '*');
    Object.entries(filters).forEach(([key, value]) => {
      q = value === null ? q.is(key, null) : q.eq(key, value);
    });
    if (options.order) q = q.order(options.order, { ascending: options.ascending ?? false });
    if (options.limit) q = q.limit(options.limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  }
  let rows = (tables[table] || []).filter((row) => matches(row, filters));
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
    const { data, error } = await supabase.from(table).insert(stamped).select();
    if (error) throw error;
    return Array.isArray(payload) ? data : data[0];
  }
  tables[table].push(...stamped);
  return Array.isArray(payload) ? stamped : stamped[0];
}

export async function dbUpdate(table, filters, patch) {
  const stamped = stampUpdate(table, patch);
  if (supabase) {
    const { data, error } = await supabase.from(table).update(stamped).match(filters).select();
    if (error) throw error;
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
    const { error } = await supabase.from(table).delete().match(filters);
    if (error) throw error;
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
    console.warn('[activity_logs] failed to write log', error?.message || error);
    return null;
  }
}
