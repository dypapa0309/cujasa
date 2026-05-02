update accounts a
set status = 'paused',
    updated_at = now()
where a.name in (
  '직장인 꿀템',
  '육아 꿀템',
  '자취 꿀템',
  '살림 꿀템',
  'andsomofficial01 꿀템',
  'with_som_it',
  'with_som_3'
)
and not exists (
  select 1
  from user_accounts ua
  where ua.account_id = a.id
);
