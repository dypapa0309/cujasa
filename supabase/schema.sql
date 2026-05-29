create extension if not exists "pgcrypto";

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('coupang', 'spread', 'custom')),
  description text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  platform text not null default 'threads',
  account_handle text,
  target_audience text,
  content_scope text,
  forbidden_topics jsonb not null default '[]',
  forbidden_words jsonb not null default '[]',
  tone text,
  cta_style text,
  content_mode text not null default 'question' check (content_mode in ('auto', 'daily', 'empathy', 'problem_solution', 'checklist', 'question', 'safe_debate')),
  content_intensity text not null default 'normal' check (content_intensity in ('soft', 'normal', 'strong')),
  seasonality_enabled boolean not null default true,
  comment_induction_style text not null default 'soft_question' check (comment_induction_style in ('none', 'soft_question', 'experience_question', 'choice_question')),
  product_mention_style text not null default 'natural' check (product_mention_style in ('none', 'natural', 'direct')),
  emoji_level text not null default 'low' check (emoji_level in ('none', 'low', 'medium')),
  safe_debate_enabled boolean not null default false,
  anonymous_learning_enabled boolean not null default false,
  personal_reference_patterns jsonb not null default '[]',
  blog_enabled boolean not null default false,
  blog_slug text,
  blog_title text,
  blog_public_url text,
  blog_created_at timestamptz,
  blog_auto_publish_enabled boolean not null default false,
  blog_publish_mode text not null default 'test_only',
  blog_base_url text,
  toss_share_link_enabled boolean not null default false,
  toss_share_link_url text,
  toss_share_link_label text,
  toss_share_link_memo text,
  content_style_note text,
  daily_post_min int not null default 0,
  daily_post_max int not null default 3,
  active_time_windows jsonb not null default '[{"start":"09:00","end":"11:00"},{"start":"20:00","end":"23:00"}]',
  min_interval_minutes int not null default 50,
  link_post_ratio numeric not null default 0.9,
  no_link_post_ratio numeric not null default 0.1,
  rest_days_per_week int not null default 1,
  threads_access_token text,
  threads_user_id text,
  threads_token_expires_at timestamptz,
  threads_token_status text not null default 'not_connected',
  threads_link_delivery_mode text default 'reply' check (threads_link_delivery_mode = 'reply'),
  threads_connected_at timestamptz,
  last_threads_refresh_at timestamptz,
  automation_status text not null default 'paused' check (automation_status in ('running', 'paused')),
  automation_started_at timestamptz,
  automation_stopped_at timestamptz,
  coupang_access_key text,
  coupang_secret_key text,
  coupang_partner_id text,
  coupang_tracking_code text,
  coupang_search_cooldown_until timestamptz,
  coupang_search_status text default 'ok' check (coupang_search_status in ('ok', 'rate_limited', 'credentials_missing', 'api_error')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table accounts add column if not exists threads_user_id text;
alter table accounts add column if not exists threads_token_expires_at timestamptz;
alter table accounts add column if not exists threads_token_status text not null default 'not_connected';
alter table accounts add column if not exists threads_link_delivery_mode text default 'reply';
alter table accounts add column if not exists threads_connected_at timestamptz;
alter table accounts add column if not exists last_threads_refresh_at timestamptz;
alter table accounts add column if not exists automation_status text not null default 'paused';
alter table accounts add column if not exists automation_started_at timestamptz;
alter table accounts add column if not exists automation_stopped_at timestamptz;
alter table accounts add column if not exists coupang_access_key text;
alter table accounts add column if not exists coupang_secret_key text;
alter table accounts add column if not exists coupang_partner_id text;
alter table accounts add column if not exists coupang_tracking_code text;
alter table accounts add column if not exists coupang_search_cooldown_until timestamptz;
alter table accounts add column if not exists coupang_search_status text default 'ok';
alter table accounts add column if not exists content_mode text not null default 'question';
alter table accounts alter column content_mode set default 'question';
alter table accounts
  drop constraint if exists accounts_content_mode_check;
alter table accounts
  add constraint accounts_content_mode_check
  check (content_mode in ('auto', 'daily', 'empathy', 'problem_solution', 'checklist', 'question', 'safe_debate'));
alter table accounts add column if not exists content_intensity text not null default 'normal';
alter table accounts add column if not exists seasonality_enabled boolean not null default true;
alter table accounts add column if not exists comment_induction_style text not null default 'soft_question';
alter table accounts add column if not exists product_mention_style text not null default 'natural';
alter table accounts add column if not exists emoji_level text not null default 'low';
alter table accounts add column if not exists safe_debate_enabled boolean not null default false;
alter table accounts add column if not exists anonymous_learning_enabled boolean not null default false;
alter table accounts add column if not exists personal_reference_patterns jsonb not null default '[]';
alter table accounts add column if not exists blog_enabled boolean not null default false;
alter table accounts add column if not exists blog_slug text;
alter table accounts add column if not exists blog_title text;
alter table accounts add column if not exists blog_public_url text;
alter table accounts add column if not exists blog_created_at timestamptz;
alter table accounts add column if not exists blog_auto_publish_enabled boolean not null default false;
alter table accounts add column if not exists blog_publish_mode text not null default 'test_only';
alter table accounts add column if not exists blog_base_url text;
alter table accounts add column if not exists toss_share_link_enabled boolean not null default false;
alter table accounts add column if not exists toss_share_link_url text;
alter table accounts add column if not exists toss_share_link_label text;
alter table accounts add column if not exists toss_share_link_memo text;
alter table accounts add column if not exists content_style_note text;
alter table accounts alter column daily_post_min set default 0;
alter table accounts alter column daily_post_max set default 3;
alter table accounts alter column active_time_windows set default '[{"start":"09:00","end":"11:00"},{"start":"20:00","end":"23:00"}]'::jsonb;
alter table accounts alter column min_interval_minutes set default 50;
alter table accounts alter column link_post_ratio set default 0.9;
alter table accounts alter column no_link_post_ratio set default 0.1;
create unique index if not exists idx_accounts_blog_slug
  on accounts(blog_slug)
  where blog_slug is not null;
update accounts
set
  daily_post_min = 0,
  daily_post_max = least(
    greatest(coalesce(daily_post_max, 3), 0),
    5
  );

alter table accounts drop constraint if exists accounts_link_post_ratio_limit_check;
alter table accounts drop constraint if exists accounts_no_link_post_ratio_limit_check;

alter table accounts drop constraint if exists accounts_daily_post_limits_check;
alter table accounts add constraint accounts_daily_post_limits_check
  check (daily_post_min = 0 and daily_post_max >= 0 and daily_post_max <= 5);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  angle text,
  target_user text,
  reason text,
  expected_intent text,
  search_keywords jsonb not null default '[]',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists coupang_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  keyword text,
  product_id text,
  product_name text,
  product_price numeric,
  product_image text,
  product_url text,
  partner_url text,
  category_name text,
  is_fallback boolean not null default false,
  raw_data jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists coupang_search_locks (
  account_id uuid primary key references accounts(id) on delete cascade,
  next_allowed_at timestamptz not null default now(),
  last_keyword text,
  last_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coupang_search_locks_next_allowed_at
  on coupang_search_locks(next_allowed_at);

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  content_type text,
  body text not null,
  risk_level text not null default 'low',
  status text not null default 'draft',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trend_reference_patterns (
  id uuid primary key default gen_random_uuid(),
  category text,
  target_audience_hint text,
  hook_pattern text not null,
  comment_question_pattern text,
  tension_type text,
  emotion_signal text,
  reusable_structure text,
  voice_pattern text,
  format_pattern text,
  line_break_pattern text,
  list_structure text,
  punctuation_style text,
  tone_register text,
  performance_score int not null default 0,
  quality_score int not null default 0,
  analysis_profile jsonb not null default '{}',
  preview_posts jsonb not null default '[]',
  safety_flags jsonb not null default '[]',
  source_type text not null default 'text_paste' check (source_type in ('text_paste', 'screenshot_ocr', 'admin_seed')),
  quality_status text not null default 'candidate' check (quality_status in ('candidate', 'approved', 'rejected')),
  source_fingerprint text,
  usage_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trend_reference_patterns_status_category
  on trend_reference_patterns(quality_status, category, performance_score desc);

create index if not exists idx_trend_reference_patterns_quality
  on trend_reference_patterns(quality_status, quality_score desc, performance_score desc);

create unique index if not exists idx_trend_reference_patterns_source_fingerprint
  on trend_reference_patterns(source_fingerprint)
  where source_fingerprint is not null;

create table if not exists post_products (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete set null,
  topic_id uuid references topics(id) on delete cascade,
  product_id uuid references coupang_products(id) on delete cascade,
  fit_score int,
  recommendation_reason text,
  rank int,
  created_at timestamptz not null default now()
);

create table if not exists cta_variants (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  cta_text text not null,
  variant_key text not null,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists tracking_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  product_id uuid references coupang_products(id) on delete set null,
  destination_url text not null,
  link_type text not null check (link_type in ('coupang', 'fallback', 'spread', 'custom')),
  created_at timestamptz not null default now()
);

create table if not exists click_events (
  id uuid primary key default gen_random_uuid(),
  tracking_link_id uuid references tracking_links(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  product_id uuid references coupang_products(id) on delete set null,
  ip_hash text,
  user_agent text,
  referrer text,
  created_at timestamptz not null default now()
);

create table if not exists post_queue (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  platform text not null default 'threads',
  scheduled_at timestamptz,
  posted_at timestamptz,
  post_url text,
  status text not null check (status in ('scheduled', 'posting', 'posted', 'failed', 'retry', 'manual_required', 'skipped')),
  retry_count int not null default 0,
  post_mode text not null default 'auto' check (post_mode in ('auto', 'link', 'no_link', 'sponsored_comment')),
  error_message text,
  error_category text,
  customer_hidden_at timestamptz,
  customer_hidden_reason text,
  selected_cta_id uuid references cta_variants(id) on delete set null,
  tracking_link_id uuid references tracking_links(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists threads_connection_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  threads_handle text not null,
  status text not null default 'requested' check (status in ('requested', 'meta_registered', 'customer_action_required', 'connected', 'canceled')),
  request_memo text,
  admin_memo text,
  meta_registered_at timestamptz,
  connected_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_threads_connection_requests_account
  on threads_connection_requests(account_id, created_at desc);
create index if not exists idx_threads_connection_requests_status
  on threads_connection_requests(status, created_at desc);

create table if not exists automation_studio_campaigns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  name text not null,
  product_name text not null,
  product_url text,
  product_price numeric,
  product_image_url text,
  objective_type text not null default 'click' check (objective_type in ('click', 'consultation', 'save_follow', 'awareness', 'lead')),
  target_goal text not null,
  target_audience text,
  account_handle text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  operation_set jsonb not null default '{}',
  next_action_note text,
  platforms jsonb not null default '["threads","instagram"]',
  daily_post_min int not null default 1,
  daily_post_max int not null default 3,
  days int not null default 3,
  status text not null default 'draft' check (status in ('draft', 'running', 'needs_review', 'stopped', 'completed')),
  generation_input jsonb not null default '{}',
  summary jsonb not null default '{}',
  started_at timestamptz,
  stopped_at timestamptz,
  completed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_studio_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references automation_studio_campaigns(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  platform text not null check (platform in ('threads', 'instagram')),
  asset_type text not null check (asset_type in ('text', 'image_card', 'caption')),
  status text not null default 'preview' check (status in ('draft', 'preview', 'needs_review', 'approved', 'queued', 'posted', 'rejected', 'stopped')),
  title text,
  body text,
  cta text,
  image_data_url text,
  metadata jsonb not null default '{}',
  operation_note text,
  reusable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_studio_queue_links (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references automation_studio_campaigns(id) on delete cascade,
  asset_id uuid references automation_studio_assets(id) on delete set null,
  queue_id uuid references post_queue(id) on delete cascade,
  post_id uuid references posts(id) on delete set null,
  platform text not null check (platform in ('threads', 'instagram')),
  status text not null default 'scheduled' check (status in ('scheduled', 'posted', 'manual_required', 'skipped', 'stopped')),
  created_at timestamptz not null default now()
);

create index if not exists idx_automation_studio_campaigns_status
  on automation_studio_campaigns(status, created_at desc);

create index if not exists idx_automation_studio_assets_campaign
  on automation_studio_assets(campaign_id, platform, created_at);

create index if not exists idx_automation_studio_queue_links_campaign
  on automation_studio_queue_links(campaign_id, platform, status);

create table if not exists automation_studio_lead_forms (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references automation_studio_campaigns(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  slug text not null unique,
  title text not null,
  offer text,
  fields jsonb not null default '["name","phone"]',
  privacy_note text,
  thank_you_message text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  public_url text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_studio_lead_submissions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references automation_studio_lead_forms(id) on delete cascade,
  campaign_id uuid references automation_studio_campaigns(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  payload jsonb not null default '{}',
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'closed', 'spam')),
  source_url text,
  user_agent text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_studio_lead_forms_campaign
  on automation_studio_lead_forms(campaign_id, status);

create index if not exists idx_automation_studio_lead_submissions_campaign
  on automation_studio_lead_submissions(campaign_id, created_at desc);

create table if not exists pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  account_id uuid references accounts(id) on delete cascade,
  requested_by text,
  status text not null check (status in ('running', 'completed', 'failed', 'skipped', 'expired')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  result jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_pipeline_runs_one_running_per_account
  on pipeline_runs(account_id)
  where status = 'running';

create table if not exists post_metrics_jobs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  queue_id uuid references post_queue(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  platform text not null,
  post_url text,
  snapshot_type text not null check (snapshot_type in ('24h', '72h', '7d')),
  scheduled_at timestamptz not null,
  executed_at timestamptz,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists post_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  product_id uuid references coupang_products(id) on delete set null,
  cta_variant_id uuid references cta_variants(id) on delete set null,
  measured_at timestamptz not null,
  hours_after_post int,
  impressions int,
  likes int,
  comments int,
  clicks int not null default 0,
  revenue numeric,
  source text not null default 'tracking',
  created_at timestamptz not null default now()
);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  account_id uuid references accounts(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  post_id uuid references posts(id) on delete set null,
  action text not null,
  level text not null default 'info',
  message text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  channel text not null,
  message text not null,
  payload jsonb not null default '{}',
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'inactive')),
  audience text not null default 'all' check (audience in ('all')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_active on announcements(status, created_at desc);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  username text,
  password_hash text not null,
  buyer_name text,
  phone text,
  privacy_consent_at timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended')),
  max_accounts int not null default 2,
  plan text default 'free',
  billing_status text not null default 'none' check (billing_status in ('none', 'pending', 'paid', 'active', 'past_due', 'canceled')),
  paid_until timestamptz,
  free_post_limit integer not null default 5,
  free_post_used integer not null default 0,
  trial_blocked_at timestamptz,
  archived_at timestamptz,
  archived_reason text,
  archived_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users alter column max_accounts set default 2;
alter table users add column if not exists username text;
alter table users add column if not exists buyer_name text;
alter table users add column if not exists phone text;
alter table users add column if not exists privacy_consent_at timestamptz;
alter table users add column if not exists plan text;
alter table users alter column plan set default 'free';
alter table users add column if not exists billing_status text not null default 'none';
alter table users add column if not exists paid_until timestamptz;
alter table users add column if not exists free_post_limit integer not null default 5;
alter table users alter column free_post_limit set default 5;
alter table users add column if not exists free_post_used integer not null default 0;
alter table users add column if not exists trial_blocked_at timestamptz;
alter table users add column if not exists archived_at timestamptz;
alter table users add column if not exists archived_reason text;
alter table users add column if not exists archived_by text;
update users
set
  free_post_limit = greatest(coalesce(free_post_limit, 5), 5),
  free_post_used = coalesce(free_post_used, 0),
  trial_blocked_at = case
    when coalesce(free_post_used, 0) < 5 then null
    else trial_blocked_at
  end;

create unique index if not exists idx_users_username_unique
  on users(lower(username))
  where username is not null and username <> '';

alter table users drop constraint if exists users_plan_check;
alter table users add constraint users_plan_check
  check (plan is null or plan in ('free', 'onetime', 'monthly'));

create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, account_id)
);

create table if not exists jasain_products (
  id text primary key,
  name text not null,
  description text,
  app_url text,
  landing_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into jasain_products (id, name, description, app_url, landing_url, status)
values
  ('cujasa', 'CUJASA', '쿠팡 파트너스 자동화 콘솔', 'https://app.jasain.kr', 'https://jasain.kr/cujasa', 'active'),
  ('dexor', 'DEXOR', '블로그 분석 및 선정 자동화', 'https://app.jasain.kr', 'https://jasain.kr/dexor', 'active'),
  ('spread', 'SPREAD', '추천 캠페인 운영 자동화', 'https://app.jasain.kr', 'https://jasain.kr', 'active'),
  ('polibot', 'POLIBOT', '보험 보장분석 및 상품 추천 자동화', 'https://app.jasain.kr', 'https://app.jasain.kr/polibot?mode=register#tab=beta', 'active'),
  ('infludex', 'INFLUDEX', '인스타그램 인플루언서 등급 분석', 'https://app.jasain.kr', 'https://app.jasain.kr/infludex?mode=register#tab=beta', 'active')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  app_url = excluded.app_url,
  landing_url = excluded.landing_url,
  status = excluded.status,
  updated_at = now();

create table if not exists user_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id text not null references jasain_products(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'trial', 'expired')),
  role text not null default 'customer' check (role in ('customer', 'manager', 'admin')),
  settings jsonb not null default '{}',
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, product_id)
);

alter table user_products add column if not exists settings jsonb not null default '{}';

insert into user_products (user_id, product_id, status, role)
select id, 'cujasa', 'active', 'customer'
from users
on conflict (user_id, product_id) do nothing;

create table if not exists billing_products (
  id text primary key,
  app_product_id text not null default 'cujasa',
  name text not null,
  plan text not null check (plan in ('onetime', 'monthly')),
  amount int not null,
  billing_cycle text not null check (billing_cycle in ('once', 'monthly')),
  max_accounts int not null default 2,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table billing_products add column if not exists app_product_id text not null default 'cujasa';

insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('sponsored_monthly_19000', 'cujasa', 'CUJASA 스폰서 스타터', 'monthly', 19000, 'monthly', 1, true),
  ('onetime_590000', 'cujasa', 'CUJASA 프로 1년 이용', 'onetime', 590000, 'once', 4, true),
  ('monthly_59000', 'cujasa', 'CUJASA 베이직 월정액', 'monthly', 129000, 'monthly', 2, true),
  ('monthly_129000', 'cujasa', 'CUJASA 베이직 월정액(판매 중단)', 'monthly', 129000, 'monthly', 2, false),
  ('dexor_credit_5000', 'dexor', 'DEXOR 크레딧 10회 충전', 'onetime', 5000, 'once', 0, true),
  ('dexor_credit_10000', 'dexor', 'DEXOR 크레딧 25회 충전', 'onetime', 10000, 'once', 0, true),
  ('dexor_credit_50000', 'dexor', 'DEXOR 크레딧 150회 충전', 'onetime', 50000, 'once', 0, true),
  ('dexor_credit_100000', 'dexor', 'DEXOR 크레딧 350회 충전', 'onetime', 100000, 'once', 0, true),
  ('infludex_credit_5000', 'infludex', 'INFLUDEX 라이트 분석 30회', 'onetime', 5000, 'once', 0, true),
  ('infludex_credit_10000', 'infludex', 'INFLUDEX 베이직 분석 100회', 'onetime', 10000, 'once', 0, true),
  ('infludex_credit_50000', 'infludex', 'INFLUDEX 프로 분석 250회', 'onetime', 50000, 'once', 0, true),
  ('spread_starter_monthly_49000', 'spread', 'SPREAD 스타터 월정액', 'monthly', 49000, 'monthly', 0, true),
  ('spread_basic_monthly_149000', 'spread', 'SPREAD 베이직 월정액', 'monthly', 149000, 'monthly', 0, true),
  ('spread_pro_monthly_390000', 'spread', 'SPREAD 프로 월정액', 'monthly', 390000, 'monthly', 0, true),
  ('polibot_starter_monthly_39000', 'polibot', 'POLIBOT 스타터 월정액', 'monthly', 29000, 'monthly', 0, true),
  ('polibot_basic_monthly_99000', 'polibot', 'POLIBOT 베이직 월정액 50회', 'monthly', 79000, 'monthly', 0, true),
  ('polibot_pro_monthly_290000', 'polibot', 'POLIBOT 프로 월정액', 'monthly', 290000, 'monthly', 0, false),
  ('polibot_lifetime_590000', 'polibot', 'POLIBOT 프로 1년 이용', 'onetime', 590000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;

create table if not exists billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  app_product_id text not null default 'cujasa',
  product_id text not null references billing_products(id),
  subscription_id uuid,
  order_id text not null unique,
  provider text not null default 'toss',
  method text not null,
  amount int not null,
  status text not null default 'created' check (status in ('created', 'waiting_for_deposit', 'paid', 'failed', 'canceled')),
  payment_key text,
  secret text,
  virtual_account_json jsonb,
  raw_data jsonb not null default '{}',
  failed_reason text,
  agreement_id uuid,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_payments add column if not exists app_product_id text not null default 'cujasa';
alter table billing_payments add column if not exists agreement_id uuid;

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  app_product_id text not null default 'cujasa',
  product_id text not null references billing_products(id),
  customer_key text not null,
  billing_key text,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  next_billing_at timestamptz,
  last_payment_id uuid references billing_payments(id) on delete set null,
  agreement_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_subscriptions add column if not exists app_product_id text not null default 'cujasa';
alter table billing_subscriptions add column if not exists agreement_id uuid;

create table if not exists billing_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id text not null references billing_products(id),
  app_product_id text not null default 'cujasa',
  agreement_version text not null,
  agreement_title text not null,
  agreement_snapshot jsonb not null default '{}',
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists user_login_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  device_type text not null check (device_type in ('desktop', 'mobile')),
  fingerprint_hash text not null,
  label text,
  user_agent text,
  first_ip text,
  last_ip text,
  status text not null default 'active' check (status in ('active', 'blocked', 'revoked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists sponsor_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_name text not null,
  destination_url text not null,
  category text,
  label_text text not null default '[광고]',
  comment_text text not null default '[광고] Threads 자동화 수익 플랫폼 JASAIN · https://jasain.kr',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sponsor_campaigns_active
  on sponsor_campaigns(active, starts_at, ends_at);

create index if not exists idx_accounts_project on accounts(project_id);
create index if not exists idx_accounts_automation_status on accounts(status, automation_status);
create index if not exists idx_topics_account on topics(account_id);
create index if not exists idx_products_topic on coupang_products(topic_id);
create index if not exists idx_posts_account on posts(account_id);
create index if not exists idx_queue_account_status on post_queue(account_id, status);
create index if not exists idx_post_queue_status_updated_at on post_queue(status, updated_at);
create index if not exists idx_pipeline_runs_account_status on pipeline_runs(account_id, status, started_at desc);
create index if not exists idx_clicks_account on click_events(account_id, created_at);
create index if not exists idx_tracking_code on tracking_links(code);
create index if not exists idx_user_accounts_user on user_accounts(user_id);
create index if not exists idx_user_accounts_account on user_accounts(account_id);
create index if not exists idx_user_products_user on user_products(user_id);
create index if not exists idx_user_products_product on user_products(product_id, status);
create index if not exists idx_billing_payments_user on billing_payments(user_id, created_at desc);
create index if not exists idx_billing_payments_order on billing_payments(order_id);
create index if not exists idx_billing_subscriptions_user on billing_subscriptions(user_id, status);
create index if not exists idx_users_archived_at on users(archived_at, created_at desc);
create index if not exists idx_billing_agreements_user on billing_agreements(user_id, accepted_at desc);
create index if not exists idx_user_login_devices_user_type
  on user_login_devices(user_id, device_type, status);

create table if not exists setup_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid references billing_payments(id) on delete set null,
  product_id text not null default 'onetime_590000',
  app_product_id text not null default 'cujasa',
  buyer_name text,
  email text,
  phone text,
  amount int,
  paid_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'canceled')),
  source text not null default 'payment',
  notes text,
  notified_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id)
);

create index if not exists idx_setup_tasks_status on setup_tasks(status, created_at desc);
create index if not exists idx_setup_tasks_user on setup_tasks(user_id, created_at desc);

create table if not exists purchase_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  plan text not null default 'onetime',
  source text not null default 'cujasa',
  product_id text,
  topic text,
  question_path jsonb not null default '[]',
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);

alter table purchase_inquiries add column if not exists product_id text;
alter table purchase_inquiries add column if not exists topic text;
alter table purchase_inquiries add column if not exists question_path jsonb not null default '[]';
alter table purchase_inquiries add column if not exists message text;
alter table purchase_inquiries add column if not exists status text not null default 'new';
alter table purchase_inquiries drop constraint if exists purchase_inquiries_status_check;
alter table purchase_inquiries add constraint purchase_inquiries_status_check
  check (status in ('new', 'contacted', 'closed'));

create index if not exists idx_inquiries_created on purchase_inquiries(created_at desc);
create index if not exists idx_purchase_inquiries_status_created on purchase_inquiries(status, created_at desc);
create index if not exists idx_purchase_inquiries_product_topic on purchase_inquiries(product_id, topic);

create table if not exists sublog_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  amount numeric not null,
  currency text not null default 'KRW' check (currency in ('KRW', 'USD')),
  billing_day int not null default 1 check (billing_day between 1 and 31),
  category text not null default '기타',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sublog_subscriptions_user_created
  on sublog_subscriptions(user_id, created_at desc);
