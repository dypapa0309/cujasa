alter table accounts
  add column if not exists anonymous_learning_enabled boolean not null default false,
  add column if not exists personal_reference_patterns jsonb not null default '[]',
  add column if not exists blog_auto_publish_enabled boolean not null default false,
  add column if not exists blog_publish_mode text not null default 'test_only',
  add column if not exists blog_base_url text,
  add column if not exists toss_share_link_enabled boolean not null default false,
  add column if not exists toss_share_link_url text,
  add column if not exists toss_share_link_label text,
  add column if not exists toss_share_link_memo text;

alter table blog_posts
  add column if not exists post_id uuid references posts(id) on delete set null,
  add column if not exists queue_id uuid references post_queue(id) on delete set null,
  add column if not exists cover_image_url text,
  add column if not exists tags jsonb not null default '[]',
  add column if not exists seo_keywords jsonb not null default '[]',
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists idx_blog_posts_queue_id
  on blog_posts(queue_id)
  where queue_id is not null;

create unique index if not exists idx_blog_posts_post_id
  on blog_posts(post_id)
  where post_id is not null;
