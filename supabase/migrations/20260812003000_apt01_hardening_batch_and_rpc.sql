-- APT-01 hardening follow-up:
-- 1) Atomic batch update for service eligible employees
-- 2) DB-side active employee_locations guard in create_employee_availability_exception RPC
-- 3) Resource upsert RPC variant with expected-current-location guard


-- ── RPC: set_service_employee_eligibilities (atomic batch) ─────────────
create or replace function public.set_service_employee_eligibilities(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_service_id uuid,
  p_employee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_employee_id uuid;
  v_current_ids uuid[];
  v_all_ids uuid[];
  v_rows_touched integer := 0;
begin
  select studio_id into v_service_studio from public.studio_services where id = p_service_id;
  if v_service_studio is null then
    raise exception 'service % not found', p_service_id using errcode = 'P0002';
  end if;
  if v_service_studio <> p_studio_id then
    raise exception 'service must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  -- Validate every target employee belongs to this studio before mutating.
  if p_employee_ids is not null then
    foreach v_employee_id in array p_employee_ids loop
      if not exists (
        select 1 from public.employees e where e.id = v_employee_id and e.studio_id = p_studio_id
      ) then
        raise exception 'employee % must belong to studio %', v_employee_id, p_studio_id using errcode = '23514';
      end if;
    end loop;
  end if;

  select coalesce(array_agg(se.employee_id), '{}')
    into v_current_ids
  from public.service_employees se
  where se.studio_id = p_studio_id and se.service_id = p_service_id and se.is_active = true;

  select array(
    select distinct x
    from unnest(coalesce(v_current_ids, '{}') || coalesce(p_employee_ids, '{}')) as x
  ) into v_all_ids;

  foreach v_employee_id in array coalesce(v_all_ids, '{}') loop
    perform public.set_service_employee_eligibility(
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_studio_id := p_studio_id,
      p_service_id := p_service_id,
      p_employee_id := v_employee_id,
      p_is_active := coalesce(v_employee_id = any (p_employee_ids), false)
    );
    v_rows_touched := v_rows_touched + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'service_id', p_service_id,
    'selected_employee_count', coalesce(array_length(p_employee_ids, 1), 0),
    'rows_touched', v_rows_touched
  );
end;
$$;


-- ── RPC hardening: create_employee_availability_exception ───────────────
create or replace function public.create_employee_availability_exception(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_employee_id uuid,
  p_exception_type text,
  p_reason_category text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee_studio uuid;
  v_location_studio uuid;
  v_after_row public.employee_availability_exceptions%rowtype;
begin
  if p_exception_type not in ('unavailable', 'available') then
    raise exception 'invalid exception type %', p_exception_type using errcode = '22023';
  end if;
  if p_reason_category not in ('break', 'leave', 'training', 'meeting', 'overtime', 'other') then
    raise exception 'invalid reason category %', p_reason_category using errcode = '22023';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'ends_at must be after starts_at' using errcode = '23514';
  end if;

  select studio_id into v_employee_studio from public.employees where id = p_employee_id;
  if v_employee_studio is null then
    raise exception 'employee % not found', p_employee_id using errcode = 'P0002';
  end if;
  if v_employee_studio <> p_studio_id then
    raise exception 'employee must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  if p_location_id is not null then
    select studio_id into v_location_studio from public.locations where id = p_location_id;
    if v_location_studio is null then
      raise exception 'location % not found', p_location_id using errcode = 'P0002';
    end if;
    if v_location_studio <> p_studio_id then
      raise exception 'location must belong to studio %', p_studio_id using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.employee_locations el
      where el.studio_id = p_studio_id
        and el.employee_id = p_employee_id
        and el.location_id = p_location_id
        and el.is_active = true
    ) then
      raise exception 'employee % has no active employee_locations assignment for location %', p_employee_id, p_location_id
        using errcode = '23514';
    end if;
  end if;

  insert into public.employee_availability_exceptions
    (studio_id, employee_id, location_id, exception_type, reason_category, starts_at, ends_at, reason)
  values
    (p_studio_id, p_employee_id, p_location_id, p_exception_type, p_reason_category, p_starts_at, p_ends_at, p_reason)
  returning * into v_after_row;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'employee_availability_exception_created',
    p_target_type := 'employee_availability_exception',
    p_actor_type := 'user',
    p_location_id := p_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_after_row.id,
    p_before_state := null,
    p_after_state := to_jsonb(v_after_row)
  );

  return jsonb_build_object('ok', true, 'exception_id', v_after_row.id);
end;
$$;


-- ── RPC: upsert_salon_resource_strict ───────────────────────────────────
-- Adds expected_current_location_id to protect against stale read / move
-- race when caller intends to update an existing row.
create or replace function public.upsert_salon_resource_strict(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_name text,
  p_resource_type text,
  p_capacity integer default 1,
  p_resource_id uuid default null,
  p_expected_current_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_before_row public.salon_resources%rowtype;
  v_after_row public.salon_resources%rowtype;
begin
  if p_resource_type not in ('room', 'bed', 'equipment', 'other') then
    raise exception 'invalid resource type %', p_resource_type using errcode = '22023';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'resource name is required' using errcode = '23514';
  end if;
  if p_capacity is null or p_capacity <= 0 then
    raise exception 'capacity must be positive' using errcode = '23514';
  end if;

  select studio_id into v_location_studio from public.locations where id = p_location_id;
  if v_location_studio is null then
    raise exception 'location % not found', p_location_id using errcode = 'P0002';
  end if;
  if v_location_studio <> p_studio_id then
    raise exception 'location must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  if p_resource_id is null then
    insert into public.salon_resources (studio_id, location_id, name, resource_type, capacity)
    values (p_studio_id, p_location_id, btrim(p_name), p_resource_type, p_capacity)
    returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'salon_resource_created',
      p_target_type := 'salon_resource',
      p_actor_type := 'user',
      p_location_id := p_location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := null,
      p_after_state := to_jsonb(v_after_row)
    );
  else
    select * into v_before_row from public.salon_resources
      where id = p_resource_id and studio_id = p_studio_id
      for update;
    if not found then
      raise exception 'resource % not found in studio %', p_resource_id, p_studio_id using errcode = 'P0002';
    end if;

    if p_expected_current_location_id is not null
      and v_before_row.location_id <> p_expected_current_location_id then
      raise exception 'resource % location changed from expected % to %',
        p_resource_id, p_expected_current_location_id, v_before_row.location_id
        using errcode = '23514';
    end if;

    update public.salon_resources
    set location_id = p_location_id, name = btrim(p_name), resource_type = p_resource_type, capacity = p_capacity
    where id = p_resource_id
    returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'salon_resource_updated',
      p_target_type := 'salon_resource',
      p_actor_type := 'user',
      p_location_id := p_location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := to_jsonb(v_before_row),
      p_after_state := to_jsonb(v_after_row)
    );
  end if;

  return jsonb_build_object('ok', true, 'resource_id', v_after_row.id);
end;
$$;


-- ── Grants ──────────────────────────────────────────────────────────────
revoke all on function public.set_service_employee_eligibilities(uuid, text, uuid, uuid, uuid[])
from public, anon, authenticated;
grant all on function public.set_service_employee_eligibilities(uuid, text, uuid, uuid, uuid[])
to service_role;

revoke all on function public.upsert_salon_resource_strict(uuid, text, uuid, uuid, text, text, integer, uuid, uuid)
from public, anon, authenticated;
grant all on function public.upsert_salon_resource_strict(uuid, text, uuid, uuid, text, text, integer, uuid, uuid)
to service_role;

revoke all on function public.create_employee_availability_exception(uuid, text, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text)
from public, anon, authenticated;
grant all on function public.create_employee_availability_exception(uuid, text, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text)
to service_role;
