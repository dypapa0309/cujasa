insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('dexor_credit_5000', 'dexor', 'DEXOR 크레딧 10회 충전', 'onetime', 5000, 'once', 0, true),
  ('dexor_credit_10000', 'dexor', 'DEXOR 크레딧 25회 충전', 'onetime', 10000, 'once', 0, true),
  ('dexor_credit_50000', 'dexor', 'DEXOR 크레딧 150회 충전', 'onetime', 50000, 'once', 0, true),
  ('dexor_credit_100000', 'dexor', 'DEXOR 크레딧 350회 충전', 'onetime', 100000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;
