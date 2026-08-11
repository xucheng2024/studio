-- APT-01: Service eligibility, staff availability, and salon resources.
-- Builds the configuration layer that Salon Appointment booking (APT-02) will
-- read from: which employees may provide which service, HQ default service
-- duration/prep/cleanup time (paired with FND-03's per-location overrides on
-- service_locations), location operating hours, employee recurring working
-- hours and one-off availability exceptions, and physical resources (rooms/
-- beds/equipment) with the resource types a service requires. Does NOT create
-- any Appointment record or booking-conflict transaction — that is APT-02.
--
-- Conventions followed (matching 124_employee_foundation.sql and
-- 20260811124428_fnd03_service_location_publish.sql):
--   * every new table has studio_id (+ location_id where location-scoped),
--     validated against related rows by a BEFORE INSERT/UPDATE trigger.
--   * RLS is enabled with no client-facing policy: all reads/writes go
--     through server-side lib functions using the admin client, with scope
--     checks in TypeScript (src/lib/scope.ts) before every mutation.
--   * All writes go through SECURITY DEFINER RPCs with a fixed search_path,
--     execute revoked from PUBLIC/anon/authenticated, granted only to
--     service_role.
--   * Every mutating RPC calls public.record_strong_audit(...) (FND-04,
--     20260811140130_fnd04_audit_idempotency_foundation.sql) inside its own
--     transaction, so the configuration change and its audit row commit or
--     roll back together.
--   * weekday is smallint 0-6 in the tables (RPC parameters accept plain
--     integer, since PostgreSQL does not implicitly cast integer literals to
--     smallint for function-overload resolution), 0 = Sunday .. 6 = Saturday
--     (JS Date.getDay() convention), used consistently by location_operating_hours and
--     employee_working_hours.


-- ── studio_services: HQ default duration / prep / cleanup-buffer ──────────
-- FND-03 only added a publish-scope column here; its task doc explicitly
-- deferred standard duration/buffer defaults to APT-01: "标准时长和缓冲属于
-- Salon Appointment Availability 契约，明确由 APT-01 增加并复用 FND-03 的门店
-- 覆盖结构". default_buffer_minutes has the same meaning as FND-03's
-- service_locations.buffer_override_minutes: POST-service cleanup/buffer
-- time, not pre-service prep (which has its own default_prep_minutes and,
-- per this task's brief, no per-location override).
--
-- Effective-value resolution (implemented as a pure function in
-- src/lib/service-availability.ts, not a SQL view, matching FND-03's own
-- style of storing overrides without a resolver):
--   effective_duration_minutes = COALESCE(service_locations.duration_override_minutes, studio_services.default_duration_minutes)
--   effective_buffer_minutes   = COALESCE(service_locations.buffer_override_minutes,   studio_services.default_buffer_minutes)
--   effective_prep_minutes     = studio_services.default_prep_minutes  (HQ-only, no override)
-- This is safe with or without uses_default_values because FND-03's existing
-- constraint service_locations_default_requires_null_overrides already
-- guarantees the override columns are NULL whenever uses_default_values is
-- true, so COALESCE always falls through to the HQ default in that case.
alter table public.studio_services
  add column if not exists default_duration_minutes integer not null default 60
    check (default_duration_minutes > 0),
  add column if not exists default_prep_minutes integer not null default 0
    check (default_prep_minutes >= 0),
  add column if not exists default_buffer_minutes integer not null default 0
    check (default_buffer_minutes >= 0);


-- ── locations: add updated_at (never added by the 051 baseline or FND-0x) ──
-- Needed so location_operating_hours' owning row and other location edits
-- can share the same set_updated_at_timestamp() trigger convention used by
-- every other table in this migration. Purely additive; does not touch any
-- other column or the locations RLS policies from 051_member_profile_notes.sql.
alter table public.locations
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_locations_updated_at on public.locations;
create trigger set_locations_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at_timestamp();


-- ── service_employees ──────────────────────────────────────────────────
-- Explicitly out of FND-03 scope ("service_employees：移到 APT-01"). No
-- location_id column: per-location eligibility is computed at read time as
-- the intersection of this table (active) ∩ employee_locations (active) ∩
-- service_locations (enabled) — see getEffectiveServiceAvailability /
-- listEligibleEmployeesForServiceAtLocation in src/lib/service-availability.ts.
create table if not exists public.service_employees (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  service_id uuid not null references public.studio_services(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_employees_service_employee_unique
  on public.service_employees (service_id, employee_id);

create index if not exists idx_service_employees_studio
  on public.service_employees (studio_id);

create index if not exists idx_service_employees_employee_active
  on public.service_employees (employee_id, is_active);

create or replace function public.service_employees_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_employee_studio uuid;
begin
  select studio_id into v_service_studio from public.studio_services where id = new.service_id;
  select studio_id into v_employee_studio from public.employees where id = new.employee_id;

  if v_service_studio is null or v_employee_studio is null then
    raise exception 'service_employees references a missing service or employee'
      using errcode = '23503';
  end if;

  if v_service_studio <> new.studio_id or v_employee_studio <> new.studio_id then
    raise exception 'service_employees.studio_id must match both service and employee studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists service_employees_validate_studio_trg on public.service_employees;
create trigger service_employees_validate_studio_trg
  before insert or update of service_id, employee_id, studio_id on public.service_employees
  for each row execute function public.service_employees_validate_studio();

drop trigger if exists set_service_employees_updated_at on public.service_employees;
create trigger set_service_employees_updated_at
  before update on public.service_employees
  for each row execute function public.set_updated_at_timestamp();


-- ── location_operating_hours ────────────────────────────────────────────
-- Appointment availability configuration (02-multi-location.md §2.9), not
-- staff Attendance/Roster. Multiple rows per weekday are allowed (split
-- hours, e.g. 09:00-12:00 and 13:00-18:00); a row with is_closed = true marks
-- an explicit closed day and is mutually exclusive with open-interval rows
-- for the same weekday (enforced by the partial unique index below and by
-- set_location_operating_hours_for_weekday, the only write path).
create table if not exists public.location_operating_hours (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_operating_hours_time_range check (
    (is_closed and opens_at is null and closes_at is null)
    or (not is_closed and opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);

create index if not exists idx_location_operating_hours_studio
  on public.location_operating_hours (studio_id);

create index if not exists idx_location_operating_hours_location_weekday
  on public.location_operating_hours (location_id, weekday);

create unique index if not exists location_operating_hours_one_closed_marker_per_day
  on public.location_operating_hours (location_id, weekday)
  where is_closed;

create or replace function public.location_operating_hours_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
begin
  select studio_id into v_location_studio from public.locations where id = new.location_id;

  if v_location_studio is null then
    raise exception 'location_operating_hours references a missing location'
      using errcode = '23503';
  end if;

  if v_location_studio <> new.studio_id then
    raise exception 'location_operating_hours.studio_id must match location studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists location_operating_hours_validate_studio_trg on public.location_operating_hours;
create trigger location_operating_hours_validate_studio_trg
  before insert or update of location_id, studio_id on public.location_operating_hours
  for each row execute function public.location_operating_hours_validate_studio();

drop trigger if exists set_location_operating_hours_updated_at on public.location_operating_hours;
create trigger set_location_operating_hours_updated_at
  before update on public.location_operating_hours
  for each row execute function public.set_updated_at_timestamp();


-- ── employee_working_hours ──────────────────────────────────────────────
-- Recurring bookable working hours. An employee can have different hours at
-- different locations (02-multi-location.md §2.5: "员工可在多家门店有不同工作
-- 时间"). The validate trigger below is the direct DB-level enforcement of
-- "an employee must have an active employee_locations assignment for the
-- location" — it is not just an app-layer check.
create table if not exists public.employee_working_hours (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_working_hours_time_range check (ends_at > starts_at),
  constraint employee_working_hours_effective_range check (
    effective_from is null or effective_until is null or effective_until >= effective_from
  )
);

create index if not exists idx_employee_working_hours_studio
  on public.employee_working_hours (studio_id);

create index if not exists idx_employee_working_hours_employee_weekday
  on public.employee_working_hours (employee_id, weekday);

create index if not exists idx_employee_working_hours_location
  on public.employee_working_hours (location_id);

create or replace function public.employee_working_hours_validate_studio()
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
  select studio_id into v_location_studio from public.locations where id = new.location_id;

  if v_employee_studio is null or v_location_studio is null then
    raise exception 'employee_working_hours references a missing employee or location'
      using errcode = '23503';
  end if;

  if v_employee_studio <> new.studio_id or v_location_studio <> new.studio_id then
    raise exception 'employee_working_hours.studio_id must match both employee and location studio_id'
      using errcode = '23514';
  end if;

  select exists (
    select 1 from public.employee_locations el
    where el.employee_id = new.employee_id
      and el.location_id = new.location_id
      and el.is_active
  ) into v_has_active_assignment;

  if not v_has_active_assignment then
    raise exception 'employee % has no active employee_locations assignment for location %', new.employee_id, new.location_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_working_hours_validate_studio_trg on public.employee_working_hours;
create trigger employee_working_hours_validate_studio_trg
  before insert or update of employee_id, location_id, studio_id on public.employee_working_hours
  for each row execute function public.employee_working_hours_validate_studio();

drop trigger if exists set_employee_working_hours_updated_at on public.employee_working_hours;
create trigger set_employee_working_hours_updated_at
  before update on public.employee_working_hours
  for each row execute function public.set_updated_at_timestamp();


-- ── employee_availability_exceptions ────────────────────────────────────
-- Temporary Appointment-availability changes only (blocked time, overtime,
-- break/training/meeting/other). This is booking-availability data, not a
-- Leave/Attendance/Roster record. location_id is optional (a studio-wide
-- leave block need not name one location); when present it is validated
-- against studio_id, same as every other location-scoped table here.
create table if not exists public.employee_availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  exception_type text not null
    check (exception_type = any (array['unavailable'::text, 'available'::text])),
  reason_category text not null
    check (reason_category = any (array[
      'break'::text, 'leave'::text, 'training'::text, 'meeting'::text, 'overtime'::text, 'other'::text
    ])),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_availability_exceptions_time_range check (ends_at > starts_at)
);

create index if not exists idx_employee_availability_exceptions_studio
  on public.employee_availability_exceptions (studio_id);

create index if not exists idx_employee_availability_exceptions_employee_range
  on public.employee_availability_exceptions (employee_id, starts_at, ends_at);

create or replace function public.employee_availability_exceptions_validate_studio()
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
  end if;

  return new;
end;
$$;

drop trigger if exists employee_availability_exceptions_validate_studio_trg on public.employee_availability_exceptions;
create trigger employee_availability_exceptions_validate_studio_trg
  before insert or update of employee_id, location_id, studio_id on public.employee_availability_exceptions
  for each row execute function public.employee_availability_exceptions_validate_studio();

drop trigger if exists set_employee_availability_exceptions_updated_at on public.employee_availability_exceptions;
create trigger set_employee_availability_exceptions_updated_at
  before update on public.employee_availability_exceptions
  for each row execute function public.set_updated_at_timestamp();


-- ── salon_resources ─────────────────────────────────────────────────────
-- One row per physical bed / key piece of equipment (01-appointment.md
-- §1.4 v1 recommendation), not a quantity pool — keeps allocation simple and
-- out of scope for this task (no occupancy/locking here, that is APT-02).
create table if not exists public.salon_resources (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name text not null,
  resource_type text not null
    check (resource_type = any (array['room'::text, 'bed'::text, 'equipment'::text, 'other'::text])),
  is_active boolean not null default true,
  capacity integer not null default 1 check (capacity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists salon_resources_location_name_unique
  on public.salon_resources (location_id, name);

create index if not exists idx_salon_resources_studio
  on public.salon_resources (studio_id);

create index if not exists idx_salon_resources_location_active
  on public.salon_resources (location_id, is_active);

create or replace function public.salon_resources_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
begin
  select studio_id into v_location_studio from public.locations where id = new.location_id;

  if v_location_studio is null then
    raise exception 'salon_resources references a missing location'
      using errcode = '23503';
  end if;
  if v_location_studio <> new.studio_id then
    raise exception 'salon_resources.studio_id must match location studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists salon_resources_validate_studio_trg on public.salon_resources;
create trigger salon_resources_validate_studio_trg
  before insert or update of location_id, studio_id on public.salon_resources
  for each row execute function public.salon_resources_validate_studio();

drop trigger if exists set_salon_resources_updated_at on public.salon_resources;
create trigger set_salon_resources_updated_at
  before update on public.salon_resources
  for each row execute function public.set_updated_at_timestamp();


-- ── service_resource_requirements ───────────────────────────────────────
-- Minimum relation: which resource TYPE (not a specific resource row) a
-- service requires, and how many. No allocation/locking — deliberately not a
-- full inventory system, per this task's brief.
create table if not exists public.service_resource_requirements (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  service_id uuid not null references public.studio_services(id) on delete cascade,
  resource_type text not null
    check (resource_type = any (array['room'::text, 'bed'::text, 'equipment'::text, 'other'::text])),
  required_quantity integer not null default 1 check (required_quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists service_resource_requirements_service_type_unique
  on public.service_resource_requirements (service_id, resource_type);

create index if not exists idx_service_resource_requirements_studio
  on public.service_resource_requirements (studio_id);

create or replace function public.service_resource_requirements_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
begin
  select studio_id into v_service_studio from public.studio_services where id = new.service_id;

  if v_service_studio is null then
    raise exception 'service_resource_requirements references a missing service'
      using errcode = '23503';
  end if;
  if v_service_studio <> new.studio_id then
    raise exception 'service_resource_requirements.studio_id must match service studio_id'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists service_resource_requirements_validate_studio_trg on public.service_resource_requirements;
create trigger service_resource_requirements_validate_studio_trg
  before insert or update of service_id, studio_id on public.service_resource_requirements
  for each row execute function public.service_resource_requirements_validate_studio();

drop trigger if exists set_service_resource_requirements_updated_at on public.service_resource_requirements;
create trigger set_service_resource_requirements_updated_at
  before update on public.service_resource_requirements
  for each row execute function public.set_updated_at_timestamp();


-- ── RLS ─────────────────────────────────────────────────────────────────
-- No client-facing policy on any of these tables (same posture as
-- service_locations / employee_migration_conflicts): all reads/writes go
-- through the server-side lib functions using the admin client, with scope
-- checks in src/lib/scope.ts before every mutation.
alter table public.service_employees enable row level security;
alter table public.location_operating_hours enable row level security;
alter table public.employee_working_hours enable row level security;
alter table public.employee_availability_exceptions enable row level security;
alter table public.salon_resources enable row level security;
alter table public.service_resource_requirements enable row level security;

revoke all on table public.service_employees from public;
revoke all on table public.service_employees from anon;
revoke all on table public.service_employees from authenticated;
grant all on table public.service_employees to service_role;

revoke all on table public.location_operating_hours from public;
revoke all on table public.location_operating_hours from anon;
revoke all on table public.location_operating_hours from authenticated;
grant all on table public.location_operating_hours to service_role;

revoke all on table public.employee_working_hours from public;
revoke all on table public.employee_working_hours from anon;
revoke all on table public.employee_working_hours from authenticated;
grant all on table public.employee_working_hours to service_role;

revoke all on table public.employee_availability_exceptions from public;
revoke all on table public.employee_availability_exceptions from anon;
revoke all on table public.employee_availability_exceptions from authenticated;
grant all on table public.employee_availability_exceptions to service_role;

revoke all on table public.salon_resources from public;
revoke all on table public.salon_resources from anon;
revoke all on table public.salon_resources from authenticated;
grant all on table public.salon_resources to service_role;

revoke all on table public.service_resource_requirements from public;
revoke all on table public.service_resource_requirements from anon;
revoke all on table public.service_resource_requirements from authenticated;
grant all on table public.service_resource_requirements to service_role;


-- ── RPC: set_service_employee_eligibility ──────────────────────────────
-- Owner / global Manager only, enforced in src/lib/service-availability.ts
-- via requireGlobalStaffScope before calling this RPC (Location Manager must
-- not change studio-wide service eligibility, per this task's brief).
create or replace function public.set_service_employee_eligibility(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_service_id uuid,
  p_employee_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_employee_studio uuid;
  v_before_row public.service_employees%rowtype;
  v_after_row public.service_employees%rowtype;
begin
  select studio_id into v_service_studio from public.studio_services where id = p_service_id;
  select studio_id into v_employee_studio from public.employees where id = p_employee_id;

  if v_service_studio is null or v_employee_studio is null then
    raise exception 'service or employee not found' using errcode = 'P0002';
  end if;
  if v_service_studio <> p_studio_id or v_employee_studio <> p_studio_id then
    raise exception 'service and employee must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  select * into v_before_row from public.service_employees
    where service_id = p_service_id and employee_id = p_employee_id
    for update;

  if not found then
    insert into public.service_employees (studio_id, service_id, employee_id, is_active)
    values (p_studio_id, p_service_id, p_employee_id, p_is_active)
    returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'service_employee_eligibility_changed',
      p_target_type := 'service_employee',
      p_actor_type := 'user',
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := jsonb_build_object('service_id', p_service_id, 'employee_id', p_employee_id, 'existed', false),
      p_after_state := to_jsonb(v_after_row)
    );
  else
    if v_before_row.is_active = p_is_active then
      return jsonb_build_object('ok', true, 'unchanged', true, 'service_employee_id', v_before_row.id);
    end if;

    update public.service_employees set is_active = p_is_active
      where id = v_before_row.id
      returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'service_employee_eligibility_changed',
      p_target_type := 'service_employee',
      p_actor_type := 'user',
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := to_jsonb(v_before_row),
      p_after_state := to_jsonb(v_after_row)
    );
  end if;

  return jsonb_build_object('ok', true, 'service_employee_id', v_after_row.id, 'is_active', v_after_row.is_active);
end;
$$;


-- ── RPC: update_studio_service_availability_defaults ───────────────────
-- Owner / global Manager only (same scope rule as above).
create or replace function public.update_studio_service_availability_defaults(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_service_id uuid,
  p_default_duration_minutes integer,
  p_default_prep_minutes integer,
  p_default_buffer_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before_row public.studio_services%rowtype;
  v_after_row public.studio_services%rowtype;
begin
  if p_default_duration_minutes is null or p_default_duration_minutes <= 0 then
    raise exception 'default duration must be positive' using errcode = '23514';
  end if;
  if p_default_prep_minutes is null or p_default_prep_minutes < 0 then
    raise exception 'default prep time must not be negative' using errcode = '23514';
  end if;
  if p_default_buffer_minutes is null or p_default_buffer_minutes < 0 then
    raise exception 'default buffer time must not be negative' using errcode = '23514';
  end if;

  select * into v_before_row from public.studio_services
    where id = p_service_id and studio_id = p_studio_id
    for update;
  if not found then
    raise exception 'service % not found in studio %', p_service_id, p_studio_id using errcode = 'P0002';
  end if;

  update public.studio_services
  set default_duration_minutes = p_default_duration_minutes,
      default_prep_minutes = p_default_prep_minutes,
      default_buffer_minutes = p_default_buffer_minutes
  where id = p_service_id
  returning * into v_after_row;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'service_availability_defaults_changed',
    p_target_type := 'studio_service',
    p_actor_type := 'user',
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_service_id,
    p_before_state := jsonb_build_object(
      'default_duration_minutes', v_before_row.default_duration_minutes,
      'default_prep_minutes', v_before_row.default_prep_minutes,
      'default_buffer_minutes', v_before_row.default_buffer_minutes
    ),
    p_after_state := jsonb_build_object(
      'default_duration_minutes', v_after_row.default_duration_minutes,
      'default_prep_minutes', v_after_row.default_prep_minutes,
      'default_buffer_minutes', v_after_row.default_buffer_minutes
    )
  );

  return jsonb_build_object('ok', true, 'service_id', p_service_id);
end;
$$;


-- ── RPC: set_service_resource_requirement ──────────────────────────────
-- Owner / global Manager only. p_required_quantity = null removes the
-- requirement for that resource_type.
create or replace function public.set_service_resource_requirement(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_service_id uuid,
  p_resource_type text,
  p_required_quantity integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_service_studio uuid;
  v_before_row public.service_resource_requirements%rowtype;
  v_after_row public.service_resource_requirements%rowtype;
begin
  if p_resource_type not in ('room', 'bed', 'equipment', 'other') then
    raise exception 'invalid resource type %', p_resource_type using errcode = '22023';
  end if;

  select studio_id into v_service_studio from public.studio_services where id = p_service_id;
  if v_service_studio is null then
    raise exception 'service % not found', p_service_id using errcode = 'P0002';
  end if;
  if v_service_studio <> p_studio_id then
    raise exception 'service must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  select * into v_before_row from public.service_resource_requirements
    where service_id = p_service_id and resource_type = p_resource_type
    for update;

  if p_required_quantity is null then
    if found then
      delete from public.service_resource_requirements where id = v_before_row.id;

      perform public.record_strong_audit(
        p_studio_id := p_studio_id,
        p_action := 'service_resource_requirement_removed',
        p_target_type := 'service_resource_requirement',
        p_actor_type := 'user',
        p_actor_id := p_actor_id,
        p_actor_role := p_actor_role,
        p_target_id := v_before_row.id,
        p_before_state := to_jsonb(v_before_row),
        p_after_state := null
      );
    end if;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  if p_required_quantity <= 0 then
    raise exception 'required quantity must be positive' using errcode = '23514';
  end if;

  if not found then
    insert into public.service_resource_requirements (studio_id, service_id, resource_type, required_quantity)
    values (p_studio_id, p_service_id, p_resource_type, p_required_quantity)
    returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'service_resource_requirement_changed',
      p_target_type := 'service_resource_requirement',
      p_actor_type := 'user',
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := jsonb_build_object('service_id', p_service_id, 'resource_type', p_resource_type, 'existed', false),
      p_after_state := to_jsonb(v_after_row)
    );
  else
    update public.service_resource_requirements set required_quantity = p_required_quantity
      where id = v_before_row.id
      returning * into v_after_row;

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'service_resource_requirement_changed',
      p_target_type := 'service_resource_requirement',
      p_actor_type := 'user',
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_after_row.id,
      p_before_state := to_jsonb(v_before_row),
      p_after_state := to_jsonb(v_after_row)
    );
  end if;

  return jsonb_build_object('ok', true, 'service_resource_requirement_id', v_after_row.id);
end;
$$;


-- ── RPC: set_location_operating_hours_for_weekday ──────────────────────
-- Owner / global Manager (any location) or Location Manager restricted to
-- their own authorised location, enforced in src/lib/staff-availability.ts
-- via requireStaffScope before calling this RPC. Replaces every row for the
-- given (location_id, weekday) atomically, so a partial write can never
-- leave stale intervals behind. p_intervals is a JSON array of
-- {"opens_at":"09:00","closes_at":"12:00"} objects; ignored when
-- p_is_closed = true. Rejects overlapping intervals within the submitted
-- set — this RPC is the only write path for this table, so the rejection is
-- a real database-level guarantee, not merely an app-layer check.
create or replace function public.set_location_operating_hours_for_weekday(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_weekday integer,
  p_is_closed boolean,
  p_intervals jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_before_rows jsonb;
  v_after_rows jsonb;
  v_interval jsonb;
  v_opens time;
  v_closes time;
  v_prev_closes time;
  v_count integer := 0;
begin
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'weekday must be between 0 and 6' using errcode = '22023';
  end if;

  select studio_id into v_location_studio from public.locations where id = p_location_id;
  if v_location_studio is null then
    raise exception 'location % not found', p_location_id using errcode = 'P0002';
  end if;
  if v_location_studio <> p_studio_id then
    raise exception 'location must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_before_rows
  from public.location_operating_hours t
  where t.location_id = p_location_id and t.weekday = p_weekday;

  delete from public.location_operating_hours
  where location_id = p_location_id and weekday = p_weekday;

  if p_is_closed then
    insert into public.location_operating_hours (studio_id, location_id, weekday, is_closed, opens_at, closes_at)
    values (p_studio_id, p_location_id, p_weekday, true, null, null);
    v_count := 1;
  else
    if p_intervals is null or jsonb_array_length(p_intervals) = 0 then
      raise exception 'at least one interval is required when the day is not closed' using errcode = '23514';
    end if;

    v_prev_closes := null;
    for v_interval in
      select elem from jsonb_array_elements(p_intervals) as elem
      order by (elem ->> 'opens_at')
    loop
      v_opens := (v_interval ->> 'opens_at')::time;
      v_closes := (v_interval ->> 'closes_at')::time;

      if v_opens is null or v_closes is null then
        raise exception 'each interval requires opens_at and closes_at' using errcode = '23514';
      end if;
      if v_closes <= v_opens then
        raise exception 'closes_at must be after opens_at' using errcode = '23514';
      end if;
      if v_prev_closes is not null and v_opens < v_prev_closes then
        raise exception 'operating hour intervals must not overlap' using errcode = '23514';
      end if;

      insert into public.location_operating_hours (studio_id, location_id, weekday, is_closed, opens_at, closes_at)
      values (p_studio_id, p_location_id, p_weekday, false, v_opens, v_closes);

      v_prev_closes := v_closes;
      v_count := v_count + 1;
    end loop;
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_after_rows
  from public.location_operating_hours t
  where t.location_id = p_location_id and t.weekday = p_weekday;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'location_operating_hours_changed',
    p_target_type := 'location_operating_hours',
    p_actor_type := 'user',
    p_location_id := p_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_location_id,
    p_before_state := jsonb_build_object('weekday', p_weekday, 'rows', v_before_rows),
    p_after_state := jsonb_build_object('weekday', p_weekday, 'rows', v_after_rows)
  );

  return jsonb_build_object('ok', true, 'location_id', p_location_id, 'weekday', p_weekday, 'interval_count', v_count);
end;
$$;


-- ── RPC: set_employee_working_hours_for_weekday ────────────────────────
-- Owner / global Manager (any location) or Location Manager restricted to
-- their own authorised location AND only for employees assigned there,
-- enforced in src/lib/staff-availability.ts. Same replace-whole-weekday
-- pattern as location hours. Submitting an empty p_intervals array clears
-- the day (employee does not work that weekday at that location) — a
-- normal, expected state, unlike location operating hours which require at
-- least one interval when not explicitly closed.
create or replace function public.set_employee_working_hours_for_weekday(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_employee_id uuid,
  p_location_id uuid,
  p_weekday integer,
  p_intervals jsonb default '[]'::jsonb,
  p_effective_from date default null,
  p_effective_until date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee_studio uuid;
  v_location_studio uuid;
  v_before_rows jsonb;
  v_after_rows jsonb;
  v_interval jsonb;
  v_starts time;
  v_ends time;
  v_prev_ends time;
  v_count integer := 0;
begin
  if p_weekday < 0 or p_weekday > 6 then
    raise exception 'weekday must be between 0 and 6' using errcode = '22023';
  end if;
  if p_effective_from is not null and p_effective_until is not null and p_effective_until < p_effective_from then
    raise exception 'effective_until must not be before effective_from' using errcode = '23514';
  end if;

  select studio_id into v_employee_studio from public.employees where id = p_employee_id;
  select studio_id into v_location_studio from public.locations where id = p_location_id;
  if v_employee_studio is null or v_location_studio is null then
    raise exception 'employee or location not found' using errcode = 'P0002';
  end if;
  if v_employee_studio <> p_studio_id or v_location_studio <> p_studio_id then
    raise exception 'employee and location must belong to studio %', p_studio_id using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.employee_locations el
    where el.employee_id = p_employee_id and el.location_id = p_location_id and el.is_active
  ) then
    raise exception 'employee % has no active employee_locations assignment for location %', p_employee_id, p_location_id
      using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_before_rows
  from public.employee_working_hours t
  where t.employee_id = p_employee_id and t.location_id = p_location_id and t.weekday = p_weekday;

  delete from public.employee_working_hours
  where employee_id = p_employee_id and location_id = p_location_id and weekday = p_weekday;

  if p_intervals is not null and jsonb_array_length(p_intervals) > 0 then
    v_prev_ends := null;
    for v_interval in
      select elem from jsonb_array_elements(p_intervals) as elem
      order by (elem ->> 'starts_at')
    loop
      v_starts := (v_interval ->> 'starts_at')::time;
      v_ends := (v_interval ->> 'ends_at')::time;

      if v_starts is null or v_ends is null then
        raise exception 'each interval requires starts_at and ends_at' using errcode = '23514';
      end if;
      if v_ends <= v_starts then
        raise exception 'ends_at must be after starts_at' using errcode = '23514';
      end if;
      if v_prev_ends is not null and v_starts < v_prev_ends then
        raise exception 'working hour intervals must not overlap' using errcode = '23514';
      end if;

      insert into public.employee_working_hours
        (studio_id, employee_id, location_id, weekday, starts_at, ends_at, effective_from, effective_until, is_active)
      values
        (p_studio_id, p_employee_id, p_location_id, p_weekday, v_starts, v_ends, p_effective_from, p_effective_until, true);

      v_prev_ends := v_ends;
      v_count := v_count + 1;
    end loop;
  end if;

  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_after_rows
  from public.employee_working_hours t
  where t.employee_id = p_employee_id and t.location_id = p_location_id and t.weekday = p_weekday;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'employee_working_hours_changed',
    p_target_type := 'employee_working_hours',
    p_actor_type := 'user',
    p_location_id := p_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_employee_id,
    p_before_state := jsonb_build_object('weekday', p_weekday, 'rows', v_before_rows),
    p_after_state := jsonb_build_object('weekday', p_weekday, 'rows', v_after_rows)
  );

  return jsonb_build_object('ok', true, 'employee_id', p_employee_id, 'location_id', p_location_id, 'weekday', p_weekday, 'interval_count', v_count);
end;
$$;


-- ── RPC: create_employee_availability_exception ────────────────────────
-- Same scope rule as employee working hours.
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


-- ── RPC: delete_employee_availability_exception ────────────────────────
create or replace function public.delete_employee_availability_exception(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_exception_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before_row public.employee_availability_exceptions%rowtype;
begin
  select * into v_before_row from public.employee_availability_exceptions
    where id = p_exception_id and studio_id = p_studio_id
    for update;
  if not found then
    raise exception 'exception % not found in studio %', p_exception_id, p_studio_id using errcode = 'P0002';
  end if;

  delete from public.employee_availability_exceptions where id = p_exception_id;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'employee_availability_exception_deleted',
    p_target_type := 'employee_availability_exception',
    p_actor_type := 'user',
    p_location_id := v_before_row.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := p_exception_id,
    p_before_state := to_jsonb(v_before_row),
    p_after_state := null
  );

  return jsonb_build_object('ok', true);
end;
$$;


-- ── RPC: upsert_salon_resource ──────────────────────────────────────────
-- Owner / global Manager (any location) or Location Manager restricted to
-- their own authorised location. p_resource_id = null creates a new
-- resource; otherwise updates the existing one (never a hard delete — use
-- set_salon_resource_active to retire a resource while preserving history).
create or replace function public.upsert_salon_resource(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_name text,
  p_resource_type text,
  p_capacity integer default 1,
  p_resource_id uuid default null
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


-- ── RPC: set_salon_resource_active ──────────────────────────────────────
create or replace function public.set_salon_resource_active(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_resource_id uuid,
  p_is_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before_row public.salon_resources%rowtype;
  v_after_row public.salon_resources%rowtype;
begin
  select * into v_before_row from public.salon_resources
    where id = p_resource_id and studio_id = p_studio_id
    for update;
  if not found then
    raise exception 'resource % not found in studio %', p_resource_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_before_row.is_active = p_is_active then
    return jsonb_build_object('ok', true, 'unchanged', true, 'resource_id', v_before_row.id);
  end if;

  update public.salon_resources set is_active = p_is_active
    where id = p_resource_id
    returning * into v_after_row;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_resource_active_changed',
    p_target_type := 'salon_resource',
    p_actor_type := 'user',
    p_location_id := v_after_row.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_after_row.id,
    p_before_state := to_jsonb(v_before_row),
    p_after_state := to_jsonb(v_after_row)
  );

  return jsonb_build_object('ok', true, 'resource_id', v_after_row.id, 'is_active', v_after_row.is_active);
end;
$$;


-- ── Function grants ────────────────────────────────────────────────────
revoke all on function public.set_updated_at_timestamp() from public, anon, authenticated;
grant all on function public.set_updated_at_timestamp() to service_role;

revoke all on function public.service_employees_validate_studio() from public, anon, authenticated;
grant all on function public.service_employees_validate_studio() to service_role;

revoke all on function public.location_operating_hours_validate_studio() from public, anon, authenticated;
grant all on function public.location_operating_hours_validate_studio() to service_role;

revoke all on function public.employee_working_hours_validate_studio() from public, anon, authenticated;
grant all on function public.employee_working_hours_validate_studio() to service_role;

revoke all on function public.employee_availability_exceptions_validate_studio() from public, anon, authenticated;
grant all on function public.employee_availability_exceptions_validate_studio() to service_role;

revoke all on function public.salon_resources_validate_studio() from public, anon, authenticated;
grant all on function public.salon_resources_validate_studio() to service_role;

revoke all on function public.service_resource_requirements_validate_studio() from public, anon, authenticated;
grant all on function public.service_resource_requirements_validate_studio() to service_role;

revoke all on function public.set_service_employee_eligibility(uuid, text, uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant all on function public.set_service_employee_eligibility(uuid, text, uuid, uuid, uuid, boolean) to service_role;

revoke all on function public.update_studio_service_availability_defaults(uuid, text, uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant all on function public.update_studio_service_availability_defaults(uuid, text, uuid, uuid, integer, integer, integer) to service_role;

revoke all on function public.set_service_resource_requirement(uuid, text, uuid, uuid, text, integer) from public, anon, authenticated;
grant all on function public.set_service_resource_requirement(uuid, text, uuid, uuid, text, integer) to service_role;

revoke all on function public.set_location_operating_hours_for_weekday(uuid, text, uuid, uuid, integer, boolean, jsonb) from public, anon, authenticated;
grant all on function public.set_location_operating_hours_for_weekday(uuid, text, uuid, uuid, integer, boolean, jsonb) to service_role;

revoke all on function public.set_employee_working_hours_for_weekday(uuid, text, uuid, uuid, uuid, integer, jsonb, date, date) from public, anon, authenticated;
grant all on function public.set_employee_working_hours_for_weekday(uuid, text, uuid, uuid, uuid, integer, jsonb, date, date) to service_role;

revoke all on function public.create_employee_availability_exception(uuid, text, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) from public, anon, authenticated;
grant all on function public.create_employee_availability_exception(uuid, text, uuid, uuid, text, text, timestamptz, timestamptz, uuid, text) to service_role;

revoke all on function public.delete_employee_availability_exception(uuid, text, uuid, uuid) from public, anon, authenticated;
grant all on function public.delete_employee_availability_exception(uuid, text, uuid, uuid) to service_role;

revoke all on function public.upsert_salon_resource(uuid, text, uuid, uuid, text, text, integer, uuid) from public, anon, authenticated;
grant all on function public.upsert_salon_resource(uuid, text, uuid, uuid, text, text, integer, uuid) to service_role;

revoke all on function public.set_salon_resource_active(uuid, text, uuid, uuid, boolean) from public, anon, authenticated;
grant all on function public.set_salon_resource_active(uuid, text, uuid, uuid, boolean) to service_role;
