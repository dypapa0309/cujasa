create table if not exists account_conflict_audits (
  id uuid primary key default gen_random_uuid(),
  conflict_type text not null,
  conflict_key text not null,
  account_ids uuid[] not null default '{}',
  details jsonb not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

delete from user_accounts ua
using (
  select id,
    row_number() over (
      partition by account_id
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from user_accounts
) ranked
where ua.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists idx_user_accounts_one_owner_per_account
  on user_accounts(account_id);

alter table post_queue
  add column if not exists error_category text;

create index if not exists idx_post_queue_error_category
  on post_queue(error_category);
