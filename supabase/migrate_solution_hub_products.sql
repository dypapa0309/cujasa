insert into jasain_products (id, name, description, app_url, landing_url, status)
values
  ('cujasa', 'CUJASA', '쿠팡 파트너스 자동화 콘솔', 'https://app.jasain.kr', 'https://jasain.kr/cujasa', 'active'),
  ('dexor', 'DEXOR', '블로그 분석 및 선정 자동화', 'https://app.jasain.kr', 'https://jasain.kr/dexor', 'active'),
  ('spread', 'SPREAD', '추천 캠페인 운영 자동화', 'https://app.jasain.kr', 'https://jasain.kr', 'active'),
  ('polibot', 'POLIBOT', '보험 보장분석 및 상품 추천 자동화', 'https://app.jasain.kr', 'https://app.jasain.kr/polibot?mode=register#tab=beta', 'active'),
  ('infludex', 'INFLUDEX', '인스타그램 인플루언서 등급 분석', 'https://app.jasain.kr', 'https://app.jasain.kr/infludex?mode=register#tab=beta', 'active')
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  app_url = excluded.app_url,
  landing_url = excluded.landing_url,
  status = excluded.status,
  updated_at = now();

alter table accounts
  alter column active_time_windows set default '[{"start":"09:00","end":"09:00"}]'::jsonb;
