-- HitPay gateway integration fields.

alter table public.payments
  add column if not exists gateway_payment_id text,
  add column if not exists gateway_checkout_url text,
  add column if not exists gateway_status text,
  add column if not exists gateway_payload text;

create index if not exists idx_payments_gateway_payment_id
  on public.payments (gateway_payment_id);
