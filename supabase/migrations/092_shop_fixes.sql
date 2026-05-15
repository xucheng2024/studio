-- Fix 1: Add 'processing' status to shop_orders for atomic claim pattern
-- (prevents double stock decrement). Keep this deterministic and idempotent.
alter table public.shop_orders
drop constraint if exists shop_orders_status_check;

alter table public.shop_orders
add constraint shop_orders_status_check
check (status = any (array[
  'pending'::text,
  'processing'::text,
  'paid'::text,
  'failed'::text,
  'expired'::text,
  'refunded'::text
]));

-- Ensure fulfillment status constraint still exists in case a prior failed run
-- accidentally dropped it.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shop_orders'::regclass
      and conname = 'shop_orders_fulfillment_status_check'
  ) then
    alter table public.shop_orders
    add constraint shop_orders_fulfillment_status_check
    check (fulfillment_status = any (array[
      'unfulfilled'::text,
      'shipped'::text,
      'cancelled'::text
    ]));
  end if;
end $$;

-- Fix 2: Update expire_pending_payments to correctly map failed/cancelled → failed (not expired),
-- include 'processing' rows in the sweep, and clean up stale 'processing' orders (handler crash guard).
create or replace function public.expire_pending_payments()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id, event_booking_id
    from public.payments
    where status = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  for r in
    select id, booking_id, event_booking_id
    from public.payments
    where status = 'pending'
      and expires_at is null
      and created_at < now() - interval '2 hours'
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'expired'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  for r in
    select b.id as booking_id, b.session_id
    from public.bookings b
    join public.payments p on p.id = b.payment_id
    where b.status = 'pending'
      and p.status in ('failed', 'expired', 'cancelled')
    for update of b
  loop
    update public.bookings
      set status = 'cancelled', payment_status = 'expired'
    where id = r.booking_id and status = 'pending';

    if found then
      update public.class_sessions
        set spots_left = spots_left + 1
      where id = r.session_id;

      updated_count := updated_count + 1;
    end if;
  end loop;

  update public.member_zone_purchases mzp
  set status = 'expired',
      updated_at = now()
  from public.payments p
  where mzp.payment_id = p.id
    and mzp.status = 'pending'
    and p.status in ('expired', 'failed', 'cancelled');

  -- Map payment terminal status correctly: failed/cancelled → 'failed', expired → 'expired'.
  -- Also sweeps 'processing' rows that are tied to a terminal payment.
  update public.shop_orders so
  set status = case
      when p.status in ('failed', 'cancelled') then 'failed'
      else 'expired'
    end,
    updated_at = now()
  from public.payments p
  where so.payment_id = p.id
    and so.status in ('pending', 'processing')
    and p.status in ('expired', 'failed', 'cancelled');

  -- Clean up shop_orders stuck in 'processing' for more than 10 minutes
  -- (handles the case where the payment handler crashed between claiming the order and finishing).
  update public.shop_orders
  set status = 'failed',
      updated_at = now()
  where status = 'processing'
    and updated_at < now() - interval '10 minutes';

  return updated_count;
end;
$$;

-- Fix 3: RLS for shop_products — protect inactive products from anon reads.
alter table public.shop_products enable row level security;

drop policy if exists "shop_products_anon_read_active" on public.shop_products;
create policy "shop_products_anon_read_active"
  on public.shop_products
  for select
  using (is_active = true);

-- Fix 4: RLS for shop_orders — protect customer PII (name, phone, address).
-- All server-side code uses the service-role key which bypasses RLS.
alter table public.shop_orders enable row level security;

drop policy if exists "shop_orders_owner_select" on public.shop_orders;
create policy "shop_orders_owner_select"
  on public.shop_orders
  for select
  using (client_id = auth.uid());
