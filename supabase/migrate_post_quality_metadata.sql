alter table posts
  add column if not exists metadata jsonb not null default '{}';
