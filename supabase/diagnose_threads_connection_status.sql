-- Threads connection diagnostics.
-- Read-only queries for checking duplicate audits, token status, and customers
-- who need reconnect guidance. Deleted OAuth tokens can only be restored from
-- a Supabase backup/PITR or an older dump; otherwise customers must reconnect.

-- 1) Conflict audit history.
select
  conflict_type,
  conflict_key,
  account_ids,
  resolved_at,
  created_at,
  details
from account_conflict_audits
where conflict_type in (
  'duplicate_threads_user_id',
  'duplicate_account_handle',
  'account_assigned_to_multiple_users'
)
order by created_at desc;

-- 2) Current Threads token status by account.
select
  id,
  name,
  account_handle,
  threads_user_id,
  threads_access_token is not null as has_threads_access_token,
  threads_token_status,
  threads_connected_at,
  last_threads_refresh_at,
  updated_at
from accounts
order by updated_at desc nulls last;

-- 3) Active customer accounts that currently need Threads reconnect.
select
  u.id as user_id,
  coalesce(u.buyer_name, u.username, u.email) as customer_label,
  u.email,
  u.phone,
  a.id as account_id,
  a.name as account_name,
  a.account_handle,
  a.threads_user_id,
  a.threads_access_token is not null as has_threads_access_token,
  a.threads_token_status,
  a.updated_at
from users u
join user_accounts ua on ua.user_id = u.id
join accounts a on a.id = ua.account_id
where a.status = 'active'
  and (
    a.threads_access_token is null
    or coalesce(a.threads_token_status, 'not_connected') <> 'connected'
  )
order by a.updated_at desc nulls last;

-- 4) Accounts that may need token-column PITR restore from duplicate audits.
select
  a.id as account_id,
  a.name as account_name,
  a.account_handle,
  audit.conflict_key as duplicate_threads_user_id,
  audit.created_at as audit_created_at
from account_conflict_audits audit
cross join lateral unnest(audit.account_ids) as account_id
join accounts a on a.id = account_id
where audit.conflict_type = 'duplicate_threads_user_id'
order by audit.created_at desc, a.name;
