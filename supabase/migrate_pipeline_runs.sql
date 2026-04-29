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

create index if not exists idx_pipeline_runs_account_status
  on pipeline_runs(account_id, status, started_at desc);
