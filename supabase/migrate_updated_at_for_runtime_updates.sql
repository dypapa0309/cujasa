alter table post_metrics_jobs
  add column if not exists updated_at timestamptz not null default now();

alter table notifications
  add column if not exists updated_at timestamptz not null default now();
