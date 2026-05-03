alter table users add column if not exists phone text;

create table if not exists setup_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  payment_id uuid references billing_payments(id) on delete set null,
  product_id text not null default 'onetime_590000',
  app_product_id text not null default 'cujasa',
  buyer_name text,
  email text,
  phone text,
  amount int,
  paid_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'canceled')),
  source text not null default 'payment',
  notes text,
  notified_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_id)
);

alter table setup_tasks add column if not exists paid_at timestamptz;

create index if not exists idx_setup_tasks_status on setup_tasks(status, created_at desc);
create index if not exists idx_setup_tasks_user on setup_tasks(user_id, created_at desc);
