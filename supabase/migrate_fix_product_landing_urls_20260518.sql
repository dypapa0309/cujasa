update jasain_products
set landing_url = case id
  when 'polibot' then 'https://app.jasain.kr/polibot?mode=register#tab=beta'
  when 'infludex' then 'https://app.jasain.kr/infludex?mode=register#tab=beta'
  when 'sublog' then 'https://app.jasain.kr/sublog?mode=register#tab=beta'
  when 'auvibot' then 'https://app.jasain.kr/auvibot?mode=register#tab=beta'
  else landing_url
end
where id in ('polibot', 'infludex', 'sublog', 'auvibot');
