alter table users add column if not exists buyer_name text;

alter table user_products add column if not exists settings jsonb not null default '{}';
