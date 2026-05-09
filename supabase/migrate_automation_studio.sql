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

alter table automation_studio_campaigns add column if not exists objective_type text not null default 'click';
alter table automation_studio_campaigns add column if not exists priority text not null default 'normal';
alter table automation_studio_campaigns add column if not exists operation_set jsonb not null default '{}';
alter table automation_studio_campaigns add column if not exists next_action_note text;
alter table automation_studio_campaigns drop constraint if exists automation_studio_campaigns_status_check;
alter table automation_studio_campaigns
  add constraint automation_studio_campaigns_status_check
  check (status in ('draft', 'running', 'needs_review', 'stopped', 'completed'));
alter table automation_studio_campaigns drop constraint if exists automation_studio_campaigns_objective_type_check;
alter table automation_studio_campaigns
  add constraint automation_studio_campaigns_objective_type_check
  check (objective_type in ('click', 'consultation', 'save_follow', 'awareness', 'lead'));
alter table automation_studio_campaigns drop constraint if exists automation_studio_campaigns_priority_check;
alter table automation_studio_campaigns
  add constraint automation_studio_campaigns_priority_check
  check (priority in ('low', 'normal', 'high'));

alter table automation_studio_assets add column if not exists operation_note text;
alter table automation_studio_assets add column if not exists reusable boolean not null default false;
alter table automation_studio_assets drop constraint if exists automation_studio_assets_status_check;
alter table automation_studio_assets
  add constraint automation_studio_assets_status_check
  check (status in ('draft', 'preview', 'needs_review', 'approved', 'queued', 'posted', 'rejected', 'stopped'));

create index if not exists idx_automation_studio_campaigns_status
  on automation_studio_campaigns(status, created_at desc);

create index if not exists idx_automation_studio_assets_campaign
  on automation_studio_assets(campaign_id, platform, created_at);

create index if not exists idx_automation_studio_queue_links_campaign
  on automation_studio_queue_links(campaign_id, platform, status);
