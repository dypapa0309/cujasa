alter table accounts add column if not exists threads_user_id text;
alter table accounts add column if not exists threads_token_expires_at timestamptz;
alter table accounts add column if not exists threads_token_status text not null default 'not_connected';
alter table accounts add column if not exists threads_connected_at timestamptz;
alter table accounts add column if not exists last_threads_refresh_at timestamptz;

update accounts
set threads_token_status = case
  when threads_access_token is not null and threads_access_token <> '' then 'connected'
  else 'not_connected'
end
where threads_token_status is null or threads_token_status = 'not_connected';
