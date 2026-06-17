create or replace function public.create_pending_booking(
  p_session_id uuid,
  p_client_id uuid default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_session      record;
  v_rule         record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
  v_guest_email  text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select
    cs.id,
    cs.status,
    cs.spots_left,
    cs.location_id,
    cs.start_time,
    cs.guest_price,
    cs.credits_required,
    c.studio_id,
    s.contract_status,
    s.hitpay_enabled
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  join public.studios s on s.id = c.studio_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(v_session.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if v_session.start_time is not null and v_session.start_time <= now() then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if coalesce(v_session.contract_status, 'active') = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'studio_suspended');
  end if;
  if coalesce(v_session.guest_price, 0) > 0 and coalesce(v_session.hitpay_enabled, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'hitpay_not_configured');
  end if;
  if v_session.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null and exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1 from public.bookings b
    where b.session_id  = p_session_id
      and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is not null then
    select br.max_active_bookings_per_client, br.max_weekly_late_cancel
    into v_rule
    from public.booking_rules br
    where br.studio_id = v_session.studio_id
      and (br.location_id = v_session.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    select count(*)::int into v_active_count
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.client_id = p_client_id
      and b.status in ('pending', 'booked')
      and c.studio_id = v_session.studio_id
      and (v_session.location_id is null or b.location_id = v_session.location_id);
    if v_active_count >= coalesce(v_rule.max_active_bookings_per_client, 3) then
      return jsonb_build_object('ok', false, 'error', 'active_booking_limit_exceeded');
    end if;

    select count(*)::int into v_weekly_late
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.client_id = p_client_id
      and b.status in ('late_cancel', 'no_show')
      and b.created_at >= now() - interval '7 days'
      and c.studio_id = v_session.studio_id
      and (v_session.location_id is null or b.location_id = v_session.location_id);
    if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
      return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
    end if;
  end if;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = p_session_id;

  insert into public.bookings (
    session_id, location_id, client_id,
    guest_name, guest_email, guest_phone,
    status, payment_status
  ) values (
    p_session_id, v_session.location_id, p_client_id,
    case when p_client_id is null then nullif(trim(p_guest_name), '') else null end,
    case when p_client_id is null then v_guest_email else null end,
    case when p_client_id is null then nullif(trim(coalesce(p_guest_phone, '')), '') else null end,
    'pending', 'pending'
  ) returning id into v_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'studio_id', v_session.studio_id,
    'location_id', v_session.location_id
  );
end;
$$;
