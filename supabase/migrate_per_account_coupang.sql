alter table accounts add column if not exists coupang_access_key text;
alter table accounts add column if not exists coupang_secret_key text;
alter table accounts add column if not exists coupang_partner_id text;
alter table accounts add column if not exists coupang_tracking_code text;
