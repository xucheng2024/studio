-- 1-to-1 appointments must not overlap a scheduled class taught by the same
-- employee (classes.instructor_id <-> employees.instructor_id). The function
-- body is copied unchanged from 20260814203000_apt04_align_studio_service_title
-- with one extra check at the end. create/reschedule RPCs already call it.

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

  -- A 1-to-1 appointment cannot overlap a scheduled class the employee teaches,
  -- at any location of this studio.
  if exists (
    select 1
    from public.employees e
    join public.classes c on c.instructor_id = e.instructor_id and c.studio_id = p_studio_id
    join public.class_sessions cs on cs.class_id = c.id
    where e.id = p_employee_id
      and e.instructor_id is not null
      and cs.status = 'scheduled'
      and tstzrange(cs.start_time, cs.end_time, '[)') && tstzrange(p_occupied_from, p_occupied_until, '[)')
  ) then
    raise exception 'employee % is teaching a class in the target interval', p_employee_id using errcode = '23P01';
  end if;
end;
$$;

revoke all on function public.assert_employee_available_for_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.assert_employee_available_for_appointment(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
  to service_role;
