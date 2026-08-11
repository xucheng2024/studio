-- FND-01: unified Employee foundation.
-- Adds employees + employee_locations as the studio-scoped employment identity,
-- separate from staff_memberships (login/access) and instructors (service-provider
-- catalog). Backfills from existing instructors/staff_memberships without guessing
-- ambiguous matches; anything unsafe to auto-link is recorded in
-- employee_migration_conflicts for manual review.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  instructor_id uuid references public.instructors(id) on delete set null,
  employee_number text,
  display_name text not null,
  email text,
  phone text,
  employment_status text not null default 'active'
    check (employment_status = any (array['active'::text, 'inactive'::text, 'terminated'::text])),
  hired_at date,
  terminated_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employees_studio_user_unique
  on public.employees (studio_id, user_id)
  where user_id is not null;

create unique index if not exists employees_instructor_unique
  on public.employees (instructor_id)
  where instructor_id is not null;

create unique index if not exists employees_studio_employee_number_unique
  on public.employees (studio_id, employee_number)
  where employee_number is not null;

create index if not exists idx_employees_studio_status
  on public.employees (studio_id, employment_status);

create or replace function public.employees_validate_instructor_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.instructor_id is not null then
    if not exists (
      select 1 from public.instructors i
      where i.id = new.instructor_id and i.studio_id = new.studio_id
    ) then
      raise exception 'employees.instructor_id must belong to the same studio_id'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_validate_instructor_studio_trg on public.employees;
create trigger employees_validate_instructor_studio_trg
  before insert or update of instructor_id, studio_id on public.employees
  for each row execute function public.employees_validate_instructor_studio();

drop trigger if exists set_employees_updated_at on public.employees;
create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at_timestamp();


create table if not exists public.employee_locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_locations_primary_requires_active check (not is_primary or is_active)
);

create unique index if not exists employee_locations_employee_location_unique
  on public.employee_locations (employee_id, location_id);

create unique index if not exists employee_locations_one_primary_per_employee
  on public.employee_locations (employee_id)
  where is_primary and is_active;

create index if not exists idx_employee_locations_studio
  on public.employee_locations (studio_id);

create index if not exists idx_employee_locations_location
  on public.employee_locations (location_id);

create or replace function public.employee_locations_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee_studio uuid;
  v_location_studio uuid;
begin
  select studio_id into v_employee_studio from public.employees where id = new.employee_id;
  select studio_id into v_location_studio from public.locations where id = new.location_id;

  if v_employee_studio is null or v_location_studio is null then
    raise exception 'employee_locations references a missing employee or location'
      using errcode = '23503';
  end if;

  if v_employee_studio <> new.studio_id or v_location_studio <> new.studio_id then
    raise exception 'employee_locations.studio_id must match both employee and location studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_locations_validate_studio_trg on public.employee_locations;
create trigger employee_locations_validate_studio_trg
  before insert or update of employee_id, location_id, studio_id on public.employee_locations
  for each row execute function public.employee_locations_validate_studio();

drop trigger if exists set_employee_locations_updated_at on public.employee_locations;
create trigger set_employee_locations_updated_at
  before update on public.employee_locations
  for each row execute function public.set_updated_at_timestamp();


create table if not exists public.employee_migration_conflicts (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  source_type text not null
    check (source_type = any (array['instructor'::text, 'staff_membership'::text])),
  source_id uuid not null,
  conflict_code text not null
    check (conflict_code = any (array[
      'ambiguous_user_match'::text,
      'duplicate_instructor_identity'::text,
      'missing_working_location'::text
    ])),
  details jsonb,
  status text not null default 'open'
    check (status = any (array['open'::text, 'resolved'::text, 'ignored'::text])),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists employee_migration_conflicts_open_unique
  on public.employee_migration_conflicts (studio_id, source_type, source_id, conflict_code)
  where status = 'open';

create index if not exists idx_employee_migration_conflicts_studio_status
  on public.employee_migration_conflicts (studio_id, status);


-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.employees enable row level security;
alter table public.employee_locations enable row level security;
alter table public.employee_migration_conflicts enable row level security;

revoke all on table public.employees from public;
revoke all on table public.employees from anon;
revoke all on table public.employees from authenticated;
grant all on table public.employees to service_role;

revoke all on table public.employee_locations from public;
revoke all on table public.employee_locations from anon;
revoke all on table public.employee_locations from authenticated;
grant all on table public.employee_locations to service_role;

revoke all on table public.employee_migration_conflicts from public;
revoke all on table public.employee_migration_conflicts from anon;
revoke all on table public.employee_migration_conflicts from authenticated;
grant all on table public.employee_migration_conflicts to service_role;

drop policy if exists employees_self_read on public.employees;
create policy employees_self_read
on public.employees
for select
using (auth.uid() = user_id);

-- `revoke all` above also strips the table-level SELECT privilege that RLS
-- filtering depends on; without this grant the self-read policy above is
-- silently unreachable (see 116_fix_self_read_grants_and_harden_public_content_tables.sql
-- for the same mistake made and fixed elsewhere in this repo).
grant select on table public.employees to authenticated;

drop policy if exists employee_locations_self_read on public.employee_locations;
create policy employee_locations_self_read
on public.employee_locations
for select
using (
  exists (
    select 1 from public.employees e
    where e.id = employee_locations.employee_id and e.user_id = auth.uid()
  )
);

grant select on table public.employee_locations to authenticated;

-- employee_migration_conflicts intentionally has no client-facing policy:
-- it can hold diagnostic emails/ids for ambiguous-match review (service_role only,
-- same posture as guest_merge_audits / operation_audits).


-- ── Backfill (idempotent, safe to retry; never mutates instructors/staff_memberships) ──
create or replace function public.backfill_employees_from_instructors_and_staff()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_studio record;
  v_instructor record;
  v_matches uuid[];
  v_claimed_by_instructor jsonb; -- user_id(text) -> array of instructor ids claiming it
  v_claim_key text;
  v_claim_ids jsonb;
  v_employee_id uuid;
  v_created_employees integer := 0;
  v_created_locations integer := 0;
  v_created_conflicts integer := 0;
  v_rows integer;
  v_sm record;
begin
  for v_studio in select id from public.studios loop

    v_claimed_by_instructor := '{}'::jsonb;

    -- Pass 1: figure out, per unmatched instructor, which single active staff user
    -- (by case-insensitive email, within this studio) it would resolve to. Track
    -- claims so we can detect two instructors resolving to the same user.
    for v_instructor in
      select i.* from public.instructors i
      where i.studio_id = v_studio.id
        and not exists (select 1 from public.employees e where e.instructor_id = i.id)
    loop
      v_matches := null;
      if v_instructor.email is not null and btrim(v_instructor.email) <> '' then
        select array_agg(distinct u.id) into v_matches
        from public.staff_memberships sm
        join public.users u on u.id = sm.user_id
        where sm.studio_id = v_studio.id
          and sm.is_active = true
          and lower(u.email) = lower(v_instructor.email);
      end if;

      if v_matches is not null and array_length(v_matches, 1) = 1 then
        v_claim_key := v_matches[1]::text;
        v_claim_ids := coalesce(v_claimed_by_instructor -> v_claim_key, '[]'::jsonb);
        v_claimed_by_instructor := jsonb_set(
          v_claimed_by_instructor,
          array[v_claim_key],
          v_claim_ids || to_jsonb(v_instructor.id::text)
        );
      end if;
    end loop;

    -- Pass 2: create employees from instructors, honouring the claim map.
    for v_instructor in
      select i.* from public.instructors i
      where i.studio_id = v_studio.id
        and not exists (select 1 from public.employees e where e.instructor_id = i.id)
    loop
      v_matches := null;
      if v_instructor.email is not null and btrim(v_instructor.email) <> '' then
        select array_agg(distinct u.id) into v_matches
        from public.staff_memberships sm
        join public.users u on u.id = sm.user_id
        where sm.studio_id = v_studio.id
          and sm.is_active = true
          and lower(u.email) = lower(v_instructor.email);
      end if;

      v_employee_id := null;

      if v_matches is null or array_length(v_matches, 1) = 0 then
        -- no login match: not a conflict, just an instructor without an account.
        insert into public.employees
          (studio_id, user_id, instructor_id, display_name, email, phone, employment_status)
        values
          (v_studio.id, null, v_instructor.id, v_instructor.name, v_instructor.email,
           v_instructor.phone, case when v_instructor.is_active then 'active' else 'inactive' end)
        returning id into v_employee_id;
        v_created_employees := v_created_employees + 1;

      elsif array_length(v_matches, 1) > 1 then
        insert into public.employees
          (studio_id, user_id, instructor_id, display_name, email, phone, employment_status)
        values
          (v_studio.id, null, v_instructor.id, v_instructor.name, v_instructor.email,
           v_instructor.phone, case when v_instructor.is_active then 'active' else 'inactive' end)
        returning id into v_employee_id;
        v_created_employees := v_created_employees + 1;

        insert into public.employee_migration_conflicts
          (studio_id, source_type, source_id, conflict_code, details)
        values
          (v_studio.id, 'instructor', v_instructor.id, 'ambiguous_user_match',
           jsonb_build_object('email', v_instructor.email, 'match_count', array_length(v_matches, 1)))
        on conflict do nothing;
        get diagnostics v_rows = row_count;
        v_created_conflicts := v_created_conflicts + v_rows;

      else
        v_claim_key := v_matches[1]::text;
        v_claim_ids := coalesce(v_claimed_by_instructor -> v_claim_key, '[]'::jsonb);

        if jsonb_array_length(v_claim_ids) > 1 then
          -- two or more instructors in this studio share this email: link none of them.
          insert into public.employees
            (studio_id, user_id, instructor_id, display_name, email, phone, employment_status)
          values
            (v_studio.id, null, v_instructor.id, v_instructor.name, v_instructor.email,
             v_instructor.phone, case when v_instructor.is_active then 'active' else 'inactive' end)
          returning id into v_employee_id;
          v_created_employees := v_created_employees + 1;

          insert into public.employee_migration_conflicts
            (studio_id, source_type, source_id, conflict_code, details)
          values
            (v_studio.id, 'instructor', v_instructor.id, 'duplicate_instructor_identity',
             jsonb_build_object('email', v_instructor.email, 'claiming_instructor_ids', v_claim_ids))
          on conflict do nothing;
          get diagnostics v_rows = row_count;
          v_created_conflicts := v_created_conflicts + v_rows;
        else
          insert into public.employees
            (studio_id, user_id, instructor_id, display_name, email, phone, employment_status)
          values
            (v_studio.id, v_matches[1], v_instructor.id, v_instructor.name, v_instructor.email,
             v_instructor.phone, case when v_instructor.is_active then 'active' else 'inactive' end)
          returning id into v_employee_id;
          v_created_employees := v_created_employees + 1;
        end if;
      end if;

      if v_instructor.location_id is not null then
        -- is_primary must match is_active: employee_locations_primary_requires_active
        -- forbids a primary row that isn't active, so an inactive instructor's
        -- location is preserved as an inactive, non-primary assignment rather
        -- than failing the whole backfill.
        insert into public.employee_locations
          (employee_id, location_id, studio_id, is_primary, is_active)
        values
          (v_employee_id, v_instructor.location_id, v_studio.id, v_instructor.is_active, v_instructor.is_active)
        on conflict (employee_id, location_id) do nothing;
        get diagnostics v_rows = row_count;
        v_created_locations := v_created_locations + v_rows;
      end if;
    end loop;

    -- Pass 3: create employees for backoffice staff logins not already linked
    -- via an instructor match above. Never copy staff_memberships.location_id
    -- into employee_locations — access scope is not proof of work location.
    for v_sm in
      select distinct sm.user_id, u.email, up.full_name
      from public.staff_memberships sm
      join public.users u on u.id = sm.user_id
      left join public.user_profiles up on up.id = sm.user_id
      where sm.studio_id = v_studio.id
        and sm.is_active = true
        and not exists (
          select 1 from public.employees e
          where e.studio_id = v_studio.id and e.user_id = sm.user_id
        )
    loop
      insert into public.employees
        (studio_id, user_id, instructor_id, display_name, email, employment_status)
      values
        (v_studio.id, v_sm.user_id, null, coalesce(v_sm.full_name, v_sm.email, 'Unnamed staff'),
         v_sm.email, 'active')
      on conflict (studio_id, user_id) where user_id is not null do nothing;
      get diagnostics v_rows = row_count;
      v_created_employees := v_created_employees + v_rows;
    end loop;

    -- Pass 4: flag any employee in this studio with no working location yet.
    insert into public.employee_migration_conflicts
      (studio_id, source_type, source_id, conflict_code, details)
    select
      v_studio.id,
      case when e.instructor_id is not null then 'instructor' else 'staff_membership' end,
      coalesce(e.instructor_id, e.id),
      'missing_working_location',
      jsonb_build_object('employee_id', e.id, 'display_name', e.display_name)
    from public.employees e
    where e.studio_id = v_studio.id
      and not exists (
        select 1 from public.employee_locations el where el.employee_id = e.id and el.is_active
    )
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    v_created_conflicts := v_created_conflicts + v_rows;

  end loop;

  return jsonb_build_object(
    'ok', true,
    'employees_created', v_created_employees,
    'employee_locations_created', v_created_locations,
    'conflicts_created', v_created_conflicts
  );
end;
$$;

select public.backfill_employees_from_instructors_and_staff();


-- ── Atomic working-location writer ─────────────────────────────────────
create or replace function public.set_employee_working_locations(
  p_employee_id uuid,
  p_studio_id uuid,
  p_location_ids uuid[],
  p_primary_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_bad_location_count integer;
begin
  if not exists (
    select 1 from public.employees where id = p_employee_id and studio_id = p_studio_id
  ) then
    raise exception 'employee % not found in studio %', p_employee_id, p_studio_id
      using errcode = 'P0002';
  end if;

  if p_location_ids is null or array_length(p_location_ids, 1) is null then
    raise exception 'p_location_ids must contain at least one location'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from unnest(p_location_ids) as loc_id
    group by loc_id
    having count(*) > 1
  ) then
    raise exception 'p_location_ids must not contain duplicate locations'
      using errcode = '23514';
  end if;

  select count(*) into v_bad_location_count
  from unnest(p_location_ids) as loc_id
  where not exists (
    select 1 from public.locations l where l.id = loc_id and l.studio_id = p_studio_id
  );
  if v_bad_location_count > 0 then
    raise exception 'one or more locations do not belong to studio %', p_studio_id
      using errcode = '23514';
  end if;

  if p_primary_location_id is not null
     and not (p_primary_location_id = any (p_location_ids)) then
    raise exception 'primary_location_id must be included in location_ids'
      using errcode = '23514';
  end if;

  -- deactivate assignments no longer requested (preserve history, don't delete)
  update public.employee_locations
  set is_active = false, is_primary = false
  where employee_id = p_employee_id
    and studio_id = p_studio_id
    and not (location_id = any (p_location_ids));

  -- upsert requested assignments as active, primary flag set below
  insert into public.employee_locations (employee_id, location_id, studio_id, is_primary, is_active)
  select p_employee_id, loc_id, p_studio_id, false, true
  from unnest(p_location_ids) as loc_id
  on conflict (employee_id, location_id)
  do update set is_active = true;

  -- Two sequential statements, not one `is_primary = (location_id = ...)` update:
  -- a single multi-row UPDATE processes rows in an unspecified order, so the
  -- new primary could be written (and its uniqueness checked) before the old
  -- primary is cleared, tripping employee_locations_one_primary_per_employee.
  -- Clearing first, in its own fully-applied statement, removes that hazard.
  update public.employee_locations
  set is_primary = false
  where employee_id = p_employee_id
    and studio_id = p_studio_id
    and location_id = any (p_location_ids)
    and is_primary;

  if p_primary_location_id is not null then
    update public.employee_locations
    set is_primary = true
    where employee_id = p_employee_id
      and studio_id = p_studio_id
      and location_id = p_primary_location_id;
  end if;

  -- The assignment is now active, so the migration exception no longer needs
  -- manual review. The actor is a server-side service-role caller, hence no
  -- resolved_by user is recorded here.
  update public.employee_migration_conflicts
  set status = 'resolved', resolved_at = now()
  where studio_id = p_studio_id
    and conflict_code = 'missing_working_location'
    and status = 'open'
    and details ->> 'employee_id' = p_employee_id::text;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.backfill_employees_from_instructors_and_staff() from public;
revoke all on function public.backfill_employees_from_instructors_and_staff() from anon;
revoke all on function public.backfill_employees_from_instructors_and_staff() from authenticated;
grant all on function public.backfill_employees_from_instructors_and_staff() to service_role;

revoke all on function public.set_employee_working_locations(uuid, uuid, uuid[], uuid) from public;
revoke all on function public.set_employee_working_locations(uuid, uuid, uuid[], uuid) from anon;
revoke all on function public.set_employee_working_locations(uuid, uuid, uuid[], uuid) from authenticated;
grant all on function public.set_employee_working_locations(uuid, uuid, uuid[], uuid) to service_role;

revoke all on function public.employees_validate_instructor_studio() from public;
revoke all on function public.employees_validate_instructor_studio() from anon;
revoke all on function public.employees_validate_instructor_studio() from authenticated;
grant all on function public.employees_validate_instructor_studio() to service_role;

revoke all on function public.employee_locations_validate_studio() from public;
revoke all on function public.employee_locations_validate_studio() from anon;
revoke all on function public.employee_locations_validate_studio() from authenticated;
grant all on function public.employee_locations_validate_studio() to service_role;

revoke all on function public.set_updated_at_timestamp() from public;
revoke all on function public.set_updated_at_timestamp() from anon;
revoke all on function public.set_updated_at_timestamp() from authenticated;
grant all on function public.set_updated_at_timestamp() to service_role;
