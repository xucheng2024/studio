-- POS-01 batch 6: connect pos_sales -> payments for proceed-to-payment flow.
-- Scope:
--   * payments.pos_sale_id traceable mapping
--   * one active payment per sale (idempotent create)
--   * allow explicit POS payment source classification

alter table public.payments
add column if not exists pos_sale_id uuid references public.pos_sales(id) on delete set null;

create unique index if not exists uq_payments_pos_sale_id
  on public.payments (pos_sale_id)
  where pos_sale_id is not null;

create index if not exists idx_payments_studio_pos_sale_created_desc
  on public.payments (studio_id, pos_sale_id, created_at desc)
  where pos_sale_id is not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'payments_source_check'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments drop constraint payments_source_check;
  end if;
end $$;

alter table public.payments
add constraint payments_source_check
check (source = any (array[
  'online_booking'::text,
  'package_buy'::text,
  'event_booking'::text,
  'membership_subscription'::text,
  'member_zone_purchase'::text,
  'shop_purchase'::text,
  'service_purchase'::text,
  'pos_sale'::text
]));
