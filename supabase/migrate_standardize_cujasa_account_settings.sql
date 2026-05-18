alter table accounts
  alter column content_mode set default 'question',
  alter column daily_post_max set default 3,
  alter column active_time_windows set default '[{"start":"09:00","end":"11:00"},{"start":"20:00","end":"23:00"}]'::jsonb,
  alter column min_interval_minutes set default 50,
  alter column link_post_ratio set default 0.9,
  alter column no_link_post_ratio set default 0.1;

update accounts
set
  daily_post_min = 0,
  daily_post_max = 3,
  active_time_windows = '[{"start":"09:00","end":"11:00"},{"start":"20:00","end":"23:00"}]'::jsonb,
  min_interval_minutes = 50,
  link_post_ratio = 0.9,
  no_link_post_ratio = 0.1,
  rest_days_per_week = 1,
  content_mode = 'question',
  content_intensity = 'normal',
  seasonality_enabled = true,
  comment_induction_style = 'soft_question',
  product_mention_style = 'natural',
  emoji_level = 'low',
  safe_debate_enabled = false,
  anonymous_learning_enabled = false,
  threads_link_delivery_mode = 'reply',
  updated_at = now()
where automation_status = 'running'
  and status = 'active'
  and coalesce(account_handle, '') <> '@jasain.kr';
