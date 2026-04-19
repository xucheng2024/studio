-- Migration 034 moved the spots_left decrement into create_pending_booking so
-- that a seat is atomically reserved the moment a guest submits a booking
-- (preventing overselling under concurrency).  The original confirm_paynow_payment
-- function (005) was NOT updated at that time, so it still contains a second
-- spots_left decrement — causing every PayNow booking to consume TWO seats.
--
-- Additionally, both expire_pending_payments (005) and the API-level cancel path
-- cancel the associated booking without restoring the seat that was reserved at
-- creation time.
--
-- This migration fixes all three issues:
--   1. Remove the duplicate spots_left decrement from confirm_paynow_payment.
--   2. Restore spots_left in expire_pending_payments.
--   3. Add cancel_pending_payment() RPC used by the mark route for atomic
--      fail/expire handling that correctly restores the seat.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Fix confirm_paynow_payment
--    Seats are already reserved by create_pending_booking; here we only need
--    to flip the booking to 'booked' and process the package credit grant.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_paynow_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.payments%rowtype;
  b   public.bookings%rowtype;
  pkg public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id  uuid;
begin
  select * into p
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'booking_id', p.booking_id);
  end if;

  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  -- Payment has already expired: clean up and restore the reserved seat.
  if p.expires_at is not null and p.expires_at < now() then
    update public.payments set status = 'expired' where id = p.id;

    if p.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = p.booking_id and status = 'pending';

      -- Restore the seat that was reserved at booking-creation time.
      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = p.booking_id);
      end if;
    end if;

    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- Confirm the booking: seat was already claimed in create_pending_booking,
  -- so we only need to flip the status — no spots_left change here.
  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    update public.bookings
      set status = 'booked', payment_status = 'paid'
    where id = b.id and status = 'pending';
  end if;

  -- Grant package credits when this payment covers a package purchase.
  if p.package_id is not null and p.client_id is not null then
    select * into pkg from public.packages where id = p.package_id;
    if found then
      v_expiry :=
        case
          when pkg.expiry_days is null then null
          else now() + make_interval(days => pkg.expiry_days)
        end;

      insert into public.client_packages (client_id, package_id, credits_left, expiry_date)
      values (p.client_id, p.package_id, pkg.credits, v_expiry)
      returning id into v_cp_id;
    end if;
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p.booking_id,
    'client_package_id', v_cp_id
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fix expire_pending_payments (cron)
--    Restore the seat whenever a pending booking is cancelled on expiry.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.expire_pending_payments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r             record;
  updated_count integer := 0;
begin
  for r in
    select id, booking_id
    from public.payments
    where status     = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      -- Cancel the booking only if it is still pending (not yet confirmed/cancelled).
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = r.booking_id and status = 'pending';

      -- Restore the seat reserved by create_pending_booking.
      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. New RPC: cancel_pending_payment
--    Used by /api/payment/mark when staff sets status to failed or expired.
--    Atomically cancels the payment, cancels the pending booking (if any),
--    and restores the reserved seat.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_pending_payment(
  p_payment_id uuid,
  p_new_status text  -- 'failed' | 'expired'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.payments%rowtype;
begin
  if p_new_status not in ('failed', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  select * into p from public.payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;

  update public.payments set status = p_new_status where id = p.id;

  if p.booking_id is not null then
    update public.bookings
      set status = 'cancelled', payment_status = p_new_status
    where id = p.booking_id and status = 'pending';

    if found then
      update public.class_sessions
        set spots_left = spots_left + 1
      where id = (select session_id from public.bookings where id = p.booking_id);
    end if;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.cancel_pending_payment(uuid, text) to service_role;
