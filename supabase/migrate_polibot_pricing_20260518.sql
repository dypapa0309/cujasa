insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('polibot_starter_monthly_39000', 'polibot', 'POLIBOT 스타터 월정액', 'monthly', 8900, 'monthly', 0, true),
  ('polibot_basic_monthly_99000', 'polibot', 'POLIBOT 베이직 월정액 50회', 'monthly', 8900, 'monthly', 0, true),
  ('polibot_lifetime_590000', 'polibot', 'POLIBOT 프로 1년 이용', 'onetime', 590000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;

update billing_products
set active = false
where id = 'polibot_pro_monthly_290000';
