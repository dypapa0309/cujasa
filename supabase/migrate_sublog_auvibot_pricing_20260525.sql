insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('sublog_starter_monthly_49000', 'sublog', 'SUBLOG 스타터 월정액', 'monthly', 49000, 'monthly', 0, true),
  ('auvibot_starter_monthly_49000', 'auvibot', 'AUVIBOT 스타터 월정액', 'monthly', 49000, 'monthly', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;
