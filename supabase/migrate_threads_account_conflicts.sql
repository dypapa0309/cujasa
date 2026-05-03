create table if not exists account_conflict_audits (
  id uuid primary key default gen_random_uuid(),
  conflict_type text not null,
  conflict_key text not null,
  account_ids uuid[] not null default '{}',
  details jsonb not null default '{}',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

insert into account_conflict_audits (conflict_type, conflict_key, account_ids, details)
select
  'duplicate_threads_user_id',
  threads_user_id,
  array_agg(id order by updated_at desc nulls last, created_at desc),
  jsonb_agg(jsonb_build_object('id', id, 'name', name, 'handle', account_handle, 'updated_at', updated_at))
from accounts
where status = 'active'
  and nullif(threads_user_id, '') is not null
group by threads_user_id
having count(*) > 1;

insert into account_conflict_audits (conflict_type, conflict_key, account_ids, details)
select
  'duplicate_account_handle',
  lower(regexp_replace(account_handle, '^@', '')),
  array_agg(id order by updated_at desc nulls last, created_at desc),
  jsonb_agg(jsonb_build_object('id', id, 'name', name, 'handle', account_handle, 'updated_at', updated_at))
from accounts
where status = 'active'
  and nullif(regexp_replace(coalesce(account_handle, ''), '^@', ''), '') is not null
group by lower(regexp_replace(account_handle, '^@', ''))
having count(*) > 1;

insert into account_conflict_audits (conflict_type, conflict_key, account_ids, details)
select
  'account_assigned_to_multiple_users',
  ua.account_id::text,
  array[ua.account_id],
  jsonb_agg(jsonb_build_object('user_id', ua.user_id, 'email', u.email, 'created_at', ua.created_at))
from user_accounts ua
left join users u on u.id = ua.user_id
group by ua.account_id
having count(distinct ua.user_id) > 1;

update accounts
set
  threads_access_token = null,
  threads_user_id = null,
  threads_token_expires_at = null,
  threads_token_status = 'not_connected',
  threads_connected_at = null,
  last_threads_refresh_at = null,
  updated_at = now()
where id in (
  select unnest(account_ids)
  from account_conflict_audits
  where conflict_type = 'duplicate_threads_user_id'
    and resolved_at is null
);

update account_conflict_audits
set resolved_at = now()
where conflict_type = 'duplicate_threads_user_id'
  and resolved_at is null;

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

create unique index if not exists idx_accounts_active_threads_user_id_unique
  on accounts(threads_user_id)
  where status = 'active' and nullif(threads_user_id, '') is not null;

do $$
begin
  if not exists (
    select 1
    from accounts
    where status = 'active'
      and nullif(regexp_replace(coalesce(account_handle, ''), '^@', ''), '') is not null
    group by lower(regexp_replace(account_handle, '^@', ''))
    having count(*) > 1
  ) then
    create unique index if not exists idx_accounts_active_handle_unique
      on accounts(lower(regexp_replace(account_handle, '^@', '')))
      where status = 'active'
        and nullif(regexp_replace(coalesce(account_handle, ''), '^@', ''), '') is not null;
  end if;
end $$;
