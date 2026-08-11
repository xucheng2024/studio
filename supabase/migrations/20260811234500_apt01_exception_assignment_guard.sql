-- APT-01 hardening follow-up:
-- employee_availability_exceptions must reference an employee who is actively
-- assigned to the same location when location_id is specified.

create or replace function public.employee_availability_exceptions_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee_studio uuid;
  v_location_studio uuid;
  v_has_active_assignment boolean;
begin
  select studio_id into v_employee_studio from public.employees where id = new.employee_id;

  if v_employee_studio is null then
    raise exception 'employee_availability_exceptions references a missing employee'
      using errcode = '23503';
  end if;
  if v_employee_studio <> new.studio_id then
    raise exception 'employee_availability_exceptions.studio_id must match employee studio_id'
      using errcode = '23514';
  end if;

  if new.location_id is not null then
    select studio_id into v_location_studio from public.locations where id = new.location_id;
    if v_location_studio is null then
      raise exception 'employee_availability_exceptions references a missing location'
        using errcode = '23503';
    end if;
    if v_location_studio <> new.studio_id then
      raise exception 'employee_availability_exceptions.studio_id must match location studio_id'
        using errcode = '23514';
    end if;

    select exists(
      select 1
      from public.employee_locations el
      where el.studio_id = new.studio_id
        and el.employee_id = new.employee_id
        and el.location_id = new.location_id
        and el.is_active = true
    ) into v_has_active_assignment;

    if not v_has_active_assignment then
      raise exception 'employee must have an active employee_locations assignment for exception location'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.employee_availability_exceptions_validate_studio() from public, anon, authenticated;
grant all on function public.employee_availability_exceptions_validate_studio() to service_role;
