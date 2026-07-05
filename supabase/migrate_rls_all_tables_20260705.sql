-- Enable RLS on all core tables and revoke anon/authenticated access.
-- The Express API server uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS,
-- so existing server operations are unaffected. This protects against
-- leaked anon keys or direct Supabase client access.

-- ============================================================
-- Core content tables
-- ============================================================

alter table public.projects enable row level security;
revoke all on table public.projects from anon, authenticated;

alter table public.accounts enable row level security;
revoke all on table public.accounts from anon, authenticated;

alter table public.topics enable row level security;
revoke all on table public.topics from anon, authenticated;

alter table public.coupang_products enable row level security;
revoke all on table public.coupang_products from anon, authenticated;

alter table public.coupang_search_locks enable row level security;
revoke all on table public.coupang_search_locks from anon, authenticated;

alter table public.posts enable row level security;
revoke all on table public.posts from anon, authenticated;

alter table public.post_products enable row level security;
revoke all on table public.post_products from anon, authenticated;

alter table public.cta_variants enable row level security;
revoke all on table public.cta_variants from anon, authenticated;

alter table public.tracking_links enable row level security;
revoke all on table public.tracking_links from anon, authenticated;

alter table public.click_events enable row level security;
revoke all on table public.click_events from anon, authenticated;

alter table public.post_queue enable row level security;
revoke all on table public.post_queue from anon, authenticated;

alter table public.trend_reference_patterns enable row level security;
revoke all on table public.trend_reference_patterns from anon, authenticated;

-- ============================================================
-- Pipeline and metrics
-- ============================================================

alter table public.pipeline_runs enable row level security;
revoke all on table public.pipeline_runs from anon, authenticated;

alter table public.post_metrics_jobs enable row level security;
revoke all on table public.post_metrics_jobs from anon, authenticated;

alter table public.post_metrics enable row level security;
revoke all on table public.post_metrics from anon, authenticated;

alter table public.activity_logs enable row level security;
revoke all on table public.activity_logs from anon, authenticated;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;

-- ============================================================
-- User and auth tables
-- ============================================================

alter table public.users enable row level security;
revoke all on table public.users from anon, authenticated;

alter table public.user_accounts enable row level security;
revoke all on table public.user_accounts from anon, authenticated;

alter table public.user_products enable row level security;
revoke all on table public.user_products from anon, authenticated;

-- user_login_devices: already has RLS (migrate_user_login_devices_rls_20260624.sql)

-- ============================================================
-- Billing tables
-- ============================================================

alter table public.jasain_products enable row level security;
revoke all on table public.jasain_products from anon, authenticated;

alter table public.billing_products enable row level security;
revoke all on table public.billing_products from anon, authenticated;

alter table public.billing_payments enable row level security;
revoke all on table public.billing_payments from anon, authenticated;

alter table public.billing_subscriptions enable row level security;
revoke all on table public.billing_subscriptions from anon, authenticated;

alter table public.billing_agreements enable row level security;
revoke all on table public.billing_agreements from anon, authenticated;

alter table public.setup_tasks enable row level security;
revoke all on table public.setup_tasks from anon, authenticated;

-- ============================================================
-- Public-facing tables (still deny by default)
-- ============================================================

alter table public.purchase_inquiries enable row level security;
revoke all on table public.purchase_inquiries from anon, authenticated;

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;

alter table public.sponsor_campaigns enable row level security;
revoke all on table public.sponsor_campaigns from anon, authenticated;

-- ============================================================
-- Threads connection
-- ============================================================

alter table public.threads_connection_requests enable row level security;
revoke all on table public.threads_connection_requests from anon, authenticated;

-- ============================================================
-- Automation studio
-- ============================================================

alter table public.automation_studio_campaigns enable row level security;
revoke all on table public.automation_studio_campaigns from anon, authenticated;

alter table public.automation_studio_assets enable row level security;
revoke all on table public.automation_studio_assets from anon, authenticated;

alter table public.automation_studio_queue_links enable row level security;
revoke all on table public.automation_studio_queue_links from anon, authenticated;

alter table public.automation_studio_lead_forms enable row level security;
revoke all on table public.automation_studio_lead_forms from anon, authenticated;

alter table public.automation_studio_lead_submissions enable row level security;
revoke all on table public.automation_studio_lead_submissions from anon, authenticated;

-- ============================================================
-- Subscription log
-- ============================================================

alter table public.sublog_subscriptions enable row level security;
revoke all on table public.sublog_subscriptions from anon, authenticated;
