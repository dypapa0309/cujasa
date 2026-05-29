update billing_products
set
  name = 'CUJASA 프로 1년 이용',
  amount = 590000,
  billing_cycle = 'once',
  max_accounts = 4,
  active = true
where id = 'onetime_590000';

update billing_products
set
  name = 'CUJASA 베이직 월정액',
  amount = 129000,
  billing_cycle = 'monthly',
  max_accounts = 2,
  active = true
where id = 'monthly_59000';

update billing_products
set
  name = 'POLIBOT 프로 1년 이용',
  amount = 590000,
  billing_cycle = 'once',
  active = true
where id = 'polibot_lifetime_590000';
