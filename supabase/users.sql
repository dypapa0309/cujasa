create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  max_accounts int not null default 4,
  created_at timestamptz not null default now()
);

create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, account_id)
);

create index if not exists idx_user_accounts_user on user_accounts(user_id);
create index if not exists idx_user_accounts_account on user_accounts(account_id);
