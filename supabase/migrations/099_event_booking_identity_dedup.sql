-- Event booking dedup hardening: block cross-channel duplicates (client_id vs guest_email).

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
  v_client_email text := null;
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

  if p_client_id is not null then
    select nullif(lower(trim(coalesce(u.email, ''))), '')
    into v_client_email
    from public.users u
    where u.id = p_client_id;
  end if;

  -- Logged-in flow: block if same client already has any non-cancelled booking,
  -- or if the same identity already exists as guest email/client email.
  if p_client_id is not null and exists (
    select 1
    from public.event_bookings b
    left join public.users u on u.id = b.client_id
    where b.event_id = p_event_id
      and b.status <> 'cancelled'
      and (
        b.client_id = p_client_id
        or (v_client_email is not null and lower(trim(coalesce(b.guest_email, ''))) = v_client_email)
        or (v_client_email is not null and lower(trim(coalesce(u.email, ''))) = v_client_email)
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  -- Guest flow: block if same guest email already exists in guest or client bookings.
  if p_client_id is null and v_guest_email is not null and exists (
    select 1
    from public.event_bookings b
    left join public.users u on u.id = b.client_id
    where b.event_id = p_event_id
      and b.status <> 'cancelled'
      and (
        lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
        or lower(trim(coalesce(u.email, ''))) = v_guest_email
      )
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
