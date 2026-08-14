-- APT-04 UAT alignment: the production studio_services contract uses `title`.
-- Keep the timing helper tolerant of the legacy minimal verification fixture,
-- which historically exposed the same display value as `name`.

create or replace function public.get_effective_service_timing_for_appointment(
  p_studio_id uuid,
  p_service_id uuid,
  p_location_id uuid
)
returns table (
  service_title text,
  service_price numeric,
  service_currency text,
  duration_minutes integer,
  prep_minutes integer,
  buffer_minutes integer,
  location_name text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service record;
  v_location record;
  v_service_location record;
  v_service_title text;
begin
  select *
  into v_service
  from public.studio_services
  where id = p_service_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'service % not found in studio %', p_service_id, p_studio_id using errcode = 'P0002';
  end if;

  v_service_title := coalesce(
    nullif(to_jsonb(v_service) ->> 'title', ''),
    nullif(to_jsonb(v_service) ->> 'name', '')
  );
  if v_service_title is null then
    raise exception 'service % has no display title', p_service_id using errcode = '23514';
  end if;

  select id, studio_id, name, is_active
  into v_location
  from public.locations
  where id = p_location_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'location % not found in studio %', p_location_id, p_studio_id using errcode = 'P0002';
  end if;

  if not v_service.is_active then
    raise exception 'service % is inactive', p_service_id using errcode = '23514';
  end if;

  if not v_location.is_active then
    raise exception 'location % is inactive', p_location_id using errcode = '23514';
  end if;

  select id, is_enabled, duration_override_minutes, buffer_override_minutes
  into v_service_location
  from public.service_locations
  where studio_id = p_studio_id
    and service_id = p_service_id
    and location_id = p_location_id
  for update;

  if not found then
    raise exception 'service % is not configured for location %', p_service_id, p_location_id using errcode = '23514';
  end if;

  if not v_service_location.is_enabled then
    raise exception 'service % is disabled at location %', p_service_id, p_location_id using errcode = '23514';
  end if;

  return query
  select
    v_service_title,
    v_service.price::numeric,
    v_service.currency::text,
    coalesce(v_service_location.duration_override_minutes, v_service.default_duration_minutes)::integer,
    v_service.default_prep_minutes::integer,
    coalesce(v_service_location.buffer_override_minutes, v_service.default_buffer_minutes)::integer,
    v_location.name::text;
end;
$$;

revoke all on function public.get_effective_service_timing_for_appointment(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_effective_service_timing_for_appointment(uuid, uuid, uuid)
  to service_role;

-- FND-01 models employee activity with employment_status; it does not expose
-- the duplicate employees.is_active column used by the early APT-02 fixture.
-- Read the complete row so this helper works against both the production
-- contract and that legacy isolated fixture.
create or replace function public.assert_employee_available_for_appointment(
  p_studio_id uuid,
  p_location_id uuid,
  p_service_id uuid,
  p_employee_id uuid,
  p_occupied_from timestamptz,
  p_occupied_until timestamptz
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee record;
  v_employee_json jsonb;
  v_has_assignment boolean;
  v_has_eligibility boolean;
  v_local_from timestamp;
  v_local_until timestamp;
  v_local_date date;
  v_weekday smallint;
  v_start_second integer;
  v_end_second integer;
  v_location_closed boolean;
  v_location_ranges int4multirange;
  v_working_ranges int4multirange;
  v_within_location_hours boolean;
  v_within_working_hours boolean;
  v_has_unavailable_exception boolean;
  v_available_ranges tstzmultirange;
  v_available_covers boolean;
begin
  if p_occupied_until <= p_occupied_from then
    raise exception 'invalid occupied interval: occupied_until must be after occupied_from' using errcode = '23514';
  end if;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'employee % not found in studio %', p_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  v_employee_json := to_jsonb(v_employee);
  if coalesce(lower(v_employee_json ->> 'employment_status'), 'active') not in ('active', 'probation')
    or coalesce((v_employee_json ->> 'is_active')::boolean, true) is distinct from true then
    raise exception 'employee % is not in a bookable employment status', p_employee_id using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.employee_locations el
    where el.studio_id = p_studio_id
      and el.employee_id = p_employee_id
      and el.location_id = p_location_id
      and el.is_active
  ) into v_has_assignment;

  if not v_has_assignment then
    raise exception 'employee % has no active assignment at location %', p_employee_id, p_location_id using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.service_employees se
    where se.studio_id = p_studio_id
      and se.service_id = p_service_id
      and se.employee_id = p_employee_id
      and se.is_active
  ) into v_has_eligibility;

  if not v_has_eligibility then
    raise exception 'employee % is not actively eligible for service %', p_employee_id, p_service_id using errcode = '23514';
  end if;

  v_local_from := p_occupied_from at time zone 'Asia/Singapore';
  v_local_until := p_occupied_until at time zone 'Asia/Singapore';

  if v_local_until::date <> v_local_from::date then
    raise exception 'occupied interval must remain within one Asia/Singapore business date' using errcode = '23514';
  end if;

  v_local_date := v_local_from::date;
  v_weekday := extract(dow from v_local_from)::smallint;
  v_start_second := extract(epoch from v_local_from::time)::integer;
  v_end_second := extract(epoch from v_local_until::time)::integer;

  select exists (
    select 1
    from public.location_operating_hours loh
    where loh.studio_id = p_studio_id
      and loh.location_id = p_location_id
      and loh.weekday = v_weekday
      and loh.is_closed
  ) into v_location_closed;

  if v_location_closed then
    raise exception 'location % is marked closed for weekday %', p_location_id, v_weekday using errcode = '23514';
  end if;

  select range_agg(int4range(extract(epoch from loh.opens_at)::integer, extract(epoch from loh.closes_at)::integer, '[)'))
  into v_location_ranges
  from public.location_operating_hours loh
  where loh.studio_id = p_studio_id
    and loh.location_id = p_location_id
    and loh.weekday = v_weekday
    and loh.is_closed = false;

  v_within_location_hours := coalesce(
    int4range(v_start_second, v_end_second, '[)') <@ v_location_ranges,
    false
  );

  if not v_within_location_hours then
    raise exception 'appointment is outside location operating hours' using errcode = '23514';
  end if;

  select range_agg(int4range(extract(epoch from ewh.starts_at)::integer, extract(epoch from ewh.ends_at)::integer, '[)'))
  into v_working_ranges
  from public.employee_working_hours ewh
  where ewh.studio_id = p_studio_id
    and ewh.employee_id = p_employee_id
    and ewh.location_id = p_location_id
    and ewh.weekday = v_weekday
    and ewh.is_active
    and (ewh.effective_from is null or ewh.effective_from <= v_local_date)
    and (ewh.effective_until is null or ewh.effective_until >= v_local_date);

  v_within_working_hours := coalesce(
    int4range(v_start_second, v_end_second, '[)') <@ v_working_ranges,
    false
  );

  select exists (
    select 1
    from public.employee_availability_exceptions ex
    where ex.studio_id = p_studio_id
      and ex.employee_id = p_employee_id
      and ex.exception_type = 'unavailable'
      and (ex.location_id is null or ex.location_id = p_location_id)
      and tstzrange(ex.starts_at, ex.ends_at, '[)') && tstzrange(p_occupied_from, p_occupied_until, '[)')
  ) into v_has_unavailable_exception;

  select range_agg(tstzrange(ex.starts_at, ex.ends_at, '[)'))
  into v_available_ranges
  from public.employee_availability_exceptions ex
  where ex.studio_id = p_studio_id
    and ex.employee_id = p_employee_id
    and ex.exception_type = 'available'
    and (ex.location_id is null or ex.location_id = p_location_id)
    and tstzrange(ex.starts_at, ex.ends_at, '[)') && tstzrange(p_occupied_from, p_occupied_until, '[)');

  v_available_covers := coalesce(
    tstzrange(p_occupied_from, p_occupied_until, '[)') <@ v_available_ranges,
    false
  );

  if v_has_unavailable_exception then
    raise exception 'employee % has unavailable exception overlap in target interval', p_employee_id using errcode = '23514';
  end if;

  if not v_within_working_hours and not v_available_covers then
    raise exception 'employee % is outside working hours and not covered by available exception', p_employee_id using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.assert_employee_available_for_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.assert_employee_available_for_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  to service_role;
