insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('sponsored_monthly_19000', 'cujasa', 'CUJASA 스폰서 스타터', 'monthly', 19000, 'monthly', 1, true),
  ('onetime_590000', 'cujasa', 'CUJASA 프로 영구구매', 'onetime', 590000, 'once', 4, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;
