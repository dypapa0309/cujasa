-- Issue commerce engine (Phase 1): global shared content layer.
-- issues/issue_sources/issue_products are generated once and shared by all
-- tenant sites later (Phase 2). Only deeplinks become tenant-scoped.

create table if not exists issues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  briefing text not null default '',
  keywords text[] not null default '{}',
  category text,
  source_count integer not null default 0,
  product_keyword text,
  score numeric not null default 0,
  status text not null default 'published' check (status in ('published', 'hidden')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_issues_published_at on issues (published_at desc);
create index if not exists idx_issues_category on issues (category);

create table if not exists issue_sources (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  publisher text,
  title text not null,
  url text not null unique,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_sources_issue_id on issue_sources (issue_id);

create table if not exists issue_products (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  keyword text,
  product_id text,
  product_name text not null,
  product_price integer,
  product_image text,
  product_url text not null,
  partner_url text not null,
  category_name text,
  rank integer not null default 0,
  click_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_products_issue_id on issue_products (issue_id);
create index if not exists idx_issue_products_click_count on issue_products (click_count desc);

create table if not exists issue_threads (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references issues(id) on delete cascade,
  title text not null,
  body text,
  auto_generated boolean not null default true,
  comment_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_threads_issue_id on issue_threads (issue_id);

create table if not exists issue_thread_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references issue_threads(id) on delete cascade,
  nickname text not null default '익명',
  body text not null,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_thread_comments_thread_id on issue_thread_comments (thread_id);

create table if not exists issue_clicks (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references issues(id) on delete cascade,
  issue_product_id uuid references issue_products(id) on delete cascade,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_issue_clicks_product on issue_clicks (issue_product_id, created_at desc);

-- RLS: server uses SUPABASE_SERVICE_ROLE_KEY (bypasses RLS); block direct access.
alter table issues enable row level security;
revoke all on table issues from anon, authenticated;

alter table issue_sources enable row level security;
revoke all on table issue_sources from anon, authenticated;

alter table issue_products enable row level security;
revoke all on table issue_products from anon, authenticated;

alter table issue_threads enable row level security;
revoke all on table issue_threads from anon, authenticated;

alter table issue_thread_comments enable row level security;
revoke all on table issue_thread_comments from anon, authenticated;

alter table issue_clicks enable row level security;
revoke all on table issue_clicks from anon, authenticated;
