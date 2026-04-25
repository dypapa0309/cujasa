insert into projects (id, name, type, description, status)
values ('00000000-0000-0000-0000-000000000001', '쿠팡 파트너스 자동화', 'coupang', '계정별 쿠팡 파트너스 자동 포스팅 MVP', 'active')
on conflict (id) do update set name = excluded.name, type = excluded.type, status = excluded.status;

insert into accounts (
  project_id, name, platform, target_audience, content_scope, forbidden_topics, forbidden_words, tone, cta_style,
  daily_post_min, daily_post_max, active_time_windows, min_interval_minutes, link_post_ratio, no_link_post_ratio, rest_days_per_week, status
) values
('00000000-0000-0000-0000-000000000001', '자취 꿀템', 'threads', '20대 자취생', '원룸, 냄새, 수납, 빨래, 주방 생활 문제', '[]', '["100%","무조건","완벽","보장","치료","예방"]', '친근하고 실제 자취 경험처럼', '댓글 유도형', 2, 4, '[{"start":"09:00","end":"11:00"},{"start":"20:00","end":"23:00"}]', 50, 0.3, 0.7, 1, 'active'),
('00000000-0000-0000-0000-000000000001', '육아 꿀템', 'threads', '육아 중인 부모', '이유식, 외출 준비, 정리, 식기 관리', '["아기 안전 단정"]', '["100%","무조건","완벽","보장","치료","예방"]', '조심스럽고 실용적으로', '정보 공유형', 1, 3, '[{"start":"10:00","end":"12:00"},{"start":"21:00","end":"23:00"}]', 60, 0.25, 0.75, 1, 'active'),
('00000000-0000-0000-0000-000000000001', '직장인 꿀템', 'threads', '바쁜 직장인', '출근, 책상, 점심, 피로감 없는 생활 편의', '[]', '["100%","무조건","완벽","보장","치료","예방"]', '짧고 공감 있게', '키워드 안내형', 2, 3, '[{"start":"08:00","end":"09:30"},{"start":"18:30","end":"22:30"}]', 50, 0.3, 0.7, 1, 'active'),
('00000000-0000-0000-0000-000000000001', '살림 꿀템', 'threads', '살림 관심 사용자', '청소, 정리, 주방, 욕실 관리', '[]', '["100%","무조건","완벽","보장","치료","예방"]', '차분하고 실용적으로', '댓글 공유형', 2, 4, '[{"start":"09:30","end":"11:30"},{"start":"20:00","end":"22:30"}]', 50, 0.35, 0.65, 1, 'active');
