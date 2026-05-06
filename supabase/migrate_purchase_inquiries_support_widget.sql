alter table purchase_inquiries
  add column if not exists product_id text,
  add column if not exists topic text,
  add column if not exists question_path jsonb not null default '[]',
  add column if not exists message text,
  add column if not exists status text not null default 'new';

alter table purchase_inquiries
  drop constraint if exists purchase_inquiries_status_check;

alter table purchase_inquiries
  add constraint purchase_inquiries_status_check
  check (status in ('new', 'contacted', 'closed'));

create index if not exists idx_purchase_inquiries_status_created
  on purchase_inquiries(status, created_at desc);

create index if not exists idx_purchase_inquiries_product_topic
  on purchase_inquiries(product_id, topic);
