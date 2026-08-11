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
      and b.status in ('pending','booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  if p_client_id is null and v_guest_email is not null and exists (
    select 1
    from public.event_bookings b
    where b.event_id = p_event_id
      and lower(trim(coalesce(b.guest_email, ''))) = v_guest_email
      and b.status in ('pending','booked')
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
  if coalesce(v_session.hitpay_enabled, false) is not true then
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

create or replace function public.create_member_booking_auto(
  p_session_id uuid,
  p_client_id uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  s                     record;
  v_rule                record;
  v_active_count        int := 0;
  v_weekly_late         int := 0;
  v_booking_id          uuid;
  v_selected_package_id uuid;
  v_has_candidate       boolean;
  v_has_enough          boolean;
begin
  select
    cs.id,
    cs.status,
    cs.start_time,
    cs.spots_left,
    cs.location_id,
    cs.credits_required,
    c.studio_id,
    st.contract_status
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  join public.studios st on st.id = c.studio_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if s.start_time is not null and s.start_time <= now() then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if coalesce(s.contract_status, 'active') = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'studio_suspended');
  end if;
  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  select br.max_active_bookings_per_client, br.max_weekly_late_cancel
  into v_rule
  from public.booking_rules br
  where br.studio_id = s.studio_id
    and (br.location_id = s.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  select count(*)::int into v_active_count
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('pending', 'booked')
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
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
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
    return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
  end if;

  select exists (
    select 1
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    where cp.client_id   = p_client_id
      and pkg.studio_id  = s.studio_id
      and (pkg.location_id is null or pkg.location_id = s.location_id)
      and (cp.expiry_date is null or cp.expiry_date > now())
  ) into v_has_candidate;
  if not v_has_candidate then
    return jsonb_build_object('ok', false, 'error', 'no_eligible_package');
  end if;

  select exists (
    select 1
    from public.client_packages cp
    join public.packages pkg on pkg.id = cp.package_id
    where cp.client_id    = p_client_id
      and pkg.studio_id   = s.studio_id
      and (pkg.location_id is null or pkg.location_id = s.location_id)
      and (cp.expiry_date is null or cp.expiry_date > now())
      and cp.credits_left >= s.credits_required
  ) into v_has_enough;
  if not v_has_enough then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  select cp.id into v_selected_package_id
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.client_id    = p_client_id
    and pkg.studio_id   = s.studio_id
    and (pkg.location_id is null or pkg.location_id = s.location_id)
    and (cp.expiry_date is null or cp.expiry_date > now())
    and cp.credits_left >= s.credits_required
  order by cp.expiry_date asc nulls last, cp.created_at asc, cp.id asc
  for update of cp
  limit 1;

  if v_selected_package_id is null then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  insert into public.bookings (
    session_id, location_id, client_id,
    status, payment_status, client_package_id,
    credits_consumed, credit_consumed_at, credit_consumption_source,
    credit_policy_applied
  ) values (
    p_session_id, s.location_id, p_client_id,
    'booked', 'paid', v_selected_package_id,
    s.credits_required, now(), 'package',
    jsonb_build_object('credit_deducted_at', 'booking', 'credits_required', s.credits_required)
  ) returning id into v_booking_id;

  update public.client_packages
  set credits_left = credits_left - s.credits_required
  where id = v_selected_package_id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'selected_package_id', v_selected_package_id,
    'credits_required', s.credits_required
  );
end;
$$;

create or replace function public.create_package_booking(
  p_session_id uuid,
  p_client_id uuid,
  p_client_package_id uuid
) returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  s              record;
  cp             record;
  v_rule         record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
begin
  select
    cs.id,
    cs.status,
    cs.start_time,
    cs.spots_left,
    cs.location_id,
    cs.credits_required,
    c.studio_id,
    st.contract_status
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  join public.studios st on st.id = c.studio_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if s.start_time is not null and s.start_time <= now() then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
  end if;
  if coalesce(s.contract_status, 'active') = 'suspended' then
    return jsonb_build_object('ok', false, 'error', 'studio_suspended');
  end if;
  if s.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  select cp.id, cp.client_id, cp.credits_left, cp.expiry_date,
         pkg.id as package_id, pkg.studio_id, pkg.location_id
  into cp
  from public.client_packages cp
  join public.packages pkg on pkg.id = cp.package_id
  where cp.id        = p_client_package_id
    and cp.client_id = p_client_id
  for update of cp;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'package_not_found');
  end if;
  if cp.studio_id <> s.studio_id then
    return jsonb_build_object('ok', false, 'error', 'studio_mismatch');
  end if;
  if cp.location_id is not null and cp.location_id <> s.location_id then
    return jsonb_build_object('ok', false, 'error', 'location_mismatch');
  end if;
  if cp.expiry_date is not null and cp.expiry_date <= now() then
    return jsonb_build_object('ok', false, 'error', 'package_expired');
  end if;
  if cp.credits_left < s.credits_required then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits');
  end if;

  if exists (
    select 1 from public.bookings b
    where b.session_id = p_session_id
      and b.client_id  = p_client_id
      and b.status in ('pending', 'booked')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_has_booking');
  end if;

  select br.max_active_bookings_per_client, br.max_weekly_late_cancel
  into v_rule
  from public.booking_rules br
  where br.studio_id = s.studio_id
    and (br.location_id = s.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  select count(*)::int into v_active_count
  from public.bookings b
  join public.class_sessions cs on cs.id = b.session_id
  join public.classes c on c.id = cs.class_id
  where b.client_id = p_client_id
    and b.status in ('pending', 'booked')
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
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
    and c.studio_id = s.studio_id
    and (s.location_id is null or b.location_id = s.location_id);
  if v_weekly_late >= coalesce(v_rule.max_weekly_late_cancel, 2) then
    return jsonb_build_object('ok', false, 'error', 'late_cancel_limit_exceeded');
  end if;

  insert into public.bookings (
    session_id, location_id, client_id,
    status, payment_status, client_package_id,
    credits_consumed, credit_consumed_at, credit_consumption_source,
    credit_policy_applied
  ) values (
    p_session_id, s.location_id, p_client_id,
    'booked', 'paid', p_client_package_id,
    s.credits_required, now(), 'package',
    jsonb_build_object('credit_deducted_at', 'booking', 'credits_required', s.credits_required)
  ) returning id into v_booking_id;

  update public.client_packages
  set credits_left = credits_left - s.credits_required
  where id = cp.id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_pending_event_booking(uuid, uuid, text, text, text) from public;
revoke all on function public.create_pending_event_booking(uuid, uuid, text, text, text) from anon;
revoke all on function public.create_pending_event_booking(uuid, uuid, text, text, text) from authenticated;
grant all on function public.create_pending_event_booking(uuid, uuid, text, text, text) to service_role;

revoke all on function public.cancel_pending_event_payment(uuid, text) from public;
revoke all on function public.cancel_pending_event_payment(uuid, text) from anon;
revoke all on function public.cancel_pending_event_payment(uuid, text) from authenticated;
grant all on function public.cancel_pending_event_payment(uuid, text) to service_role;

revoke all on function public.confirm_event_payment(uuid) from public;
revoke all on function public.confirm_event_payment(uuid) from anon;
revoke all on function public.confirm_event_payment(uuid) from authenticated;
grant all on function public.confirm_event_payment(uuid) to service_role;

revoke all on function public.confirm_event_payment_with_invoice(uuid, uuid) from public;
revoke all on function public.confirm_event_payment_with_invoice(uuid, uuid) from anon;
revoke all on function public.confirm_event_payment_with_invoice(uuid, uuid) from authenticated;
grant all on function public.confirm_event_payment_with_invoice(uuid, uuid) to service_role;

revoke all on function public.create_pending_booking(uuid, uuid, text, text, text) from public;
revoke all on function public.create_pending_booking(uuid, uuid, text, text, text) from anon;
revoke all on function public.create_pending_booking(uuid, uuid, text, text, text) from authenticated;
grant all on function public.create_pending_booking(uuid, uuid, text, text, text) to service_role;

revoke all on function public.create_member_booking_auto(uuid, uuid) from public;
revoke all on function public.create_member_booking_auto(uuid, uuid) from anon;
revoke all on function public.create_member_booking_auto(uuid, uuid) from authenticated;
grant all on function public.create_member_booking_auto(uuid, uuid) to service_role;

revoke all on function public.create_package_booking(uuid, uuid, uuid) from public;
revoke all on function public.create_package_booking(uuid, uuid, uuid) from anon;
revoke all on function public.create_package_booking(uuid, uuid, uuid) from authenticated;
grant all on function public.create_package_booking(uuid, uuid, uuid) to service_role;

revoke all on function public.cancel_pending_payment(uuid, text) from public;
revoke all on function public.cancel_pending_payment(uuid, text) from anon;
revoke all on function public.cancel_pending_payment(uuid, text) from authenticated;
grant all on function public.cancel_pending_payment(uuid, text) to service_role;

revoke all on function public.confirm_payment(uuid) from public;
revoke all on function public.confirm_payment(uuid) from anon;
revoke all on function public.confirm_payment(uuid) from authenticated;
grant all on function public.confirm_payment(uuid) to service_role;

revoke all on function public.confirm_payment_with_invoice(uuid, uuid) from public;
revoke all on function public.confirm_payment_with_invoice(uuid, uuid) from anon;
revoke all on function public.confirm_payment_with_invoice(uuid, uuid) from authenticated;
grant all on function public.confirm_payment_with_invoice(uuid, uuid) to service_role;

revoke all on function public.confirm_paynow_payment(uuid, boolean) from public;
revoke all on function public.confirm_paynow_payment(uuid, boolean) from anon;
revoke all on function public.confirm_paynow_payment(uuid, boolean) from authenticated;
grant all on function public.confirm_paynow_payment(uuid, boolean) to service_role;

revoke all on function public.refund_payment_with_invoice_void(uuid, uuid, text) from public;
revoke all on function public.refund_payment_with_invoice_void(uuid, uuid, text) from anon;
revoke all on function public.refund_payment_with_invoice_void(uuid, uuid, text) from authenticated;
grant all on function public.refund_payment_with_invoice_void(uuid, uuid, text) to service_role;
