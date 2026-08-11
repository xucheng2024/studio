-- Event payment confirmation/cancellation helpers.

create or replace function public.cancel_pending_event_payment(
  p_payment_id uuid,
  p_new_status text
) returns jsonb
language plpgsql security definer
set search_path to 'public'
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
  if p.event_booking_id is null then
    return jsonb_build_object('ok', false, 'error', 'event_booking_missing');
  end if;

  update public.payments set status = p_new_status where id = p.id;

  update public.event_bookings
    set status = 'cancelled', payment_status = p_new_status
  where id = p.event_booking_id and status = 'pending';

  if found then
    update public.events
      set spots_left = spots_left + 1
    where id = (select event_id from public.event_bookings where id = p.event_booking_id);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cancel_pending_event_payment(uuid, text) from public;
grant all on function public.cancel_pending_event_payment(uuid, text) to anon;
grant all on function public.cancel_pending_event_payment(uuid, text) to authenticated;
grant all on function public.cancel_pending_event_payment(uuid, text) to service_role;

create or replace function public.confirm_event_payment(
  p_payment_id uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  p public.payments%rowtype;
  b public.event_bookings%rowtype;
begin
  select * into p from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'payment_not_found');
  end if;
  if p.status = 'paid' then
    return jsonb_build_object('ok', true, 'already_paid', true, 'event_booking_id', p.event_booking_id);
  end if;
  if p.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'not_pending');
  end if;
  if p.event_booking_id is null then
    return jsonb_build_object('ok', false, 'error', 'event_booking_missing');
  end if;

  select * into b from public.event_bookings where id = p.event_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_booking_not_found');
  end if;

  if b.status = 'pending' then
    update public.event_bookings
      set status = 'booked', payment_status = 'paid'
    where id = b.id;
  else
    -- If booking was cancelled/other, don't change it; keep idempotency.
    return jsonb_build_object('ok', false, 'error', 'booking_not_pending');
  end if;

  update public.payments set status = 'paid', paid_at = now() where id = p.id;

  return jsonb_build_object('ok', true, 'event_booking_id', b.id);
end;
$$;

revoke all on function public.confirm_event_payment(uuid) from public;
grant all on function public.confirm_event_payment(uuid) to anon;
grant all on function public.confirm_event_payment(uuid) to authenticated;
grant all on function public.confirm_event_payment(uuid) to service_role;

create or replace function public.confirm_event_payment_with_invoice(
  p_payment_id uuid,
  p_verified_by uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_confirm jsonb;
  v_ok boolean;
  v_error text;
  v_invoice text;
begin
  v_confirm := public.confirm_event_payment(p_payment_id);
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
    'already_paid', coalesce((v_confirm ->> 'already_paid')::boolean, false),
    'event_booking_id', v_confirm ->> 'event_booking_id'
  );
end;
$$;

revoke all on function public.confirm_event_payment_with_invoice(uuid, uuid) from public;
grant all on function public.confirm_event_payment_with_invoice(uuid, uuid) to anon;
grant all on function public.confirm_event_payment_with_invoice(uuid, uuid) to authenticated;
grant all on function public.confirm_event_payment_with_invoice(uuid, uuid) to service_role;

-- Extend payment expiry handler to also cancel pending event payments.
create or replace function public.expire_pending_payments() returns integer
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
    where status     = 'pending'
      and expires_at is not null
      and expires_at < now()
    for update
  loop
    update public.payments set status = 'expired' where id = r.id;

    if r.booking_id is not null then
      update public.bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = r.booking_id and status = 'pending';

      if found then
        update public.class_sessions
          set spots_left = spots_left + 1
        where id = (select session_id from public.bookings where id = r.booking_id);
      end if;
    end if;

    if r.event_booking_id is not null then
      update public.event_bookings
        set status = 'cancelled', payment_status = 'pending'
      where id = r.event_booking_id and status = 'pending';

      if found then
        update public.events
          set spots_left = spots_left + 1
        where id = (select event_id from public.event_bookings where id = r.event_booking_id);
      end if;
    end if;

    updated_count := updated_count + 1;
  end loop;

  return updated_count;
end;
$$;
