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

-- 신규/기존 계정은 기본 paused로 둡니다.
-- 고객이 자동화 시작을 눌렀거나 운영자가 명시적으로 켠 계정만 running으로 전환합니다.

create index if not exists idx_accounts_automation_status
  on accounts(status, automation_status);
