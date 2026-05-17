alter table accounts
  alter column link_post_ratio set default 0.9,
  alter column no_link_post_ratio set default 0.1;

update accounts
set
  link_post_ratio = 0.9,
  no_link_post_ratio = 0.1,
  updated_at = now()
where status = 'active'
  and automation_status = 'running'
  and coalesce(no_link_post_ratio, 0.33) > 0.1;
