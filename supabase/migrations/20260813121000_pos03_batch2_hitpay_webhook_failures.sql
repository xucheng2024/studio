-- POS-03 Batch 2: record HitPay webhook failures for operations observability.

create table if not exists public.hitpay_webhook_failures (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'hitpay',
  studio_id uuid references public.studios(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  provider_event_id text,
  provider_payment_id text,
  reference_code text,
  event_object text,
  event_type text,
  error_code text not null,
  error_detail text,
  payload_hash text,
  safe_payload jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_hitpay_webhook_failures_studio_time
  on public.hitpay_webhook_failures (studio_id, occurred_at desc)
  where studio_id is not null;

create index if not exists idx_hitpay_webhook_failures_location_time
  on public.hitpay_webhook_failures (location_id, occurred_at desc)
  where location_id is not null;

create index if not exists idx_hitpay_webhook_failures_code_time
  on public.hitpay_webhook_failures (error_code, occurred_at desc);
