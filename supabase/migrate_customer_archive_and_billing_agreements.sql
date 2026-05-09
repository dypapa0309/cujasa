alter table users
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text,
  add column if not exists archived_by text;

create table if not exists billing_agreements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  product_id text not null references billing_products(id),
  app_product_id text not null default 'cujasa',
  agreement_version text not null,
  agreement_title text not null,
  agreement_snapshot jsonb not null default '{}',
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table billing_payments
  add column if not exists agreement_id uuid references billing_agreements(id) on delete set null;

alter table billing_subscriptions
  add column if not exists agreement_id uuid references billing_agreements(id) on delete set null;

create index if not exists idx_users_archived_at
  on users(archived_at, created_at desc);

create index if not exists idx_billing_agreements_user
  on billing_agreements(user_id, accepted_at desc);

