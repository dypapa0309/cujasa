alter table accounts
  add column if not exists anonymous_learning_enabled boolean not null default false;

alter table accounts
  add column if not exists personal_reference_patterns jsonb not null default '[]',
  add column if not exists blog_auto_publish_enabled boolean not null default false,
  add column if not exists blog_publish_mode text not null default 'test_only',
  add column if not exists blog_base_url text,
  add column if not exists toss_share_link_enabled boolean not null default false,
  add column if not exists toss_share_link_url text,
  add column if not exists toss_share_link_label text,
  add column if not exists toss_share_link_memo text;

create table if not exists trend_reference_patterns (
  id uuid primary key default gen_random_uuid(),
  category text,
  target_audience_hint text,
  hook_pattern text not null,
  comment_question_pattern text,
  tension_type text,
  emotion_signal text,
  reusable_structure text,
  voice_pattern text,
  format_pattern text,
  line_break_pattern text,
  list_structure text,
  punctuation_style text,
  tone_register text,
  performance_score int not null default 0,
  safety_flags jsonb not null default '[]',
  source_type text not null default 'text_paste'
    check (source_type in ('text_paste', 'screenshot_ocr', 'admin_seed')),
  quality_status text not null default 'candidate'
    check (quality_status in ('candidate', 'approved', 'rejected')),
  source_fingerprint text,
  usage_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_trend_reference_patterns_status_category
  on trend_reference_patterns(quality_status, category, performance_score desc);

create unique index if not exists idx_trend_reference_patterns_source_fingerprint
  on trend_reference_patterns(source_fingerprint)
  where source_fingerprint is not null;
