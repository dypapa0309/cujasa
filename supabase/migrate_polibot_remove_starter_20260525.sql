update billing_products
set active = false
where id = 'polibot_starter_monthly_39000';

insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('polibot_basic_monthly_99000', 'polibot', 'POLIBOT 베이직 월정액 100회', 'monthly', 79000, 'monthly', 0, true),
  ('polibot_lifetime_590000', 'polibot', 'POLIBOT 프로 영구구매', 'onetime', 590000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;
