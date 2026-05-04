alter table users
  add column if not exists plan text,
  add column if not exists billing_status text not null default 'none',
  add column if not exists paid_until timestamptz,
  add column if not exists phone text;

create index if not exists idx_users_billing_expiry
  on users(plan, billing_status, paid_until);

alter table billing_payments
  add column if not exists provider text,
  add column if not exists method text,
  add column if not exists paid_at timestamptz,
  add column if not exists raw_data jsonb not null default '{}';

create index if not exists idx_billing_payments_user_paid
  on billing_payments(user_id, paid_at desc);

create index if not exists idx_billing_payments_provider_paid
  on billing_payments(provider, paid_at desc);

update user_products
set status = 'expired'
where product_id = 'cujasa'
  and user_id in (
    select id
    from users
    where plan = 'monthly'
      and paid_until is not null
      and paid_until < now()
      and billing_status in ('active', 'past_due')
  );

update users
set billing_status = 'past_due'
where plan = 'monthly'
  and paid_until is not null
  and paid_until < now()
  and billing_status in ('active', 'past_due');
