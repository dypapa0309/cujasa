create table if not exists polibot_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  scope text not null default 'user' check (scope in ('global', 'user')),
  source_channel text not null check (source_channel in ('local_ingest', 'web_upload', 'admin_upload', 'kakao_txt')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  source_label text,
  dry_run boolean not null default false,
  summary jsonb not null default '{}',
  error_message text,
  parser_version text not null default 'polibot-parser-v1',
  extractor_version text not null default 'polibot-extractor-v1',
  classifier_version text not null default 'polibot-classifier-v1',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'global' or user_id is not null)
);

create table if not exists polibot_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  ingest_job_id uuid references polibot_ingest_jobs(id) on delete set null,
  user_id uuid references users(id) on delete cascade,
  scope text not null default 'user' check (scope in ('global', 'user')),
  source_channel text not null check (source_channel in ('local_ingest', 'web_upload', 'admin_upload', 'kakao_txt')),
  status text not null default 'review_needed' check (status in ('recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict')),
  file_name text not null,
  file_type text not null default 'unknown',
  file_size bigint not null default 0,
  file_hash text,
  text_hash text,
  storage_path text,
  month text,
  company text,
  companies jsonb not null default '[]',
  product_group text,
  keywords jsonb not null default '[]',
  product_names jsonb not null default '[]',
  normalized_source jsonb not null default '{}',
  text_snippet text,
  redacted_snippet text,
  metadata jsonb not null default '{}',
  parser_version text not null default 'polibot-parser-v1',
  extractor_version text not null default 'polibot-extractor-v1',
  classifier_version text not null default 'polibot-classifier-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'global' or user_id is not null)
);

create table if not exists polibot_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references polibot_knowledge_sources(id) on delete cascade,
  ingest_job_id uuid references polibot_ingest_jobs(id) on delete set null,
  user_id uuid references users(id) on delete cascade,
  scope text not null default 'user' check (scope in ('global', 'user')),
  status text not null default 'review_needed' check (status in ('recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict')),
  chunk_index int not null default 0,
  chunk_type text not null default 'text',
  chunk_hash text not null,
  content text not null,
  redacted_content text,
  insurance_relevance_score int not null default 0,
  keywords jsonb not null default '[]',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'global' or user_id is not null)
);

create table if not exists polibot_catalog_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references polibot_knowledge_sources(id) on delete cascade,
  chunk_id uuid references polibot_knowledge_chunks(id) on delete set null,
  ingest_job_id uuid references polibot_ingest_jobs(id) on delete set null,
  user_id uuid references users(id) on delete cascade,
  scope text not null default 'user' check (scope in ('global', 'user')),
  status text not null default 'review_needed' check (status in ('recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict')),
  company text,
  product_name text not null,
  product_group text,
  coverage_keywords jsonb not null default '[]',
  premium_example text,
  age_range text,
  payment_term text,
  renewal_type text,
  disclosure_memo text,
  reduction_memo text,
  target_audience jsonb not null default '[]',
  excluded_audience jsonb not null default '[]',
  completeness text,
  auto_confirm_score int not null default 0,
  confidence_score int not null default 0,
  effective_month text,
  evidence jsonb not null default '{}',
  metadata jsonb not null default '{}',
  parser_version text not null default 'polibot-parser-v1',
  extractor_version text not null default 'polibot-extractor-v1',
  classifier_version text not null default 'polibot-classifier-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'global' or user_id is not null)
);

create table if not exists polibot_conversation_insights (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references polibot_knowledge_sources(id) on delete cascade,
  chunk_id uuid references polibot_knowledge_chunks(id) on delete set null,
  ingest_job_id uuid references polibot_ingest_jobs(id) on delete set null,
  user_id uuid references users(id) on delete cascade,
  scope text not null default 'user' check (scope in ('global', 'user')),
  status text not null default 'review_needed' check (status in ('recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict')),
  insight_type text not null default 'consultation',
  needs jsonb not null default '[]',
  existing_insurance text,
  target_premium text,
  current_premium text,
  existing_medical_plan text,
  medical_history text,
  questions jsonb not null default '[]',
  recommendation_hints jsonb not null default '[]',
  summary text,
  redacted_summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scope = 'global' or user_id is not null)
);

create table if not exists polibot_recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  recommendation_id text not null,
  customer_id text,
  rating text not null check (rating in ('good', 'unclear', 'wrong')),
  reason text,
  memo text,
  recommendation_snapshot jsonb not null default '{}',
  knowledge_snapshot jsonb not null default '{}',
  routed_to_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_polibot_sources_scope_file_hash
  on polibot_knowledge_sources(scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), file_hash)
  where file_hash is not null;

create unique index if not exists idx_polibot_sources_scope_text_hash
  on polibot_knowledge_sources(scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), text_hash)
  where text_hash is not null;

create unique index if not exists idx_polibot_chunks_source_hash
  on polibot_knowledge_chunks(source_id, chunk_hash);

create index if not exists idx_polibot_chunks_scope_hash
  on polibot_knowledge_chunks(scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), chunk_hash);

create index if not exists idx_polibot_sources_scope_status
  on polibot_knowledge_sources(scope, status, created_at desc);

create index if not exists idx_polibot_sources_user_scope
  on polibot_knowledge_sources(user_id, scope, created_at desc);

create index if not exists idx_polibot_catalog_scope_status
  on polibot_catalog_items(scope, status, company, product_group);

create index if not exists idx_polibot_catalog_user_scope
  on polibot_catalog_items(user_id, scope, status);

create index if not exists idx_polibot_catalog_product_name
  on polibot_catalog_items(product_name);

create index if not exists idx_polibot_chunks_scope_status
  on polibot_knowledge_chunks(scope, status, insurance_relevance_score desc);

create index if not exists idx_polibot_feedback_user_created
  on polibot_recommendation_feedback(user_id, created_at desc);

create index if not exists idx_polibot_feedback_rating_created
  on polibot_recommendation_feedback(rating, created_at desc);
