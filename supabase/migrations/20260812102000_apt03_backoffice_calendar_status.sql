-- APT-03: backoffice appointment calendar + status transitions.
-- Scope:
--   * calendar query RPC (day/week range, studio/location + filters)
--   * atomic status-transition RPC with history/audit/idempotency fencing
--   * terminal-state resource release for completed / cancelled / no_show

-- ── Helper: actor role gate for status transitions ───────────────────────
create or replace function public.assert_salon_appointment_transition_actor_role(p_actor_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_actor_role not in ('owner', 'manager', 'frontdesk', 'instructor') then
    raise exception 'appointment status transition role % is not allowed', p_actor_role using errcode = '42501';
  end if;
end;
$$;


-- ── Helper: legal status transition graph ────────────────────────────────
create or replace function public.assert_salon_appointment_status_transition(
  p_from_status text,
  p_to_status text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_from_status = p_to_status then
    return;
  end if;

  if p_from_status = 'pending' and p_to_status in ('confirmed', 'cancelled', 'no_show') then
    return;
  end if;

  if p_from_status = 'confirmed' and p_to_status in ('checked_in', 'cancelled', 'no_show') then
    return;
  end if;

  if p_from_status = 'checked_in' and p_to_status in ('in_progress', 'cancelled', 'no_show') then
    return;
  end if;

  if p_from_status = 'in_progress' and p_to_status in ('completed', 'cancelled', 'no_show') then
    return;
  end if;

  raise exception 'illegal appointment status transition % -> %', p_from_status, p_to_status
    using errcode = '23514';
end;
$$;


-- ── RPC: list_salon_appointments_for_calendar ────────────────────────────
create or replace function public.list_salon_appointments_for_calendar(
  p_actor_role text,
  p_actor_employee_id uuid,
  p_studio_id uuid,
  p_range_start timestamptz,
  p_range_end timestamptz,
  p_location_id uuid default null,
  p_employee_id uuid default null,
  p_service_id uuid default null,
  p_statuses text[] default null
)
returns table (
  appointment_id uuid,
  studio_id uuid,
  location_id uuid,
  salon_customer_id uuid,
  service_id uuid,
  employee_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  occupied_from timestamptz,
  occupied_until timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  internal_note text,
  service_title_snapshot text,
  employee_name_snapshot text,
  location_name_snapshot text,
  customer_name text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text;
begin
  perform public.assert_salon_appointment_transition_actor_role(p_actor_role);

  if p_range_start is null or p_range_end is null or p_range_end <= p_range_start then
    raise exception 'invalid calendar time range' using errcode = '22023';
  end if;

  if p_range_end > p_range_start + interval '8 days' then
    raise exception 'calendar range cannot exceed 8 days' using errcode = '22023';
  end if;

  if p_location_id is not null and not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.studio_id = p_studio_id
  ) then
    raise exception 'location % does not belong to studio %', p_location_id, p_studio_id using errcode = '23514';
  end if;

  if p_employee_id is not null and not exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.studio_id = p_studio_id
  ) then
    raise exception 'employee % does not belong to studio %', p_employee_id, p_studio_id using errcode = '23514';
  end if;

  if p_service_id is not null and not exists (
    select 1
    from public.studio_services s
    where s.id = p_service_id
      and s.studio_id = p_studio_id
  ) then
    raise exception 'service % does not belong to studio %', p_service_id, p_studio_id using errcode = '23514';
  end if;

  if p_actor_role = 'instructor' then
    if p_actor_employee_id is null then
      raise exception 'instructor actor_employee_id is required' using errcode = '42501';
    end if;
    if p_employee_id is not null and p_employee_id <> p_actor_employee_id then
      raise exception 'instructor can only query own employee appointments' using errcode = '42501';
    end if;
  end if;

  if p_statuses is not null then
    foreach v_status in array p_statuses
    loop
      if v_status not in ('pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show') then
        raise exception 'invalid appointment status filter %', v_status using errcode = '22023';
      end if;
    end loop;
  end if;

  return query
  select
    a.id,
    a.studio_id,
    a.location_id,
    a.salon_customer_id,
    a.service_id,
    a.employee_id,
    a.status,
    a.starts_at,
    a.ends_at,
    a.occupied_from,
    a.occupied_until,
    a.expires_at,
    a.cancelled_at,
    a.cancellation_reason,
    a.internal_note,
    a.service_title_snapshot,
    a.employee_name_snapshot,
    a.location_name_snapshot,
    c.full_name,
    a.created_at,
    a.updated_at
  from public.salon_appointments a
  left join public.salon_customers c
    on c.id = a.salon_customer_id
  where a.studio_id = p_studio_id
    and a.starts_at >= p_range_start
    and a.starts_at < p_range_end
    and (p_location_id is null or a.location_id = p_location_id)
    and (p_employee_id is null or a.employee_id = p_employee_id)
    and (p_service_id is null or a.service_id = p_service_id)
    and (
      p_statuses is null
      or array_length(p_statuses, 1) is null
      or a.status = any(p_statuses)
    )
    and (
      p_actor_role <> 'instructor'
      or a.employee_id = p_actor_employee_id
    )
  order by a.starts_at asc, a.created_at asc, a.id asc;
end;
$$;

create index if not exists idx_salon_appointments_studio_employee_starts
  on public.salon_appointments (studio_id, employee_id, starts_at);

create index if not exists idx_salon_appointments_studio_service_starts
  on public.salon_appointments (studio_id, service_id, starts_at);


-- ── RPC: transition_salon_appointment_status ─────────────────────────────
create or replace function public.transition_salon_appointment_status(
  p_actor_id uuid,
  p_actor_role text,
  p_actor_employee_id uuid,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_to_status text,
  p_reason text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before public.salon_appointments%rowtype;
  v_after public.salon_appointments%rowtype;
  v_cancel_result jsonb;
  v_reason text;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
  v_released_count integer := 0;
  v_active_resource_count integer := 0;
begin
  v_idempotency_enabled := p_idempotency_key_id is not null or p_idempotency_claim_token is not null;
  if v_idempotency_enabled then
    if p_idempotency_key_id is null or p_idempotency_claim_token is null then
      raise exception 'both idempotency_key_id and claim_token are required together' using errcode = '23514';
    end if;
    perform public.assert_business_idempotency_claim_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_studio_id := p_studio_id,
      p_operation_scope := 'salon_appointment:status_transition'
    );
  end if;

  perform public.assert_salon_appointment_transition_actor_role(p_actor_role);

  if p_to_status not in ('confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show') then
    raise exception 'invalid target status %', p_to_status using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_to_status in ('cancelled', 'no_show') and v_reason is null then
    raise exception 'status % requires a reason', p_to_status using errcode = '23514';
  end if;

  if p_to_status = 'cancelled' then
    select * into v_before
    from public.salon_appointments
    where id = p_appointment_id
      and studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
    end if;

    if p_actor_role = 'instructor' then
      if p_actor_employee_id is null then
        raise exception 'instructor actor_employee_id is required' using errcode = '42501';
      end if;
      if v_before.employee_id <> p_actor_employee_id then
        raise exception 'instructor can only update own appointments' using errcode = '42501';
      end if;
      raise exception 'instructor cannot transition to status %', p_to_status using errcode = '42501';
    end if;

    select count(*) into v_active_resource_count
    from public.salon_appointment_resources
    where appointment_id = v_before.id
      and is_active;

    v_cancel_result := public.cancel_salon_appointment(
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_studio_id := p_studio_id,
      p_appointment_id := p_appointment_id,
      p_reason := v_reason,
      p_idempotency_key_id := null,
      p_idempotency_claim_token := null
    );

    select * into v_after
    from public.salon_appointments
    where id = p_appointment_id
      and studio_id = p_studio_id;

    v_released_count := case
      when coalesce((v_cancel_result ->> 'already_cancelled')::boolean, false)
        then 0
      else v_active_resource_count
    end;

    v_result := jsonb_build_object(
      'ok', true,
      'appointment_id', v_after.id,
      'from_status', v_before.status,
      'to_status', 'cancelled',
      'status', v_after.status,
      'already_in_target', coalesce((v_cancel_result ->> 'already_cancelled')::boolean, false),
      'released_resources', v_released_count
    );

    if v_idempotency_enabled then
      perform public.complete_business_idempotency_key_for_appointment(
        p_id := p_idempotency_key_id,
        p_claim_token := p_idempotency_claim_token,
        p_result_snapshot := v_result
      );
    end if;

    return v_result;
  end if;

  select * into v_before
  from public.salon_appointments
  where id = p_appointment_id
    and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if p_actor_role = 'instructor' then
    if p_actor_employee_id is null then
      raise exception 'instructor actor_employee_id is required' using errcode = '42501';
    end if;

    if v_before.employee_id <> p_actor_employee_id then
      raise exception 'instructor can only update own appointments' using errcode = '42501';
    end if;

    if p_to_status not in ('checked_in', 'in_progress', 'completed') then
      raise exception 'instructor cannot transition to status %', p_to_status using errcode = '42501';
    end if;
  end if;

  perform public.assert_salon_appointment_status_transition(v_before.status, p_to_status);

  if v_before.status = p_to_status then
    v_result := jsonb_build_object(
      'ok', true,
      'appointment_id', v_before.id,
      'from_status', v_before.status,
      'to_status', p_to_status,
      'status', v_before.status,
      'already_in_target', true,
      'released_resources', 0
    );

    if v_idempotency_enabled then
      perform public.complete_business_idempotency_key_for_appointment(
        p_id := p_idempotency_key_id,
        p_claim_token := p_idempotency_claim_token,
        p_result_snapshot := v_result
      );
    end if;

    return v_result;
  end if;

  update public.salon_appointments
  set status = p_to_status,
      expires_at = case when p_to_status = 'pending' then expires_at else null end,
      updated_by = p_actor_id
  where id = v_before.id
  returning * into v_after;

  insert into public.salon_appointment_status_history (
    appointment_id,
    studio_id,
    from_status,
    to_status,
    actor,
    actor_id,
    actor_role,
    reason
  )
  values (
    v_before.id,
    p_studio_id,
    v_before.status,
    p_to_status,
    'user',
    p_actor_id,
    p_actor_role,
    v_reason
  );

  if p_to_status in ('completed', 'no_show') then
    update public.salon_appointment_resources
    set is_active = false,
        released_at = now()
    where appointment_id = v_before.id
      and is_active;

    get diagnostics v_released_count = row_count;
  end if;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_status_transitioned',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_before.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_before.id,
    p_before_state := to_jsonb(v_before),
    p_after_state := jsonb_build_object(
      'appointment', to_jsonb(v_after),
      'from_status', v_before.status,
      'to_status', p_to_status,
      'reason', v_reason,
      'released_resources', v_released_count
    ),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_after.id,
    'from_status', v_before.status,
    'to_status', p_to_status,
    'status', v_after.status,
    'already_in_target', false,
    'released_resources', v_released_count
  );

  if v_idempotency_enabled then
    perform public.complete_business_idempotency_key_for_appointment(
      p_id := p_idempotency_key_id,
      p_claim_token := p_idempotency_claim_token,
      p_result_snapshot := v_result
    );
  end if;

  return v_result;
end;
$$;


-- ── grants ────────────────────────────────────────────────────────────────
revoke all on function public.assert_salon_appointment_transition_actor_role(text)
  from public, anon, authenticated;
revoke all on function public.assert_salon_appointment_status_transition(text, text)
  from public, anon, authenticated;
revoke all on function public.list_salon_appointments_for_calendar(text, uuid, uuid, timestamptz, timestamptz, uuid, uuid, uuid, text[])
  from public, anon, authenticated;
revoke all on function public.transition_salon_appointment_status(uuid, text, uuid, uuid, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.assert_salon_appointment_transition_actor_role(text)
  to service_role;
grant execute on function public.assert_salon_appointment_status_transition(text, text)
  to service_role;
grant execute on function public.list_salon_appointments_for_calendar(text, uuid, uuid, timestamptz, timestamptz, uuid, uuid, uuid, text[])
  to service_role;
grant execute on function public.transition_salon_appointment_status(uuid, text, uuid, uuid, uuid, text, text, uuid, uuid)
  to service_role;
