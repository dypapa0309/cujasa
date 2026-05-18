create table if not exists sublog_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  amount numeric not null,
  currency text not null default 'KRW' check (currency in ('KRW', 'USD')),
  billing_day int not null default 1 check (billing_day between 1 and 31),
  category text not null default '기타',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sublog_subscriptions_user_created
  on sublog_subscriptions(user_id, created_at desc);
