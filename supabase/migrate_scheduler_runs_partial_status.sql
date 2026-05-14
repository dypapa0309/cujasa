alter table scheduler_runs
  drop constraint if exists scheduler_runs_status_check;

alter table scheduler_runs
  add constraint scheduler_runs_status_check
  check (status in ('running', 'completed', 'partial', 'failed'));
