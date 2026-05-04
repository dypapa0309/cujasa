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
  daily_post_min int not null default 1,
  daily_post_max int not null default 3,
  active_time_windows jsonb not null default '[]',
  min_interval_minutes int not null default 50,
  link_post_ratio numeric not null default 0.3,
  no_link_post_ratio numeric not null default 0.7,
  rest_days_per_week int not null default 1,
  threads_access_token text,
  threads_user_id text,
  threads_token_expires_at timestamptz,
  threads_token_status text not null default 'not_connected',
  threads_connected_at timestamptz,
  last_threads_refresh_at timestamptz,
  coupang_access_key text,
  coupang_secret_key text,
  coupang_partner_id text,
  coupang_tracking_code text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table accounts add column if not exists threads_user_id text;
alter table accounts add column if not exists threads_token_expires_at timestamptz;
alter table accounts add column if not exists threads_token_status text not null default 'not_connected';
alter table accounts add column if not exists threads_connected_at timestamptz;
alter table accounts add column if not exists last_threads_refresh_at timestamptz;
alter table accounts add column if not exists coupang_access_key text;
alter table accounts add column if not exists coupang_secret_key text;
alter table accounts add column if not exists coupang_partner_id text;
alter table accounts add column if not exists coupang_tracking_code text;

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

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete cascade,
  content_type text,
  body text not null,
  risk_level text not null default 'low',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  post_mode text not null default 'auto' check (post_mode in ('auto', 'link', 'no_link')),
  error_message text,
  error_category text,
  selected_cta_id uuid references cta_variants(id) on delete set null,
  tracking_link_id uuid references tracking_links(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now()
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
  status text not null default 'active' check (status in ('active', 'suspended')),
  max_accounts int not null default 2,
  plan text default 'free',
  billing_status text not null default 'none' check (billing_status in ('none', 'pending', 'paid', 'active', 'past_due', 'canceled')),
  paid_until timestamptz,
  free_post_limit integer not null default 3,
  free_post_used integer not null default 0,
  trial_blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users alter column max_accounts set default 2;
alter table users add column if not exists username text;
alter table users add column if not exists buyer_name text;
alter table users add column if not exists phone text;
alter table users add column if not exists plan text;
alter table users alter column plan set default 'free';
alter table users add column if not exists billing_status text not null default 'none';
alter table users add column if not exists paid_until timestamptz;
alter table users add column if not exists free_post_limit integer not null default 3;
alter table users add column if not exists free_post_used integer not null default 0;
alter table users add column if not exists trial_blocked_at timestamptz;

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
  ('cujasa', 'CUJASA', '쿠팡 파트너스 자동화 콘솔', 'https://cujasa.jasain.kr', 'https://jasain.kr/cujasa', 'active'),
  ('dexor', 'DEXOR', '블로그 분석 및 선정 자동화', 'https://dexor-pearl.vercel.app/', 'https://jasain.kr/dexor', 'active')
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

insert into billing_products (id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('onetime_590000', 'CUJASA 베이직 일시불', 'onetime', 590000, 'once', 2, true),
  ('monthly_59000', 'CUJASA 베이직 월정액', 'monthly', 59000, 'monthly', 2, true),
  ('monthly_129000', 'CUJASA 베이직 월정액(판매 중단)', 'monthly', 129000, 'monthly', 2, false)
on conflict (id) do update set
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
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_payments add column if not exists app_product_id text not null default 'cujasa';

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_subscriptions add column if not exists app_product_id text not null default 'cujasa';

create index if not exists idx_accounts_project on accounts(project_id);
create index if not exists idx_topics_account on topics(account_id);
create index if not exists idx_products_topic on coupang_products(topic_id);
create index if not exists idx_posts_account on posts(account_id);
create index if not exists idx_queue_account_status on post_queue(account_id, status);
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
