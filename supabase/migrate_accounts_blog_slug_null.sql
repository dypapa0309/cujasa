update accounts
set blog_slug = null
where blog_slug = '';

drop index if exists idx_accounts_blog_slug;

create unique index if not exists idx_accounts_blog_slug
  on accounts(blog_slug)
  where blog_slug is not null and blog_slug <> '';
