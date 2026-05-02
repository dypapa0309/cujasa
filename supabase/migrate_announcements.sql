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
