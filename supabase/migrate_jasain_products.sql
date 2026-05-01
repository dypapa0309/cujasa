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

alter table users add column if not exists buyer_name text;
alter table users add column if not exists updated_at timestamptz not null default now();
alter table user_accounts add column if not exists updated_at timestamptz not null default now();

insert into jasain_products (id, name, description, app_url, landing_url, status)
values
  ('cujasa', 'CUJASA', '쿠팡 파트너스 자동화 콘솔', 'https://cujasa.jasain.kr', 'https://jasain.kr/cujasa', 'active'),
  ('dexor', 'DEXOR', '블로그 분석 및 선정 자동화', 'https://dexor.jasain.kr', 'https://jasain.kr/dexor', 'active')
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
  settings jsonb not null default '{}',
  granted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, product_id)
);

create index if not exists idx_user_products_user on user_products(user_id);
create index if not exists idx_user_products_product on user_products(product_id, status);
alter table user_products add column if not exists settings jsonb not null default '{}';

alter table billing_products add column if not exists app_product_id text not null default 'cujasa';
alter table billing_payments add column if not exists app_product_id text not null default 'cujasa';
alter table billing_subscriptions add column if not exists app_product_id text not null default 'cujasa';

insert into user_products (user_id, product_id, status, role)
select id, 'cujasa', 'active', 'customer'
from users
on conflict (user_id, product_id) do nothing;
