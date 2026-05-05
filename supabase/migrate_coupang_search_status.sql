alter table accounts
  add column if not exists coupang_search_cooldown_until timestamptz,
  add column if not exists coupang_search_status text default 'ok';

alter table accounts
  alter column coupang_search_status set default 'ok';

update accounts
set coupang_search_status = 'ok'
where coupang_search_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_coupang_search_status_check'
  ) then
    alter table accounts
      add constraint accounts_coupang_search_status_check
      check (coupang_search_status in ('ok', 'rate_limited', 'credentials_missing', 'api_error'));
  end if;
end $$;

create index if not exists idx_accounts_coupang_search_status
  on accounts(coupang_search_status, coupang_search_cooldown_until);

-- 쿠팡 검색 API 제한/키 누락/API 오류를 계정 단위로 저장합니다.
-- rate_limited 상태에서는 cooldown_until 전까지 자동 재검색을 멈춥니다.
