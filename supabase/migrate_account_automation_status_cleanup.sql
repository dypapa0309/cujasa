alter table accounts
  add column if not exists automation_status text default 'paused',
  add column if not exists automation_started_at timestamptz,
  add column if not exists automation_stopped_at timestamptz;

alter table accounts
  alter column automation_status set default 'paused';

update accounts
set automation_status = 'paused'
where automation_status is null;

alter table accounts
  alter column automation_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_automation_status_check'
  ) then
    alter table accounts
      add constraint accounts_automation_status_check
      check (automation_status in ('running', 'paused'));
  end if;
end $$;

-- 설정이 부족한 계정은 running 상태였더라도 자동화 대상에서 제외합니다.
-- 기존 예약/로그/포스팅 데이터는 삭제하지 않고 계정의 자동화 상태만 paused로 보정합니다.
update accounts
set
  automation_status = 'paused',
  automation_stopped_at = coalesce(automation_stopped_at, now()),
  updated_at = now()
where automation_status = 'running'
  and (
    status <> 'active'
    or nullif(trim(coalesce(account_handle, '')), '') is null
    or nullif(trim(coalesce(threads_access_token, '')), '') is null
    or coalesce(threads_token_status, 'not_connected') <> 'connected'
    or nullif(trim(coalesce(target_audience, '')), '') is null
    or nullif(trim(coalesce(content_scope, '')), '') is null
    or coalesce(daily_post_min, 0) <= 0
    or coalesce(daily_post_max, 0) <= 0
    or coalesce(daily_post_max, 0) < coalesce(daily_post_min, 0)
    or (
      coalesce(link_post_ratio, 0) > 0
      and (
        nullif(trim(coalesce(coupang_access_key, '')), '') is null
        or nullif(trim(coalesce(coupang_secret_key, '')), '') is null
        or nullif(trim(coalesce(coupang_partner_id, '')), '') is null
      )
    )
  );

create index if not exists idx_accounts_automation_status
  on accounts(status, automation_status);
