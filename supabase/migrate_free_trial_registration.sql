alter table users
  add column if not exists username text,
  add column if not exists plan text,
  add column if not exists paid_until timestamptz,
  add column if not exists free_post_limit integer not null default 5,
  add column if not exists free_post_used integer not null default 0,
  add column if not exists trial_blocked_at timestamptz;

alter table users
  alter column plan set default 'free';

alter table users
  alter column free_post_limit set default 5;

create unique index if not exists idx_users_username_unique
  on users(lower(username))
  where username is not null and username <> '';

alter table users
  drop constraint if exists users_plan_check;

alter table users
  add constraint users_plan_check
  check (plan is null or plan in ('free', 'onetime', 'monthly'));

update users
set plan = 'free'
where plan is null
  and coalesce(billing_status, 'none') in ('none', 'pending');

update users
set
  free_post_limit = greatest(coalesce(free_post_limit, 5), 5),
  free_post_used = coalesce(free_post_used, 0),
  trial_blocked_at = case
    when coalesce(free_post_used, 0) < 5 then null
    else trial_blocked_at
  end;
