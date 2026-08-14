-- PKG-02 ops observability: persist periodic check runs for trend analysis.

create table if not exists public.pkg02_ops_check_runs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  backlog_threshold_hours integer not null default 24 check (backlog_threshold_hours > 0),
  self_approval_or_apply_count integer not null default 0 check (self_approval_or_apply_count >= 0),
  approved_not_applied_backlog_count integer not null default 0 check (approved_not_applied_backlog_count >= 0),
  applied_missing_manual_adjustment_ledger_count integer not null default 0 check (applied_missing_manual_adjustment_ledger_count >= 0),
  manual_adjustment_reconcile_diff_count integer not null default 0 check (manual_adjustment_reconcile_diff_count >= 0),
  total_requests_scanned integer not null default 0 check (total_requests_scanned >= 0),
  has_anomaly boolean not null default false,
  notify_status text not null default 'skipped' check (notify_status = any (array['sent'::text, 'skipped'::text, 'failed'::text])),
  notify_reason text,
  checks jsonb not null default '[]'::jsonb,
  samples jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_pkg02_ops_check_runs_studio_checked
  on public.pkg02_ops_check_runs (studio_id, checked_at desc)
  where studio_id is not null;

create index if not exists idx_pkg02_ops_check_runs_checked
  on public.pkg02_ops_check_runs (checked_at desc);

create index if not exists idx_pkg02_ops_check_runs_anomaly_checked
  on public.pkg02_ops_check_runs (has_anomaly, checked_at desc);

alter table public.pkg02_ops_check_runs enable row level security;

revoke all on table public.pkg02_ops_check_runs from public;
revoke all on table public.pkg02_ops_check_runs from anon;
revoke all on table public.pkg02_ops_check_runs from authenticated;
grant all on table public.pkg02_ops_check_runs to service_role;

