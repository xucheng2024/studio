alter table public.bookings
  add column if not exists credit_consumed_at timestamptz,
  add column if not exists credit_consumption_source text;

create or replace function public.consume_booking_credit_once(p_booking_id uuid, p_reason text default 'checkin')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings%rowtype;
  cp public.client_packages%rowtype;
  pay public.payments%rowtype;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'booking_not_found');
  end if;
  if b.credit_consumed_at is not null then
    return jsonb_build_object('ok', true, 'already_consumed', true);
  end if;

  if b.client_package_id is not null then
    select * into cp from public.client_packages where id = b.client_package_id for update;
    if found and cp.credits_left > 0 then
      update public.client_packages
        set credits_left = credits_left - 1
      where id = cp.id;
      update public.bookings
        set credit_consumed_at = now(),
            credit_consumption_source = 'package',
            credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
              jsonb_build_object('credit_consumed_reason', p_reason, 'credit_source', 'package')
      where id = b.id;
      return jsonb_build_object('ok', true, 'source', 'package');
    end if;
  end if;

  if b.payment_id is not null then
    select * into pay from public.payments where id = b.payment_id for update;
    if found and coalesce(pay.remaining_uses, 0) > 0 then
      update public.payments
        set remaining_uses = remaining_uses - 1
      where id = pay.id;
      update public.bookings
        set credit_consumed_at = now(),
            credit_consumption_source = 'single',
            credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
              jsonb_build_object('credit_consumed_reason', p_reason, 'credit_source', 'single')
      where id = b.id;
      return jsonb_build_object('ok', true, 'source', 'single');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'source', 'none');
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
  v_credit jsonb;
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
    select 1 from public.studios s where s.id = v_session.studio_id and s.owner_id = p_actor_id
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

  v_credit := public.consume_booking_credit_once(b.id, 'checkin');

  update public.bookings
    set status = 'attended',
        checked_in_at = now(),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) ||
          jsonb_build_object('checkin_by', p_actor_id::text, 'checkin_at', now())
  where id = b.id;

  return jsonb_build_object('ok', true, 'credit', v_credit);
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
  v_next_status text;
  v_should_consume boolean := false;
  v_credit jsonb := '{}'::jsonb;
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
  v_is_staff := exists (select 1 from public.studios s where s.id = v_session.studio_id and s.owner_id = p_actor_id)
    or exists (
      select 1 from public.staff_memberships sm
      where sm.user_id = p_actor_id and sm.studio_id = v_session.studio_id and sm.is_active = true
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

  if b.status = 'pending' then
    update public.bookings
      set status = 'cancelled', cancelled_at = now(), cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
          credit_policy_applied = jsonb_build_object('policy', 'pending_unpaid_cancel', 'credit_consumed', false)
    where id = b.id;
    return jsonb_build_object('ok', true, 'status', 'cancelled', 'credit_consumed', false);
  end if;

  v_is_after_cutoff := now() >= (v_session.start_time - make_interval(hours => coalesce(v_rule.cancel_cutoff_hours, 12)));
  v_next_status := case when v_is_after_cutoff then 'late_cancel' else 'cancelled' end;
  v_should_consume := v_next_status = 'late_cancel' and coalesce(v_rule.late_cancel_deduct_credit, true);

  if v_next_status = 'cancelled' then
    update public.class_sessions set spots_left = spots_left + 1 where id = b.session_id;
  end if;
  if v_should_consume then
    v_credit := public.consume_booking_credit_once(b.id, 'late_cancel');
  end if;

  update public.bookings
    set status = v_next_status,
        cancelled_at = now(),
        cancel_reason = coalesce(p_cancel_reason, 'user_cancel'),
        credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) || jsonb_build_object(
          'policy', case when v_next_status='late_cancel' then 'late_cancel' else 'normal_cancel' end,
          'cutoff_hours', coalesce(v_rule.cancel_cutoff_hours, 12),
          'after_cutoff', v_is_after_cutoff,
          'credit_consumed', v_should_consume
        )
  where id = b.id;

  return jsonb_build_object('ok', true, 'status', v_next_status, 'credit', v_credit);
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
  v_count int := 0;
  v_buffer int;
begin
  for r in
    select b.id, b.location_id, c.studio_id, cs.start_time
    from public.bookings b
    join public.class_sessions cs on cs.id = b.session_id
    join public.classes c on c.id = cs.class_id
    where b.status = 'booked' and b.checked_in_at is null
    order by cs.start_time
    limit greatest(coalesce(p_limit, 500), 1)
    for update of b skip locked
  loop
    select br.no_show_deduct_credit, br.no_show_buffer_min
    into v_rule
    from public.booking_rules br
    where br.studio_id = r.studio_id and (br.location_id = r.location_id or br.location_id is null)
    order by br.location_id nulls last
    limit 1;

    v_buffer := greatest(coalesce(v_rule.no_show_buffer_min, 15), 0);
    if now() < (r.start_time + make_interval(mins => v_buffer)) then
      continue;
    end if;

    if coalesce(v_rule.no_show_deduct_credit, true) then
      perform public.consume_booking_credit_once(r.id, 'no_show');
    end if;

    update public.bookings
      set status = 'no_show',
          no_show_marked_at = now(),
          credit_policy_applied = coalesce(credit_policy_applied, '{}'::jsonb) || jsonb_build_object(
            'policy', 'no_show',
            'credit_consumed', coalesce(v_rule.no_show_deduct_credit, true),
            'no_show_buffer_min', v_buffer
          )
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.consume_booking_credit_once(uuid, text) to service_role;
