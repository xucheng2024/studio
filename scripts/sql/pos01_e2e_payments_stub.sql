-- Minimal payments stub for POS-01 E2E DB verification.
-- Batch-6 migration (20260813033000_pos01_payment_link_and_source.sql) will
-- add pos_sale_id and extend source constraint to include 'pos_sale'.

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  amount numeric(12,2) not null check (amount >= 0),
  type text not null default 'single'
    check (type = any (array['single'::text, 'package'::text, 'subscription'::text])),
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'refunded'::text])),
  remaining_uses integer not null default 0,
  created_at timestamptz not null default now(),
  currency text not null default 'SGD',
  payment_method text not null default 'cash',
  sales_channel text not null default 'frontdesk'
    check (sales_channel = any (array['online'::text, 'frontdesk'::text, 'dashboard'::text, 'system'::text])),
  source text not null default 'service_purchase'
    check (source = any (array[
      'online_booking'::text,
      'package_buy'::text,
      'event_booking'::text,
      'membership_subscription'::text,
      'member_zone_purchase'::text,
      'shop_purchase'::text,
      'service_purchase'::text
    ])),
  reference_code text,
  gateway_payment_id text,
  gateway_status text,
  gateway_payload text,
  gateway_refund_payment_id text,
  paid_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  unique (reference_code)
);

create index if not exists idx_payments_studio_created
  on public.payments (studio_id, created_at desc);
