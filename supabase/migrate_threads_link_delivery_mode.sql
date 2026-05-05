alter table accounts
  add column if not exists threads_link_delivery_mode text default 'reply';

alter table accounts
  alter column threads_link_delivery_mode set default 'reply';

update accounts
set threads_link_delivery_mode = 'reply'
where threads_link_delivery_mode is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_threads_link_delivery_mode_check'
  ) then
    alter table accounts
      add constraint accounts_threads_link_delivery_mode_check
      check (threads_link_delivery_mode in ('reply', 'body_fallback'));
  end if;
end $$;

create index if not exists idx_accounts_threads_link_delivery_mode
  on accounts(threads_link_delivery_mode);

-- 기본은 댓글 링크 방식입니다.
-- 댓글 권한/게시 실패가 확인된 계정은 이후 링크 글을 본문 하단 백업 방식으로 발행합니다.
