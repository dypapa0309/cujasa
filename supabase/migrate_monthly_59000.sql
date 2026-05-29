-- 월결제 상품을 129,000원으로 유지합니다.
-- 과거 결제 기록은 금액 보존을 위해 수정하지 않습니다.
insert into billing_products (id, name, plan, amount, billing_cycle, max_accounts, active)
values ('monthly_59000', 'CUJASA 베이직 월정액', 'monthly', 129000, 'monthly', 2, true)
on conflict (id) do update set
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = true;

update billing_products
set
  name = 'CUJASA 베이직 월정액(판매 중단)',
  active = false
where id = 'monthly_129000';

update billing_subscriptions
set product_id = 'monthly_59000'
where product_id = 'monthly_129000'
  and status in ('pending', 'active', 'past_due');
