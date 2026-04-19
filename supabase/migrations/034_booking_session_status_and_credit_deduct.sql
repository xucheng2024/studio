-- Fix 1: All three booking RPCs must refuse cancelled / non-scheduled sessions.
-- Fix 2: create_member_booking_auto and create_package_booking must deduct credits
--         immediately at booking time (not defer to check-in), so that a member
--         with 1 credit cannot create multiple concurrent bookings against the same
--         pool.  consume_booking_credit_once is already idempotent (credit_consumed_at
--         guard), so setting that flag at booking time prevents any double-deduction
--         at check-in or no-show processing.
-- Fix 3: cancel_booking_with_rules already returns credits on normal cancel; we
--         need it to return the correct amount (credits_required) not always 1.
--         We do this by recording credits_consumed on the booking row.

-- --------------------------------------------------------------------------
-- 0. Add bookings.credits_consumed to track actual deduction amount
-- --------------------------------------------------------------------------
alter table public.bookings
  add column if not exists credits_consumed int not null default 0;

-- --------------------------------------------------------------------------
-- 1. create_pending_booking  (PayNow / guest flow)
--    Only add session status guard; no credit logic here.
-- --------------------------------------------------------------------------
create or replace function public.create_pending_booking(
  p_session_id uuid,
  p_client_id  uuid    default null,
  p_guest_name  text   default null,
  p_guest_email text   default null,
  p_guest_phone text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session     record;
  v_rule        record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
  v_guest_email  text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.guest_price, cs.credits_required, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(v_session.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
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

  -- Atomically claim one seat. The FOR UPDATE lock above guarantees that
  -- concurrent callers see an up-to-date spots_left and only one of them
  -- can decrement it from 1 → 0, preventing overselling.
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

-- --------------------------------------------------------------------------
-- 2. create_member_booking_auto  (FEFO auto-select)
--    + session status guard
--    + immediate credit deduction
--    + set credit_consumed_at so consume_booking_credit_once is a no-op
-- --------------------------------------------------------------------------
create or replace function public.create_member_booking_auto(
  p_session_id uuid,
  p_client_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s                    record;
  v_rule               record;
  v_active_count       int := 0;
  v_weekly_late        int := 0;
  v_booking_id         uuid;
  v_selected_package_id uuid;
  v_has_candidate      boolean;
  v_has_enough         boolean;
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.credits_required, c.studio_id
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
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

  -- Check a candidate package exists (correct studio + location + not expired)
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

  -- Check sufficient credits exist
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

  -- Select best package (FEFO)
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

  -- Create booking
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

  -- Decrement credits immediately (prevents double-booking the same credit pool)
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

-- --------------------------------------------------------------------------
-- 3. create_package_booking  (manual staff / override path)
--    + session status guard
--    + immediate credit deduction
-- --------------------------------------------------------------------------
create or replace function public.create_package_booking(
  p_session_id         uuid,
  p_client_id          uuid,
  p_client_package_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s             record;
  cp            record;
  v_rule        record;
  v_active_count int := 0;
  v_weekly_late  int := 0;
  v_booking_id   uuid;
begin
  select cs.id, cs.status, cs.spots_left, cs.location_id,
         cs.credits_required, c.studio_id
  into s
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;
  if coalesce(s.status, 'scheduled') <> 'scheduled' then
    return jsonb_build_object('ok', false, 'error', 'session_not_available');
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

  -- Deduct credits immediately
  update public.client_packages
  set credits_left = credits_left - s.credits_required
  where id = cp.id;

  update public.class_sessions
  set spots_left = spots_left - 1
  where id = s.id;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

-- --------------------------------------------------------------------------
-- 4. cancel_booking_with_rules
--    Return the correct credit amount (credits_consumed) not always 1.
-- --------------------------------------------------------------------------
create or replace function public.cancel_booking_with_rules(
  p_booking_id    uuid,
  p_actor_id      uuid,
  p_cancel_reason text default 'user_cancel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b              public.bookings%rowtype;
  v_session      record;
  v_rule         record;
  v_is_client    boolean := false;
  v_is_staff     boolean := false;
  v_is_after_cutoff boolean := false;
  v_return_credit boolean := false;
  v_next_status  text;
  v_credits_to_return int := 0;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select cs.id as session_id, cs.start_time, c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  v_is_client := b.client_id is not null and b.client_id = p_actor_id;
  v_is_staff  := exists (
    select 1 from public.studios s
    where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1 from public.staff_memberships sm
    where sm.user_id    = p_actor_id
      and sm.studio_id  = v_session.studio_id
      and sm.is_active  = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not (v_is_client or v_is_staff) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if b.status not in ('pending', 'booked') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  select br.cancel_cutoff_hours, br.late_cancel_deduct_credit
  into v_rule
  from public.booking_rules br
  where br.studio_id = v_session.studio_id
    and (br.location_id = b.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  -- Pending (unpaid PayNow) booking: just cancel, no credit involved
  if b.status = 'pending' then
    update public.bookings
    set status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
        credit_policy_applied = jsonb_build_object(
          'policy', 'pending_unpaid_cancel', 'credit_returned', false
        )
    where id = b.id;
    -- Restore spot for pending bookings
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'credit_returned', false);
  end if;

  v_is_after_cutoff := now() >= (
    v_session.start_time - make_interval(hours => coalesce(v_rule.cancel_cutoff_hours, 12))
  );
  v_next_status := case when v_is_after_cutoff then 'late_cancel' else 'cancelled' end;
  v_return_credit := case
    when not v_is_after_cutoff                           then true
    when coalesce(v_rule.late_cancel_deduct_credit, true) then false
    else true
  end;

  if v_next_status = 'cancelled' then
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
  end if;

  -- Return the exact number of credits that were consumed at booking time
  if v_return_credit and b.client_package_id is not null then
    v_credits_to_return := greatest(coalesce(b.credits_consumed, 0), 1);
    update public.client_packages
    set credits_left = credits_left + v_credits_to_return
    where id = b.client_package_id;
  end if;
  if v_return_credit and b.payment_id is not null then
    update public.payments
    set remaining_uses = remaining_uses + 1
    where id = b.payment_id;
  end if;

  update public.bookings
  set status = v_next_status,
      cancelled_at = now(),
      cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
      credit_policy_applied = jsonb_build_object(
        'policy', case when v_next_status = 'late_cancel' then 'late_cancel' else 'normal_cancel' end,
        'cutoff_hours', coalesce(v_rule.cancel_cutoff_hours, 12),
        'after_cutoff', v_is_after_cutoff,
        'credit_returned', v_return_credit,
        'credits_returned', case when v_return_credit then v_credits_to_return else 0 end
      )
  where id = b.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_next_status,
    'credit_returned', v_return_credit
  );
end;
$$;

grant execute on function public.create_member_booking_auto(uuid, uuid) to service_role;
grant execute on function public.create_package_booking(uuid, uuid, uuid) to service_role;
grant execute on function public.cancel_booking_with_rules(uuid, uuid, text) to service_role;
