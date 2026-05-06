alter table accounts
  alter column daily_post_max set default 5;

alter table accounts
  alter column daily_post_min set default 0;

update accounts
set
  daily_post_min = 0,
  daily_post_max = least(
    greatest(coalesce(daily_post_max, 5), 0),
    5
  ),
  updated_at = now()
where
  daily_post_min is distinct from 0
  or daily_post_max is distinct from least(
    greatest(coalesce(daily_post_max, 5), 0),
    5
  );

alter table accounts drop constraint if exists accounts_link_post_ratio_limit_check;
alter table accounts drop constraint if exists accounts_no_link_post_ratio_limit_check;

alter table accounts drop constraint if exists accounts_daily_post_limits_check;
alter table accounts add constraint accounts_daily_post_limits_check
  check (daily_post_min = 0 and daily_post_max >= 0 and daily_post_max <= 5);
