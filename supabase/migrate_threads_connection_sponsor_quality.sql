alter table post_queue drop constraint if exists post_queue_post_mode_check;
alter table post_queue
  add constraint post_queue_post_mode_check
  check (post_mode in ('auto', 'link', 'no_link', 'sponsored_comment'));

create table if not exists threads_connection_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  threads_handle text not null,
  status text not null default 'requested' check (status in ('requested', 'meta_registered', 'customer_action_required', 'connected', 'canceled')),
  request_memo text,
  admin_memo text,
  meta_registered_at timestamptz,
  connected_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_threads_connection_requests_account
  on threads_connection_requests(account_id, created_at desc);
create index if not exists idx_threads_connection_requests_status
  on threads_connection_requests(status, created_at desc);

create table if not exists sponsor_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_name text not null,
  destination_url text not null,
  category text,
  label_text text not null default '[광고]',
  comment_text text not null default '[광고] Threads 자동화 수익 플랫폼 JASAIN · https://jasain.kr',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sponsor_campaigns_active
  on sponsor_campaigns(active, starts_at, ends_at);

insert into sponsor_campaigns (id, name, product_name, destination_url, category, label_text, comment_text, active)
values (
  '11111111-1111-4111-8111-111111111111',
  'JASAIN 자체 홍보',
  'JASAIN',
  'https://jasain.kr',
  'automation',
  '[광고]',
  '[광고] Threads 자동화 수익 플랫폼 JASAIN · https://jasain.kr',
  true
)
on conflict do nothing;
