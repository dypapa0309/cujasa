create table if not exists scheduler_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  run_date_kst date not null,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  triggered_by text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_scheduler_runs_job_date
  on scheduler_runs(job_name, run_date_kst);

create index if not exists idx_scheduler_runs_job_started
  on scheduler_runs(job_name, started_at desc);
