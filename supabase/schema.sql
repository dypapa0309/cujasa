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
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  error_message text,
  selected_cta_id uuid references cta_variants(id) on delete set null,
  tracking_link_id uuid references tracking_links(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists idx_accounts_project on accounts(project_id);
create index if not exists idx_topics_account on topics(account_id);
create index if not exists idx_products_topic on coupang_products(topic_id);
create index if not exists idx_posts_account on posts(account_id);
create index if not exists idx_queue_account_status on post_queue(account_id, status);
create index if not exists idx_clicks_account on click_events(account_id, created_at);
create index if not exists idx_tracking_code on tracking_links(code);
