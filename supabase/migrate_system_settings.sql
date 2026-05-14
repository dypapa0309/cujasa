create table if not exists system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null default '',
  is_secret boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_system_settings_key on system_settings(key);
