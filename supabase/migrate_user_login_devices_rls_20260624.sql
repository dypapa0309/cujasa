alter table public.user_login_devices enable row level security;

revoke all on table public.user_login_devices from anon, authenticated;
