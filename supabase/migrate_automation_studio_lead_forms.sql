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
