alter table public.payments
  add column if not exists gateway_status text,
  add column if not exists gateway_payload text,
  add column if not exists manual_refund_reference text,
  add column if not exists manual_refund_recorded_at timestamptz,
  add column if not exists manual_refund_recorded_by uuid references public.users(id) on delete set null;

