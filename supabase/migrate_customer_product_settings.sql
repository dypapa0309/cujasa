alter table users add column if not exists buyer_name text;
alter table users add column if not exists updated_at timestamptz not null default now();
alter table user_accounts add column if not exists updated_at timestamptz not null default now();

alter table user_products add column if not exists settings jsonb not null default '{}';
