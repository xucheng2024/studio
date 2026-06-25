alter table public.payments
  add column if not exists refunded_at timestamptz;

update public.payments
set refunded_at = coalesce(refunded_at, invoice_voided_at, verified_at, paid_at, created_at)
where status = 'refunded'
  and refunded_at is null;

create or replace function public.refund_payment_with_invoice_void(
  p_payment_id uuid,
  p_operator_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_payment public.payments%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_void_applied boolean := false;
  v_reason text;
  v_booking public.bookings%rowtype;
  v_event_booking public.event_bookings%rowtype;
  v_session_seat_released boolean := false;
  v_event_seat_released boolean := false;
  v_refunded_at timestamptz := now();
begin
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;

  if v_payment.status = 'refunded' then
    return jsonb_build_object(
      'ok', true,
      'already_refunded', true,
      'status', v_payment.status,
      'invoice_status', v_payment.invoice_status,
      'invoice_number', v_payment.invoice_number,
      'invoice_voided_at', v_payment.invoice_voided_at,
      'invoice_void_reason', v_payment.invoice_void_reason,
      'refunded_at', v_payment.refunded_at,
      'invoice_void_applied', v_payment.invoice_number is not null and v_payment.invoice_status = 'void',
      'session_seat_released', false,
      'event_seat_released', false
    );
  end if;

  if v_payment.status <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_paid');
  end if;

  v_before := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'refunded_at', v_payment.refunded_at
  );

  v_reason := case
    when p_reason is not null and length(trim(p_reason)) > 0 then trim(p_reason)
    else 'payment_refunded'
  end;

  if v_payment.booking_id is not null then
    select * into v_booking
    from public.bookings
    where id = v_payment.booking_id
    for update;

    if found and v_booking.status in ('pending', 'booked') then
      update public.bookings
      set
        status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = v_reason
      where id = v_booking.id;

      update public.class_sessions
      set spots_left = spots_left + 1
      where id = v_booking.session_id;

      v_session_seat_released := true;
    end if;
  end if;

  if v_payment.event_booking_id is not null then
    select * into v_event_booking
    from public.event_bookings
    where id = v_payment.event_booking_id
    for update;

    if found and v_event_booking.status = 'attended' then
      return jsonb_build_object('ok', false, 'error', 'must_uncheckin_first');
    end if;

    if found and v_event_booking.status in ('pending', 'booked') then
      update public.event_bookings
      set
        status = 'cancelled',
        checked_in_at = null,
        checked_in_by = null
      where id = v_event_booking.id;

      update public.events
      set spots_left = spots_left + 1
      where id = v_event_booking.event_id;

      v_event_seat_released := true;
    end if;
  end if;

  if v_payment.invoice_number is not null then
    update public.payments
    set
      status = 'refunded',
      invoice_status = 'void',
      invoice_voided_at = v_refunded_at,
      invoice_void_reason = v_reason,
      refunded_at = v_refunded_at
    where id = p_payment_id;
    v_void_applied := true;
  else
    update public.payments
    set
      status = 'refunded',
      refunded_at = v_refunded_at
    where id = p_payment_id;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;

  v_after := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason,
    'refunded_at', v_payment.refunded_at,
    'session_seat_released', v_session_seat_released,
    'event_seat_released', v_event_seat_released
  );

  insert into public.operation_audits (actor_id, actor_role, action, target_type, target_id, before_state, after_state)
  values (
    p_operator_id,
    'staff',
    'payment_refund_invoice_void',
    'payment',
    p_payment_id,
    v_before,
    v_after
  );

  return jsonb_build_object(
    'ok', true,
    'already_refunded', false,
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason,
    'refunded_at', v_payment.refunded_at,
    'invoice_void_applied', v_void_applied,
    'session_seat_released', v_session_seat_released,
    'event_seat_released', v_event_seat_released
  );
end;
$$;
