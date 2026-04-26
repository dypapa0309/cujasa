create table if not exists blog_posts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references accounts(id) on delete cascade,
  topic_id uuid references topics(id) on delete set null,
  slug text not null unique,
  title text not null,
  meta_description text,
  content text not null,
  status text not null default 'published' check (status in ('draft', 'published')),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_blog_posts_slug on blog_posts(slug);
create index if not exists idx_blog_posts_published on blog_posts(published_at desc) where status = 'published';
