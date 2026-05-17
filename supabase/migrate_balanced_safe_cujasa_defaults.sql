alter table accounts
  alter column daily_post_max set default 3,
  alter column active_time_windows set default '[{"start":"09:00","end":"23:00"}]'::jsonb,
  alter column min_interval_minutes set default 90,
  alter column link_post_ratio set default 0.9,
  alter column no_link_post_ratio set default 0.1;

update accounts
set
  daily_post_min = 0,
  daily_post_max = 3,
  active_time_windows = '[{"start":"09:00","end":"23:00"}]'::jsonb,
  min_interval_minutes = greatest(coalesce(min_interval_minutes, 90), 90),
  link_post_ratio = 0.9,
  no_link_post_ratio = 0.1,
  updated_at = now()
where automation_status = 'running'
  and status = 'active';
