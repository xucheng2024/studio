-- After removing customer self-confirmation, payments are confirmed only by staff.
-- Two problems arise with the previous logic:
--
--   1. The 15-minute expiry was designed for the self-confirm flow.  Staff may not
--      see the queue within 15 minutes, so an honest payment would expire before
--      it could be confirmed.  Fixed by the caller (book/create) using a smarter
--      expiry (class-start minus 2 h, capped at 24 h).
--
--   2. confirm_paynow_payment rejected any payment whose status was not 'pending'.
--      Once the cron (expire_pending_payments) ran and set status = 'expired', staff
--      had no way to force-confirm even though the money was in the account.
--
-- This migration rewrites confirm_paynow_payment so that:
--   • p_force = false (default, used by the cron/auto paths): behaviour unchanged —
--     only 'pending' payments are accepted; expiry check still applies.
--   • p_force = true (used by confirm_paynow_payment_with_invoice / staff path):
--     also accepts 'expired' payments, reinstates the booking when possible.
--
-- confirm_paynow_payment_with_invoice is also rewritten to pass p_force = true.

create or replace function public.confirm_paynow_payment(
  p_payment_id uuid,
  p_force       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.payments%rowtype;
  b        public.bookings%rowtype;
  s        public.class_sessions%rowtype;
  pkg      public.packages%rowtype;
  v_expiry timestamptz;
  v_cp_id  uuid;
  v_seat_restored boolean := false;
begin
  select * into p from public.payments where id = p_payment_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  -- Already confirmed — idempotent.
  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'booking_id', p.booking_id);
  end if;

  -- ── Normal (non-forced) path ─────────────────────────────────────────────
  if not p_force then
    if p.status <> 'pending' then
      return jsonb_build_object('ok', false, 'error', 'not_pending');
    end if;

    -- Expiry guard: auto-cancel booking and restore the seat.
    if p.expires_at is not null and p.expires_at < now() then
      update public.payments set status = 'expired' where id = p.id;

      if p.booking_id is not null then
        update public.bookings
          set status = 'cancelled', payment_status = 'pending'
        where id = p.booking_id and status = 'pending';

        if found then
          update public.class_sessions
            set spots_left = spots_left + 1
          where id = (select session_id from public.bookings where id = p.booking_id);
        end if;
      end if;

      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

  -- ── Forced (staff override) path ─────────────────────────────────────────
  else
    -- Accept 'pending' and 'expired'; anything else (failed, refunded…) is a no-op.
    if p.status not in ('pending', 'expired') then
      return jsonb_build_object('ok', false, 'error', 'not_confirmable');
    end if;
  end if;

  -- ── Confirm the booking ──────────────────────────────────────────────────
  if p.booking_id is not null then
    select * into b from public.bookings where id = p.booking_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'booking_not_found');
    end if;

    if b.status = 'pending' then
      -- Normal case: booking is still pending — just flip it.
      update public.bookings
        set status = 'booked', payment_status = 'paid'
      where id = b.id;

    elsif b.status = 'cancelled' and p_force then
      -- Payment expired and cron already cancelled the booking.
      -- Try to reclaim a seat if one is still available.
      select * into s from public.class_sessions where id = b.session_id for update;
      if found and coalesce(s.spots_left, 0) > 0 then
        update public.class_sessions set spots_left = spots_left - 1 where id = s.id;
        update public.bookings
          set status = 'booked',
              payment_status = 'paid',
              cancelled_at = null,
              cancel_reason = null
        where id = b.id;
        v_seat_restored := true;
      else
        -- No seats left — reinstate payment but leave booking cancelled.
        -- Staff will need to handle the rebooking manually.
        update public.bookings set payment_status = 'paid' where id = b.id;
      end if;
    end if;
  end if;

  -- ── Grant package credits ────────────────────────────────────────────────
  if p.package_id is not null and p.client_id is not null then
    -- Only insert a new client_package if none exists yet for this payment.
    if not exists (
      select 1 from public.client_packages cp
      join public.packages pkg2 on pkg2.id = cp.package_id
      where cp.client_id = p.client_id
        and cp.package_id = p.package_id
        and cp.created_at >= p.created_at
    ) then
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
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = p.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', p.booking_id,
    'client_package_id', v_cp_id,
    'seat_restored', v_seat_restored
  );
end;
$$;

-- Staff-facing entry point: always passes p_force = true so expired payments
-- can be recovered and expiry is never a blocker.
create or replace function public.confirm_paynow_payment_with_invoice(
  p_payment_id uuid,
  p_verified_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_confirm jsonb;
  v_ok      boolean;
  v_error   text;
  v_invoice text;
begin
  v_confirm := public.confirm_paynow_payment(p_payment_id, true);
  v_ok := coalesce((v_confirm ->> 'ok')::boolean, false);
  if not v_ok then
    v_error := coalesce(v_confirm ->> 'error', 'confirm_failed');
    return jsonb_build_object('ok', false, 'error', v_error);
  end if;

  select public.assign_payment_invoice_number(p_payment_id) into v_invoice;
  if v_invoice is null or btrim(v_invoice) = '' then
    return jsonb_build_object('ok', false, 'error', 'invoice_assign_failed');
  end if;

  update public.payments
  set verified_at = now(), verified_by = p_verified_by
  where id = p_payment_id;

  return jsonb_build_object(
    'ok', true,
    'invoice_number', v_invoice,
    'already_paid',      coalesce((v_confirm ->> 'already_paid')::boolean, false),
    'booking_id',        v_confirm ->> 'booking_id',
    'client_package_id', v_confirm ->> 'client_package_id',
    'seat_restored',     coalesce((v_confirm ->> 'seat_restored')::boolean, false)
  );
end;
$$;

grant execute on function public.confirm_paynow_payment(uuid, boolean) to service_role;
