update billing_products
set amount = case id
  when 'infludex_credit_19000' then 5000
  when 'infludex_credit_49000' then 10000
  when 'infludex_credit_99000' then 50000
  else amount
end
where id in (
  'infludex_credit_19000',
  'infludex_credit_49000',
  'infludex_credit_99000'
);
