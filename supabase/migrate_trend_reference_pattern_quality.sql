alter table trend_reference_patterns
  add column if not exists quality_score int not null default 0,
  add column if not exists analysis_profile jsonb not null default '{}',
  add column if not exists preview_posts jsonb not null default '[]';

create index if not exists idx_trend_reference_patterns_quality
  on trend_reference_patterns(quality_status, quality_score desc, performance_score desc);
