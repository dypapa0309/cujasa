create table if not exists user_login_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  device_type text not null check (device_type in ('desktop', 'mobile')),
  fingerprint_hash text not null,
  label text,
  user_agent text,
  first_ip text,
  last_ip text,
  status text not null default 'active' check (status in ('active', 'blocked', 'revoked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists idx_user_login_devices_user_type
  on user_login_devices(user_id, device_type, status);
