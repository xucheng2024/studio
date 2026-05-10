-- Fix expire_pending_payments to also sweep:
-- 1. Pending payments with no expires_at that are older than 2 hours (orphaned/legacy)
-- 2. Pending payments where expires_at IS set and has passed (existing logic preserved)
--
-- Also sweeps bookings that are still 'pending' but linked to a payment
-- that is already 'failed' or 'expired' (data inconsistency cleanup).

create or replace function public.expire_pending_payments()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  updated_count integer := 0;
begin
  -- ── 1. Normal sweep: pending payments with expires_at in the past ──────────
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

  -- ── 2. Orphaned sweep: pending payments with NO expires_at older than 2 h ──
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

  -- ── 3. Orphaned booking cleanup: booking pending but payment already failed/expired ──
  -- Handles the case where cancel_pending_payment was called but booking wasn't in
  -- 'pending' status at that moment, leaving spots unreleased.
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

  return updated_count;
end;
$$;
