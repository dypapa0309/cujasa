create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  buyer_name text,
  phone text,
  privacy_consent_at timestamptz,
  status text not null default 'active' check (status in ('active', 'suspended')),
  max_accounts int not null default 2,
  plan text,
  billing_status text not null default 'none' check (billing_status in ('none', 'pending', 'paid', 'active', 'past_due', 'canceled')),
  paid_until timestamptz,
  created_at timestamptz not null default now()
);

alter table users alter column max_accounts set default 2;
alter table users add column if not exists buyer_name text;
alter table users add column if not exists phone text;
alter table users add column if not exists privacy_consent_at timestamptz;
alter table users add column if not exists plan text;
alter table users add column if not exists billing_status text not null default 'none';
alter table users add column if not exists paid_until timestamptz;

create table if not exists user_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, account_id)
);

create index if not exists idx_user_accounts_user on user_accounts(user_id);
create index if not exists idx_user_accounts_account on user_accounts(account_id);

create table if not exists jasain_products (
  id text primary key,
  name text not null,
  description text,
  app_url text,
  landing_url text,
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into jasain_products (id, name, description, app_url, landing_url, status)
values
  ('cujasa', 'CUJASA', '쿠팡 파트너스 자동화 콘솔', 'https://app.jasain.kr', 'https://jasain.kr/cujasa', 'active'),
  ('dexor', 'DEXOR', '블로그 분석 및 선정 자동화', 'https://app.jasain.kr', 'https://jasain.kr/dexor', 'active'),
  ('spread', 'SPREAD', '추천 캠페인 운영 자동화', 'https://app.jasain.kr', 'https://jasain.kr', 'active'),
  ('polibot', 'PoliBot', '보험 보장분석 및 상품 추천 자동화', 'https://app.jasain.kr', 'https://jasain.kr/polibot', 'active'),
  ('infludex', 'INFLUDEX', '인스타그램 인플루언서 등급 분석', 'https://app.jasain.kr', 'https://jasain.kr/infludex', 'active')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  app_url = excluded.app_url,
  landing_url = excluded.landing_url,
  status = excluded.status,
  updated_at = now();

create table if not exists user_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id text not null references jasain_products(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended', 'trial', 'expired')),
  role text not null default 'customer' check (role in ('customer', 'manager', 'admin')),
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, product_id)
);

create index if not exists idx_user_products_user on user_products(user_id);
create index if not exists idx_user_products_product on user_products(product_id, status);

insert into user_products (user_id, product_id, status, role)
select id, 'cujasa', 'active', 'customer'
from users
on conflict (user_id, product_id) do nothing;

create table if not exists billing_products (
  id text primary key,
  app_product_id text not null default 'cujasa',
  name text not null,
  plan text not null check (plan in ('onetime', 'monthly')),
  amount int not null,
  billing_cycle text not null check (billing_cycle in ('once', 'monthly')),
  max_accounts int not null default 2,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table billing_products add column if not exists app_product_id text not null default 'cujasa';

insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('onetime_590000', 'cujasa', 'CUJASA 베이직 일시불', 'onetime', 590000, 'once', 2, true),
  ('monthly_59000', 'cujasa', 'CUJASA 베이직 월정액', 'monthly', 59000, 'monthly', 2, true),
  ('monthly_129000', 'cujasa', 'CUJASA 베이직 월정액(판매 중단)', 'monthly', 129000, 'monthly', 2, false),
  ('dexor_credit_5000', 'dexor', 'DEXOR 크레딧 10회 충전', 'onetime', 5000, 'once', 0, true),
  ('dexor_credit_10000', 'dexor', 'DEXOR 크레딧 25회 충전', 'onetime', 10000, 'once', 0, true),
  ('dexor_credit_50000', 'dexor', 'DEXOR 크레딧 150회 충전', 'onetime', 50000, 'once', 0, true),
  ('dexor_credit_100000', 'dexor', 'DEXOR 크레딧 350회 충전', 'onetime', 100000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;

create table if not exists billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  app_product_id text not null default 'cujasa',
  product_id text not null references billing_products(id),
  subscription_id uuid,
  order_id text not null unique,
  provider text not null default 'toss',
  method text not null,
  amount int not null,
  status text not null default 'created' check (status in ('created', 'waiting_for_deposit', 'paid', 'failed', 'canceled')),
  payment_key text,
  secret text,
  virtual_account_json jsonb,
  raw_data jsonb not null default '{}',
  failed_reason text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_payments add column if not exists app_product_id text not null default 'cujasa';

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  app_product_id text not null default 'cujasa',
  product_id text not null references billing_products(id),
  customer_key text not null,
  billing_key text,
  status text not null default 'pending' check (status in ('pending', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  next_billing_at timestamptz,
  last_payment_id uuid references billing_payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table billing_subscriptions add column if not exists app_product_id text not null default 'cujasa';

create index if not exists idx_billing_payments_user on billing_payments(user_id, created_at desc);
create index if not exists idx_billing_payments_order on billing_payments(order_id);
create index if not exists idx_billing_subscriptions_user on billing_subscriptions(user_id, status);

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

create index if not exists idx_setup_tasks_status on setup_tasks(status, created_at desc);
create index if not exists idx_setup_tasks_user on setup_tasks(user_id, created_at desc);
