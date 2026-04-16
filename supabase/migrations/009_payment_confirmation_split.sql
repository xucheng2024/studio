alter table public.payments
  add column if not exists customer_confirmed_at timestamptz,
  add column if not exists customer_confirmation_note text,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users (id) on delete set null;
