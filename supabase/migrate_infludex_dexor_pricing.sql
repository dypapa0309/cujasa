insert into billing_products (id, app_product_id, name, plan, amount, billing_cycle, max_accounts, active)
values
  ('infludex_credit_5000', 'infludex', 'INFLUDEX 라이트 분석 30회', 'onetime', 5000, 'once', 0, true),
  ('infludex_credit_10000', 'infludex', 'INFLUDEX 베이직 분석 100회', 'onetime', 10000, 'once', 0, true),
  ('infludex_credit_50000', 'infludex', 'INFLUDEX 프로 분석 250회', 'onetime', 50000, 'once', 0, true)
on conflict (id) do update set
  app_product_id = excluded.app_product_id,
  name = excluded.name,
  plan = excluded.plan,
  amount = excluded.amount,
  billing_cycle = excluded.billing_cycle,
  max_accounts = excluded.max_accounts,
  active = excluded.active;

update billing_payments
set product_id = case product_id
  when 'infludex_credit_19000' then 'infludex_credit_5000'
  when 'infludex_credit_49000' then 'infludex_credit_10000'
  when 'infludex_credit_99000' then 'infludex_credit_50000'
  else product_id
end
where product_id in (
  'infludex_credit_19000',
  'infludex_credit_49000',
  'infludex_credit_99000'
);

update billing_subscriptions
set product_id = case product_id
  when 'infludex_credit_19000' then 'infludex_credit_5000'
  when 'infludex_credit_49000' then 'infludex_credit_10000'
  when 'infludex_credit_99000' then 'infludex_credit_50000'
  else product_id
end
where product_id in (
  'infludex_credit_19000',
  'infludex_credit_49000',
  'infludex_credit_99000'
);

update billing_products
set active = false
where id in (
  'infludex_credit_19000',
  'infludex_credit_49000',
  'infludex_credit_99000'
);
