-- Event booking: one non-cancelled seat per guest; block cancel/refund while attended.

drop index if exists public.uq_event_bookings_event_client_active;
drop index if exists public.uq_event_bookings_event_guest_email_active;

create unique index if not exists uq_event_bookings_event_client_not_cancelled
on public.event_bookings (event_id, client_id)
where client_id is not null and status <> 'cancelled';

create unique index if not exists uq_event_bookings_event_guest_email_not_cancelled
on public.event_bookings (event_id, lower(trim(guest_email)))
where guest_email is not null and btrim(guest_email) <> '' and status <> 'cancelled';

-- Expand duplicate guard in create_pending_event_booking (any non-cancelled row blocks re-book).
create or replace function public.create_pending_event_booking(
  p_event_id uuid,
  p_client_id uuid default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_event record;
  v_booking_id uuid;
  v_guest_email text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select
    e.id,
    e.studio_id,
    e.location_id,
    e.is_active,
    e.spots_left,
    e.start_time,
    e.price,
    s.contract_status,
    s.hitpay_enabled
  into v_event
  from public.events e
  join public.studios s on s.id = e.studio_id
  where e.id = p_event_id
  for update of e;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;
  if coalesce(v_event.is_active, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'event_not_available');
  end if;
  if coalesce(v_event.spots_left, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;
  if v_event.start_time is not null and v_event.start_time <= now() then
    return jsonb_build_object('ok', false, 'error', 'event_not_available');
  end if;
  if coalesce(v_event.contract_status, 'active') = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'studio_suspended');
  end if;
  if coalesce(v_event.hitpay_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'hitpay_not_configured');
  end if;
  if coalesce(v_event.price, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null and exists (
    select 1
    from public.event_bookings b
    where b.event_id = p_event_id
      and b.client_id = p_client_id
      and b.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1
    from public.event_bookings b
    where b.event_id = p_event_id
      and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
      and b.status <> 'cancelled'
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  update public.events
  set spots_left = spots_left - 1
  where id = p_event_id;

  insert into public.event_bookings (
    event_id, location_id, client_id,
    guest_name, guest_email, guest_phone,
    status, payment_status
  ) values (
    p_event_id, v_event.location_id, p_client_id,
    case when p_client_id is null then nullif(trim(p_guest_name), '') else null end,
    case when p_client_id is null then v_guest_email else null end,
    case when p_client_id is null then nullif(trim(coalesce(p_guest_phone, '')), '') else null end,
    'pending', 'pending'
  ) returning id into v_booking_id;

  return jsonb_build_object(
    'ok', true,
    'event_booking_id', v_booking_id,
    'studio_id', v_event.studio_id,
    'location_id', v_event.location_id
  );
end;
$$;

create or replace function public.staff_cancel_event_booking(
  p_event_booking_id uuid,
  p_actor_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  b public.event_bookings%rowtype;
  e public.events%rowtype;
  p public.payments%rowtype;
begin
  select * into b
  from public.event_bookings
  where id = p_event_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_booking_not_found');
  end if;

  if b.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'event_booking_id', b.id);
  end if;

  if b.status = 'attended' then
    return jsonb_build_object('ok', false, 'error', 'must_uncheckin_first');
  end if;

  select * into e
  from public.events
  where id = b.event_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;

  if b.payment_id is not null then
    select * into p
    from public.payments
    where id = b.payment_id
    for update;

    if found and p.status = 'pending' then
      update public.payments
      set status = 'failed'
      where id = p.id;
    end if;
  end if;

  update public.event_bookings
  set
    status = 'cancelled',
    checked_in_at = null,
    checked_in_by = null
  where id = b.id;

  update public.events
  set spots_left = spots_left + 1
  where id = e.id;

  return jsonb_build_object(
    'ok', true,
    'event_booking_id', b.id,
    'event_id', b.event_id
  );
end;
$$;

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
    'invoice_number', v_payment.invoice_number
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
      invoice_voided_at = now(),
      invoice_void_reason = v_reason
    where id = p_payment_id;
    v_void_applied := true;
  else
    update public.payments
    set status = 'refunded'
    where id = p_payment_id;
  end if;

  select * into v_payment from public.payments where id = p_payment_id;

  v_after := jsonb_build_object(
    'status', v_payment.status,
    'invoice_status', v_payment.invoice_status,
    'invoice_number', v_payment.invoice_number,
    'invoice_voided_at', v_payment.invoice_voided_at,
    'invoice_void_reason', v_payment.invoice_void_reason,
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
    'invoice_void_applied', v_void_applied,
    'session_seat_released', v_session_seat_released,
    'event_seat_released', v_event_seat_released
  );
end;
$$;
