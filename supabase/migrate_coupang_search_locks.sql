create table if not exists coupang_search_locks (
  account_id uuid primary key references accounts(id) on delete cascade,
  next_allowed_at timestamptz not null default now(),
  last_keyword text,
  last_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_coupang_search_locks_next_allowed_at
  on coupang_search_locks(next_allowed_at);
