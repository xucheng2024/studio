-- POS-04 Batch 1: observability for POS operation failures.

create table if not exists public.pos_operation_failures (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  sale_id uuid references public.pos_sales(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  operation text not null,
  error_code text not null,
  error_detail text,
  safe_payload jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_operation_failures_studio_time
  on public.pos_operation_failures (studio_id, occurred_at desc)
  where studio_id is not null;

create index if not exists idx_pos_operation_failures_location_time
  on public.pos_operation_failures (location_id, occurred_at desc)
  where location_id is not null;

create index if not exists idx_pos_operation_failures_code_time
  on public.pos_operation_failures (error_code, occurred_at desc);
