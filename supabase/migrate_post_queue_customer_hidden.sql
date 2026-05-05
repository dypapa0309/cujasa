alter table post_queue
  add column if not exists customer_hidden_at timestamptz,
  add column if not exists customer_hidden_reason text;

create index if not exists idx_post_queue_customer_hidden
  on post_queue(account_id, customer_hidden_at);

-- 고객 화면에서는 숨김 처리된 과거 실패 큐를 제외합니다.
-- 운영/관리자 화면에서는 row를 삭제하지 않고 감사 기록으로 유지합니다.
