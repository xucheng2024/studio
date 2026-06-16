-- Make credits_required nullable so sessions can opt out of pass/voucher support.
-- NULL means "no pass required / passes not accepted".

alter table public.class_sessions
  alter column credits_required drop not null,
  alter column credits_required drop default;

alter table public.class_sessions
  drop constraint "class_sessions_credits_required_check";

alter table public.class_sessions
  add constraint class_sessions_credits_required_check
    check (credits_required is null or credits_required > 0);

-- Guard both pass-booking RPCs: if credits_required IS NULL the session does not
-- accept passes, so reject immediately with a clear error code.

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
  if s.credits_required is null then
    return jsonb_build_object('ok', false, 'error', 'passes_not_accepted');
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
  if s.credits_required is null then
    return jsonb_build_object('ok', false, 'error', 'passes_not_accepted');
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
