alter table accounts
  add column if not exists automation_status text not null default 'paused',
  add column if not exists automation_started_at timestamptz,
  add column if not exists automation_stopped_at timestamptz;

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

-- 기존 운영 방식은 active 계정이 매일 자동 예약 대상이었으므로, 마이그레이션 직후에는 기존 active 계정을 running으로 보정합니다.
-- 이후 신규 계정은 기본 paused로 생성되고, 고객이 자동화 시작을 눌러야 running으로 전환됩니다.
update accounts
set
  automation_status = 'running',
  automation_started_at = coalesce(automation_started_at, now()),
  automation_stopped_at = null
where status = 'active'
  and automation_status = 'paused';

create index if not exists idx_accounts_automation_status
  on accounts(status, automation_status);
