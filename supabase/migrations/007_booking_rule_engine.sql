-- Booking rule engine + audit fields

alter table public.bookings
  add column if not exists cancel_reason text,
  add column if not exists no_show_marked_at timestamptz,
  add column if not exists credit_policy_applied jsonb;

create or replace function public.create_pending_booking(
  p_session_id uuid,
  p_client_id uuid default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_booking_id uuid;
  v_guest_email text := nullif(lower(trim(coalesce(p_guest_email, ''))), '');
begin
  select
    cs.id,
    cs.spots_left,
    cs.location_id,
    c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = p_session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  if v_session.spots_left <= 0 then
    return jsonb_build_object('ok', false, 'error', 'full');
  end if;

  if p_client_id is null and (coalesce(trim(p_guest_name), '') = '' or v_guest_email is null) then
    return jsonb_build_object('ok', false, 'error', 'guest_details_required');
  end if;

  if p_client_id is not null then
    if exists (
      select 1
      from public.bookings b
      where b.session_id = p_session_id
        and b.client_id = p_client_id
        and b.status in ('pending', 'booked')
    ) then
      return jsonb_build_object('ok', false, 'error', 'already_has_booking');
    end if;
  elsif v_guest_email is not null then
    if exists (
      select 1
      from public.bookings b
      where b.session_id = p_session_id
        and b.guest_email = v_guest_email
        and b.status in ('pending', 'booked')
    ) then
      return jsonb_build_object('ok', false, 'error', 'already_has_booking');
    end if;
  end if;

  insert into public.bookings (
    session_id,
    location_id,
    client_id,
    guest_name,
    guest_email,
    guest_phone,
    status,
    payment_status
  )
  values (
    p_session_id,
    v_session.location_id,
    p_client_id,
    case when p_client_id is null then nullif(trim(p_guest_name), '') else null end,
    case when p_client_id is null then v_guest_email else null end,
    case when p_client_id is null then nullif(trim(coalesce(p_guest_phone, '')), '') else null end,
    'pending',
    'pending'
  )
  returning id into v_booking_id;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'studio_id', v_session.studio_id,
    'location_id', v_session.location_id
  );
end;
$$;

create or replace function public.cancel_booking_with_rules(
  p_booking_id uuid,
  p_actor_id uuid,
  p_cancel_reason text default 'user_cancel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_session record;
  v_rule record;
  v_is_client boolean := false;
  v_is_staff boolean := false;
  v_is_after_cutoff boolean := false;
  v_return_credit boolean := false;
  v_next_status text;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select
    cs.id as session_id,
    cs.start_time,
    c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id
  for update of cs;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'session_not_found');
  end if;

  v_is_client := b.client_id is not null and b.client_id = p_actor_id;
  v_is_staff := exists (
    select 1
    from public.studios s
    where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_session.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not (v_is_client or v_is_staff) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if b.status not in ('pending', 'booked') then
    return jsonb_build_object('ok', false, 'error', 'not_cancellable');
  end if;

  select
    br.cancel_cutoff_hours,
    br.late_cancel_deduct_credit
  into v_rule
  from public.booking_rules br
  where br.studio_id = v_session.studio_id
    and (br.location_id = b.location_id or br.location_id is null)
  order by br.location_id nulls last
  limit 1;

  if b.status = 'pending' then
    update public.bookings
      set status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
          credit_policy_applied = jsonb_build_object(
            'policy', 'pending_unpaid_cancel',
            'credit_returned', false
          )
    where id = b.id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'credit_returned', false);
  end if;

  v_is_after_cutoff := now() >= (
    v_session.start_time - make_interval(hours => coalesce(v_rule.cancel_cutoff_hours, 12))
  );
  v_next_status := case when v_is_after_cutoff then 'late_cancel' else 'cancelled' end;
  v_return_credit := case
    when not v_is_after_cutoff then true
    when coalesce(v_rule.late_cancel_deduct_credit, true) then false
    else true
  end;

  if v_next_status = 'cancelled' then
    update public.class_sessions
      set spots_left = spots_left + 1
    where id = b.session_id;
  end if;

  if v_return_credit then
    if b.client_package_id is not null then
      update public.client_packages
        set credits_left = credits_left + 1
      where id = b.client_package_id;
    end if;
    if b.payment_id is not null then
      update public.payments
        set remaining_uses = remaining_uses + 1
      where id = b.payment_id;
    end if;
  end if;

  update public.bookings
    set status = v_next_status,
        cancelled_at = now(),
        cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
        credit_policy_applied = jsonb_build_object(
          'policy', case when v_next_status = 'late_cancel' then 'late_cancel' else 'normal_cancel' end,
          'cutoff_hours', coalesce(v_rule.cancel_cutoff_hours, 12),
          'after_cutoff', v_is_after_cutoff,
          'credit_returned', v_return_credit
        )
  where id = b.id;

  return jsonb_build_object(
    'ok', true,
    'status', v_next_status,
    'credit_returned', v_return_credit
  );
end;
$$;

create or replace function public.checkin_booking(
  p_booking_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  v_session record;
  v_authorized boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if b.status <> 'booked' then
    return jsonb_build_object('ok', false, 'error', 'not_booked');
  end if;

  select
    cs.id as session_id,
    c.studio_id
  into v_session
  from public.class_sessions cs
  join public.classes c on c.id = cs.class_id
  where cs.id = b.session_id;

  v_authorized := exists (
    select 1
    from public.studios s
    where s.id = v_session.studio_id and s.owner_id = p_actor_id
  ) or exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = v_session.studio_id
      and sm.is_active = true
      and sm.role in ('owner', 'manager', 'frontdesk', 'instructor')
      and (sm.location_id is null or sm.location_id = b.location_id)
  );

  if not v_authorized then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.bookings
    set status = 'attended',
        checked_in_at = now(),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
          jsonb_build_object('checkin_by', p_actor_id::text, 'checkin_at', now())
  where id = b.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.process_no_show_bookings(
  p_limit int default 500
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_rule record;
  v_refund boolean;
  v_count int := 0;
begin
  for r in
    select
      b.id,
      b.client_package_id,
      b.payment_id,
      b.location_id,
      b.session_id,
      c.studio_id
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.status = 'booked'
      and b.checked_in_at is null
      and cs.start_time < now()
    order by cs.start_time
    limit greatest(coalesce(p_limit, 500), 1)
    for update of b skip locked
  loop
    select
      br.no_show_deduct_credit
    into v_rule
    from public.booking_rules br
    where br.studio_id = r.studio_id
      and (br.location_id = r.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    v_refund := not coalesce(v_rule.no_show_deduct_credit, true);

    if v_refund then
      if r.client_package_id is not null then
        update public.client_packages
          set credits_left = credits_left + 1
        where id = r.client_package_id;
      end if;
      if r.payment_id is not null then
        update public.payments
          set remaining_uses = remaining_uses + 1
        where id = r.payment_id;
      end if;
    end if;

    update public.bookings
      set status = 'no_show',
          no_show_marked_at = now(),
          credit_policy_applied = jsonb_build_object(
            'policy', 'no_show',
            'credit_returned', v_refund,
            'no_show_deduct_credit', not v_refund
          )
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Keep legacy rpc name routed through new rule engine
create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.cancel_booking_with_rules(p_booking_id, auth.uid(), 'legacy_cancel');
end;
$$;

grant execute on function public.create_pending_booking(uuid, uuid, text, text, text) to service_role;
grant execute on function public.cancel_booking_with_rules(uuid, uuid, text) to service_role;
grant execute on function public.checkin_booking(uuid, uuid) to service_role;
grant execute on function public.process_no_show_bookings(int) to service_role;
grant execute on function public.cancel_booking(uuid) to authenticated, service_role;
