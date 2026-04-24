-- Move HitPay secrets out of studios and store gateway refund payment id.

create table if not exists public.studio_payment_secrets (
  studio_id uuid primary key references public.studios (id) on delete cascade,
  hitpay_api_key text,
  hitpay_webhook_salt text,
  updated_at timestamptz not null default now()
);

alter table public.studio_payment_secrets enable row level security;

-- No SELECT/UPDATE policies on purpose: only service_role should access this table.

alter table public.studios
  drop column if exists hitpay_api_key,
  drop column if exists hitpay_webhook_salt;

alter table public.payments
  add column if not exists gateway_refund_payment_id text;

create index if not exists idx_payments_gateway_refund_payment_id
  on public.payments (gateway_refund_payment_id);
