update jasain_products
set landing_url = case id
  when 'polibot' then 'https://app.jasain.kr/?mode=register&product=polibot#tab=beta'
  when 'infludex' then 'https://app.jasain.kr/?mode=register&product=infludex#tab=beta'
  when 'sublog' then 'https://app.jasain.kr/?mode=register&product=sublog#tab=beta'
  when 'auvibot' then 'https://app.jasain.kr/?mode=register&product=auvibot#tab=beta'
  else landing_url
end
where id in ('polibot', 'infludex', 'sublog', 'auvibot');
