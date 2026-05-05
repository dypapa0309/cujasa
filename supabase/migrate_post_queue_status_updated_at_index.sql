create index if not exists idx_post_queue_status_updated_at
  on post_queue(status, updated_at);
