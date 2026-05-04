-- 셋업 화면에 잡힌 기존 고객을 베이직 일시불 고객으로 보정합니다.
-- 실행 전 Supabase SQL editor에서 select count(*) from setup_tasks; 로 대상 수를 확인하세요.
alter table post_queue
  add column if not exists post_mode text not null default 'auto';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'post_queue_post_mode_check'
  ) then
    alter table post_queue
      add constraint post_queue_post_mode_check
      check (post_mode in ('auto', 'link', 'no_link'));
  end if;
end $$;

create index if not exists idx_post_queue_post_mode
  on post_queue(post_mode);

update users u
set
  plan = 'onetime',
  billing_status = 'paid',
  paid_until = null,
  max_accounts = greatest(coalesce(u.max_accounts, 0), 2),
  updated_at = now()
where exists (
  select 1
  from setup_tasks st
  where st.user_id = u.id
);

insert into user_products (user_id, product_id, status, role, granted_at)
select distinct st.user_id, 'cujasa', 'active', 'customer', now()
from setup_tasks st
where st.user_id is not null
on conflict (user_id, product_id) do update
set status = 'active',
    role = 'customer',
    granted_at = excluded.granted_at,
    updated_at = now();

-- 일반 글(no_link)에 잘못 붙은 과거 CTA/트래킹 링크 예약 정보를 정리합니다.
update post_queue
set
  selected_cta_id = null,
  tracking_link_id = null
where post_mode = 'no_link'
  and (selected_cta_id is not null or tracking_link_id is not null);
