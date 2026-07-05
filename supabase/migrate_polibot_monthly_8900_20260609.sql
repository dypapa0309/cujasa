update billing_products
set amount = 8900,
    plan = 'monthly',
    billing_cycle = 'monthly'
where app_product_id = 'polibot'
  and billing_cycle = 'monthly';
