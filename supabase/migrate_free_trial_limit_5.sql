alter table users
  alter column free_post_limit set default 5;

update users
set
  free_post_limit = greatest(coalesce(free_post_limit, 5), 5),
  free_post_used = coalesce(free_post_used, 0),
  trial_blocked_at = case
    when coalesce(free_post_used, 0) < 5 then null
    else trial_blocked_at
  end
where
  coalesce(free_post_limit, 0) < 5
  or free_post_used is null
  or (trial_blocked_at is not null and coalesce(free_post_used, 0) < 5);
