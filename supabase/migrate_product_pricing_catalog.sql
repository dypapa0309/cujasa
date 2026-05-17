insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('infludex_credit_19000', 'infludex', 'INFLUDEX 라이트 분석 30회', 'onetime', 5000, 'once', 0, true),
  ('infludex_credit_49000', 'infludex', 'INFLUDEX 베이직 분석 100회', 'onetime', 10000, 'once', 0, true),
  ('infludex_credit_99000', 'infludex', 'INFLUDEX 프로 분석 250회', 'onetime', 50000, 'once', 0, true),
  ('spread_starter_monthly_49000', 'spread', 'SPREAD 스타터 월정액', 'monthly', 49000, 'monthly', 0, true),
  ('spread_basic_monthly_149000', 'spread', 'SPREAD 베이직 월정액', 'monthly', 149000, 'monthly', 0, true),
  ('spread_pro_monthly_390000', 'spread', 'SPREAD 프로 월정액', 'monthly', 390000, 'monthly', 0, true),
  ('polibot_starter_monthly_39000', 'polibot', 'POLIBOT 스타터 월정액', 'monthly', 39000, 'monthly', 0, true),
  ('polibot_basic_monthly_99000', 'polibot', 'POLIBOT 베이직 월정액', 'monthly', 99000, 'monthly', 0, true),
  ('polibot_pro_monthly_290000', 'polibot', 'POLIBOT 프로 월정액', 'monthly', 290000, 'monthly', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;
