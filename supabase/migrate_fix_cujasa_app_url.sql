update jasain_products
set app_url = 'https://app.jasain.kr',
    updated_at = now()
where id = 'cujasa'
  and app_url = 'https://cujasa.jasain.kr';
