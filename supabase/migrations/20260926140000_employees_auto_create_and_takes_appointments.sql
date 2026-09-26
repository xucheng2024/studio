-- Employees were only created once, by the 124_employee_foundation backfill.
-- Staff who accepted an invite later, and owners of studios created later, had
-- no employee row, so they could not be scheduled, assigned to services or
-- booked. This adds an idempotent sync (no trigger, so fixtures that seed
-- employees explicitly keep working) and a switch for whether a person takes
-- appointments at all.

alter table public.employees
  add column if not exists takes_appointments boolean not null default true;

-- Returns the studio employee for a login, creating it when missing. An
-- account-less employee with the same email (e.g. from an instructor record)
-- is linked instead of duplicated.
create or replace function public.ensure_studio_employee(
  p_studio_id uuid,
  p_user_id uuid,
  p_takes_appointments boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_email text;
  v_name text;
begin
  if p_studio_id is null or p_user_id is null then
    return null;
  end if;

  select id into v_id
  from public.employees
  where studio_id = p_studio_id and user_id = p_user_id;
  if found then
    return v_id;
  end if;

  select u.email, coalesce(nullif(btrim(up.full_name), ''), nullif(btrim(u.email), ''), 'Unnamed staff')
  into v_email, v_name
  from public.user_profiles up
  left join public.users u on u.id = up.id
  where up.id = p_user_id;
  if not found then
    -- employees.user_id references user_profiles; nothing to link yet.
    return null;
  end if;

  if v_email is not null then
    update public.employees
    set user_id = p_user_id
    where id = (
      select e.id
      from public.employees e
      where e.studio_id = p_studio_id
        and e.user_id is null
        and lower(e.email) = lower(v_email)
      order by e.created_at
      limit 1
    )
    returning id into v_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  insert into public.employees (studio_id, user_id, display_name, email, employment_status, takes_appointments)
  values (p_studio_id, p_user_id, v_name, v_email, 'active', p_takes_appointments)
  on conflict (studio_id, user_id) where user_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.employees where studio_id = p_studio_id and user_id = p_user_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.ensure_studio_employee(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.ensure_studio_employee(uuid, uuid, boolean) to service_role;

-- Create missing employees for everyone with studio access. Service staff take
-- appointments by default; owners, managers and front desk opt in. Called by
-- the app after an invite is accepted, after a studio is created, and when the
-- booking settings page loads. Idempotent.
create or replace function public.sync_studio_employees(p_studio_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row record;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before from public.employees where studio_id = p_studio_id;

  for v_row in
    select sm.user_id, bool_or(sm.role = 'instructor') as is_instructor
    from public.staff_memberships sm
    where sm.studio_id = p_studio_id and sm.is_active
    group by sm.user_id
  loop
    perform public.ensure_studio_employee(p_studio_id, v_row.user_id, v_row.is_instructor);
  end loop;

  perform public.ensure_studio_employee(s.id, s.owner_id, false)
  from public.studios s
  where s.id = p_studio_id and s.owner_id is not null;

  select count(*) into v_after from public.employees where studio_id = p_studio_id;
  return v_after - v_before;
end;
$$;

revoke all on function public.sync_studio_employees(uuid) from public, anon, authenticated;
grant execute on function public.sync_studio_employees(uuid) to service_role;

-- One-off fill for people who already have access. Existing employees keep
-- takes_appointments = true so current bookings are unaffected.
do $$
declare
  v_studio record;
begin
  for v_studio in select id from public.studios loop
    perform public.sync_studio_employees(v_studio.id);
  end loop;
end;
$$;
