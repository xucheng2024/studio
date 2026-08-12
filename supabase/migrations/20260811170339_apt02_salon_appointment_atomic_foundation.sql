-- APT-02: Salon Appointment atomic transaction foundation.
--
-- Scope in this migration:
--   * salon_appointments + occupancy-safe constraints
--   * salon_appointment_status_history (append-only)
--   * salon_appointment_resources (append-only history + active occupancy rows)
--   * salon_terms_versions / salon_terms_acceptances foundation (append-only acceptance evidence)
--   * SECURITY DEFINER RPCs for atomic create/reschedule/cancel/expire/get
--   * DB-side validation for studio/location/service/customer/employee/resource consistency
--
-- Out of scope for this migration:
--   * Calendar UI / appointment pages (APT-03+)
--   * customer self-service (APT-04)
--   * payment/deposit/package/POS integration
--   * notifications

create extension if not exists btree_gist;

-- ── Helper: append-only guard ────────────────────────────────────────────
create or replace function public.raise_append_only_violation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% is append-only: update is not allowed', tg_table_name using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    raise exception '% is append-only: delete is not allowed', tg_table_name using errcode = '23514';
  end if;
  return null;
end;
$$;


-- ── Helper: role gate for appointment mutations ──────────────────────────
create or replace function public.assert_salon_appointment_actor_role(p_actor_role text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_actor_role not in ('owner', 'manager', 'frontdesk') then
    raise exception 'appointment mutation role % is not allowed', p_actor_role using errcode = '42501';
  end if;
end;
$$;


-- ── Helper: effective service timing + snapshot source ───────────────────
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
begin
  select id, studio_id, name, price, currency, is_active, default_duration_minutes, default_prep_minutes, default_buffer_minutes
  into v_service
  from public.studio_services
  where id = p_service_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'service % not found in studio %', p_service_id, p_studio_id using errcode = 'P0002';
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
    v_service.name::text,
    v_service.price::numeric,
    v_service.currency::text,
    coalesce(v_service_location.duration_override_minutes, v_service.default_duration_minutes)::integer,
    v_service.default_prep_minutes::integer,
    coalesce(v_service_location.buffer_override_minutes, v_service.default_buffer_minutes)::integer,
    v_location.name::text;
end;
$$;


-- ── Helper: employee bookability + availability by occupied interval ─────
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

  select id, studio_id, employment_status, is_active
  into v_employee
  from public.employees
  where id = p_employee_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'employee % not found in studio %', p_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  if coalesce(v_employee.is_active, true) is distinct from true then
    raise exception 'employee % is inactive', p_employee_id using errcode = '23514';
  end if;

  if coalesce(lower(v_employee.employment_status), 'active') not in ('active', 'probation') then
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


-- ── Helper: resource validation + requirement satisfaction ───────────────
create or replace function public.assert_resources_valid_for_appointment(
  p_studio_id uuid,
  p_location_id uuid,
  p_service_id uuid,
  p_resource_ids uuid[]
)
returns table (
  resource_id uuid,
  resource_kind text
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_distinct_ids uuid[];
  v_required_count integer;
  v_selected_count integer;
  v_missing record;
begin
  v_distinct_ids := coalesce(
    array(
      select distinct rid
      from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as rid
      where rid is not null
    ),
    '{}'::uuid[]
  );

  select count(*)::integer
  into v_required_count
  from public.service_resource_requirements req
  where req.studio_id = p_studio_id
    and req.service_id = p_service_id;

  if v_required_count > 0 and coalesce(array_length(v_distinct_ids, 1), 0) = 0 then
    raise exception 'service % requires resources but none were supplied', p_service_id using errcode = '23514';
  end if;

  if coalesce(array_length(v_distinct_ids, 1), 0) > 0 then
    select count(*)::integer
    into v_selected_count
    from public.salon_resources r
    where r.id = any(v_distinct_ids)
      and r.studio_id = p_studio_id
      and r.location_id = p_location_id
      and r.is_active;

    if v_selected_count <> array_length(v_distinct_ids, 1) then
      raise exception 'one or more resources are missing, disabled, or outside the appointment location' using errcode = '23514';
    end if;
  end if;

  if v_required_count > 0 then
    for v_missing in
      with req as (
        select resource_type, required_quantity
        from public.service_resource_requirements
        where studio_id = p_studio_id
          and service_id = p_service_id
      ),
      selected as (
        select r.resource_type, count(*)::integer as selected_quantity
        from public.salon_resources r
        where r.id = any(v_distinct_ids)
        group by r.resource_type
      )
      select req.resource_type, req.required_quantity, coalesce(selected.selected_quantity, 0) as selected_quantity
      from req
      left join selected on selected.resource_type = req.resource_type
      where coalesce(selected.selected_quantity, 0) < req.required_quantity
    loop
      raise exception 'missing required resource type %, requires %, got %',
        v_missing.resource_type, v_missing.required_quantity, v_missing.selected_quantity
        using errcode = '23514';
    end loop;
  end if;

  return query
  select r.id, r.resource_type
  from public.salon_resources r
  where r.id = any(v_distinct_ids)
  order by r.id;
end;
$$;


-- ── salon_appointments ───────────────────────────────────────────────────
create table if not exists public.salon_appointments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  service_id uuid not null references public.studio_services(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  status text not null check (status = any (array['pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  occupied_from timestamptz not null,
  occupied_until timestamptz not null,
  expires_at timestamptz,
  cancellation_reason text,
  cancellation_actor_id uuid references public.users(id) on delete set null,
  cancellation_actor_role text,
  cancelled_at timestamptz,
  internal_note text,
  service_title_snapshot text not null,
  service_price_snapshot numeric(12,2) not null,
  service_currency_snapshot text not null,
  service_duration_snapshot_minutes integer not null check (service_duration_snapshot_minutes > 0),
  prep_snapshot_minutes integer not null check (prep_snapshot_minutes >= 0),
  buffer_snapshot_minutes integer not null check (buffer_snapshot_minutes >= 0),
  employee_name_snapshot text not null,
  location_name_snapshot text not null,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_appointments_time_range check (ends_at > starts_at),
  constraint salon_appointments_occupied_range check (
    occupied_until > occupied_from
    and occupied_from <= starts_at
    and occupied_until >= ends_at
  ),
  constraint salon_appointments_pending_expires check (
    status <> 'pending' or expires_at is not null
  ),
  constraint salon_appointments_cancel_fields check (
    status <> 'cancelled'
    or (cancelled_at is not null and cancellation_reason is not null)
  )
);

create index if not exists idx_salon_appointments_studio_starts
  on public.salon_appointments (studio_id, starts_at);

create index if not exists idx_salon_appointments_studio_status_starts
  on public.salon_appointments (studio_id, status, starts_at);

create index if not exists idx_salon_appointments_location_starts
  on public.salon_appointments (location_id, starts_at);

create index if not exists idx_salon_appointments_customer
  on public.salon_appointments (salon_customer_id, starts_at desc);

create index if not exists idx_salon_appointments_employee_occupied
  on public.salon_appointments (employee_id, occupied_from, occupied_until);

create index if not exists idx_salon_appointments_pending_expires
  on public.salon_appointments (expires_at)
  where status = 'pending' and expires_at is not null;

-- Cross-location conflict prevention for the same employee inside one studio.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'salon_appointments_employee_no_overlap'
      and conrelid = 'public.salon_appointments'::regclass
  ) then
    alter table public.salon_appointments
      add constraint salon_appointments_employee_no_overlap
      exclude using gist (
        studio_id with =,
        employee_id with =,
        tstzrange(occupied_from, occupied_until, '[)') with &&
      )
      where (status = any (array['pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text]));
  end if;
end
$$;

create or replace function public.salon_appointments_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_location_studio uuid;
  v_customer record;
  v_service_studio uuid;
  v_employee_studio uuid;
  v_service_location_enabled boolean;
  v_assignment_ok boolean;
  v_eligibility_ok boolean;
begin
  select studio_id into v_location_studio from public.locations where id = new.location_id;
  if v_location_studio is null or v_location_studio <> new.studio_id then
    raise exception 'appointment location must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  select studio_id, merged_into_id into v_customer
  from public.salon_customers where id = new.salon_customer_id;
  if v_customer.studio_id is null or v_customer.studio_id <> new.studio_id then
    raise exception 'appointment customer must belong to studio %', new.studio_id using errcode = '23514';
  end if;
  if v_customer.merged_into_id is not null then
    raise exception 'cannot use merged customer % for appointment', new.salon_customer_id using errcode = '23514';
  end if;

  select studio_id into v_service_studio from public.studio_services where id = new.service_id;
  if v_service_studio is null or v_service_studio <> new.studio_id then
    raise exception 'appointment service must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  select studio_id into v_employee_studio from public.employees where id = new.employee_id;
  if v_employee_studio is null or v_employee_studio <> new.studio_id then
    raise exception 'appointment employee must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.service_locations sl
    where sl.studio_id = new.studio_id
      and sl.service_id = new.service_id
      and sl.location_id = new.location_id
      and sl.is_enabled
  ) into v_service_location_enabled;

  if not v_service_location_enabled then
    raise exception 'service % is not enabled at location %', new.service_id, new.location_id using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.employee_locations el
    where el.studio_id = new.studio_id
      and el.employee_id = new.employee_id
      and el.location_id = new.location_id
      and el.is_active
  ) into v_assignment_ok;

  if not v_assignment_ok then
    raise exception 'employee % has no active location assignment at %', new.employee_id, new.location_id using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.service_employees se
    where se.studio_id = new.studio_id
      and se.service_id = new.service_id
      and se.employee_id = new.employee_id
      and se.is_active
  ) into v_eligibility_ok;

  if not v_eligibility_ok then
    raise exception 'employee % is not active for service %', new.employee_id, new.service_id using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists salon_appointments_validate_refs_trg on public.salon_appointments;
create trigger salon_appointments_validate_refs_trg
  before insert or update of studio_id, location_id, salon_customer_id, service_id, employee_id
  on public.salon_appointments
  for each row execute function public.salon_appointments_validate_refs();

drop trigger if exists set_salon_appointments_updated_at on public.salon_appointments;
create trigger set_salon_appointments_updated_at
  before update on public.salon_appointments
  for each row execute function public.set_updated_at_timestamp();


-- ── salon_appointment_status_history (append-only) ───────────────────────
create table if not exists public.salon_appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.salon_appointments(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete restrict,
  from_status text check (from_status is null or from_status = any (array['pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])),
  to_status text not null check (to_status = any (array['pending'::text, 'confirmed'::text, 'checked_in'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text])),
  actor text not null check (actor = any (array['user'::text, 'system'::text, 'service'::text])),
  actor_id uuid references public.users(id) on delete set null,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_salon_appointment_status_history_appointment
  on public.salon_appointment_status_history (appointment_id, created_at desc);

create index if not exists idx_salon_appointment_status_history_studio
  on public.salon_appointment_status_history (studio_id, created_at desc);

create or replace function public.salon_appointment_status_history_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appointment_studio uuid;
begin
  select studio_id into v_appointment_studio
  from public.salon_appointments
  where id = new.appointment_id;

  if v_appointment_studio is null then
    raise exception 'appointment % not found for status history', new.appointment_id using errcode = 'P0002';
  end if;
  if v_appointment_studio <> new.studio_id then
    raise exception 'status_history.studio_id must match appointment studio_id' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists salon_appointment_status_history_validate_studio_trg on public.salon_appointment_status_history;
create trigger salon_appointment_status_history_validate_studio_trg
  before insert on public.salon_appointment_status_history
  for each row execute function public.salon_appointment_status_history_validate_studio();

drop trigger if exists salon_appointment_status_history_append_only_upd on public.salon_appointment_status_history;
create trigger salon_appointment_status_history_append_only_upd
  before update on public.salon_appointment_status_history
  for each row execute function public.raise_append_only_violation();

drop trigger if exists salon_appointment_status_history_append_only_del on public.salon_appointment_status_history;
create trigger salon_appointment_status_history_append_only_del
  before delete on public.salon_appointment_status_history
  for each row execute function public.raise_append_only_violation();


-- ── salon_appointment_resources ──────────────────────────────────────────
create table if not exists public.salon_appointment_resources (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.salon_appointments(id) on delete restrict,
  resource_id uuid not null references public.salon_resources(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  occupied_from timestamptz not null,
  occupied_until timestamptz not null,
  is_active boolean not null default true,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_appointment_resources_time_range check (occupied_until > occupied_from),
  constraint salon_appointment_resources_release_consistency check (
    (is_active and released_at is null)
    or ((not is_active) and released_at is not null)
  )
);

create unique index if not exists salon_appointment_resources_unique
  on public.salon_appointment_resources (appointment_id, resource_id)
  where is_active;

create index if not exists idx_salon_appointment_resources_appointment
  on public.salon_appointment_resources (appointment_id, is_active);

create index if not exists idx_salon_appointment_resources_resource_occupied
  on public.salon_appointment_resources (resource_id, occupied_from, occupied_until)
  where is_active;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'salon_appointment_resources_no_overlap'
      and conrelid = 'public.salon_appointment_resources'::regclass
  ) then
    alter table public.salon_appointment_resources
      add constraint salon_appointment_resources_no_overlap
      exclude using gist (
        studio_id with =,
        resource_id with =,
        tstzrange(occupied_from, occupied_until, '[)') with &&
      )
      where (is_active);
  end if;
end
$$;

create or replace function public.salon_appointment_resources_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_appointment record;
  v_resource record;
begin
  select id, studio_id, location_id, occupied_from, occupied_until, status
  into v_appointment
  from public.salon_appointments
  where id = new.appointment_id;

  if not found then
    raise exception 'appointment % not found for resource allocation', new.appointment_id using errcode = 'P0002';
  end if;

  select id, studio_id, location_id, is_active
  into v_resource
  from public.salon_resources
  where id = new.resource_id;

  if not found then
    raise exception 'resource % not found', new.resource_id using errcode = 'P0002';
  end if;

  if v_appointment.studio_id <> new.studio_id
    or v_resource.studio_id <> new.studio_id
    or v_appointment.location_id <> new.location_id
    or v_resource.location_id <> new.location_id then
    raise exception 'appointment/resource/location/studio mismatch' using errcode = '23514';
  end if;

  if new.is_active then
    if not v_resource.is_active then
      raise exception 'resource % is disabled', new.resource_id using errcode = '23514';
    end if;
    if v_appointment.status not in ('pending', 'confirmed', 'checked_in', 'in_progress') then
      raise exception 'cannot keep active allocation for non-occupying appointment status %', v_appointment.status using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists salon_appointment_resources_validate_refs_trg on public.salon_appointment_resources;
create trigger salon_appointment_resources_validate_refs_trg
  before insert or update of appointment_id, resource_id, studio_id, location_id, is_active
  on public.salon_appointment_resources
  for each row execute function public.salon_appointment_resources_validate_refs();

drop trigger if exists set_salon_appointment_resources_updated_at on public.salon_appointment_resources;
create trigger set_salon_appointment_resources_updated_at
  before update on public.salon_appointment_resources
  for each row execute function public.set_updated_at_timestamp();


-- ── Terms foundation ─────────────────────────────────────────────────────
create table if not exists public.salon_terms_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  version_label text not null,
  content_hash text not null,
  content_snapshot jsonb,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_terms_versions_hash_non_empty check (length(btrim(content_hash)) > 0)
);

create unique index if not exists salon_terms_versions_studio_hash_unique
  on public.salon_terms_versions (studio_id, content_hash);

create index if not exists idx_salon_terms_versions_studio_published
  on public.salon_terms_versions (studio_id, published_at desc);

drop trigger if exists set_salon_terms_versions_updated_at on public.salon_terms_versions;
create trigger set_salon_terms_versions_updated_at
  before update on public.salon_terms_versions
  for each row execute function public.set_updated_at_timestamp();

create table if not exists public.salon_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  terms_version_id uuid not null references public.salon_terms_versions(id) on delete restrict,
  appointment_id uuid references public.salon_appointments(id) on delete restrict,
  salon_customer_id uuid references public.salon_customers(id) on delete restrict,
  accepted_at timestamptz not null,
  acceptance_channel text not null,
  acceptance_method text not null,
  recorded_by uuid references public.users(id) on delete set null,
  content_hash_snapshot text not null,
  version_label_snapshot text,
  created_at timestamptz not null default now(),
  constraint salon_terms_acceptance_hash_non_empty check (length(btrim(content_hash_snapshot)) > 0)
);

create index if not exists idx_salon_terms_acceptances_studio_created
  on public.salon_terms_acceptances (studio_id, created_at desc);

create index if not exists idx_salon_terms_acceptances_appointment
  on public.salon_terms_acceptances (appointment_id, created_at desc)
  where appointment_id is not null;

create or replace function public.salon_terms_acceptances_validate_studio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_terms_studio uuid;
  v_appointment_studio uuid;
  v_customer_studio uuid;
begin
  select studio_id into v_terms_studio
  from public.salon_terms_versions
  where id = new.terms_version_id;

  if v_terms_studio is null or v_terms_studio <> new.studio_id then
    raise exception 'terms acceptance version must belong to studio %', new.studio_id using errcode = '23514';
  end if;

  if new.appointment_id is not null then
    select studio_id into v_appointment_studio
    from public.salon_appointments
    where id = new.appointment_id;

    if v_appointment_studio is null or v_appointment_studio <> new.studio_id then
      raise exception 'terms acceptance appointment must belong to studio %', new.studio_id using errcode = '23514';
    end if;
  end if;

  if new.salon_customer_id is not null then
    select studio_id into v_customer_studio
    from public.salon_customers
    where id = new.salon_customer_id;

    if v_customer_studio is null or v_customer_studio <> new.studio_id then
      raise exception 'terms acceptance customer must belong to studio %', new.studio_id using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists salon_terms_acceptances_validate_studio_trg on public.salon_terms_acceptances;
create trigger salon_terms_acceptances_validate_studio_trg
  before insert on public.salon_terms_acceptances
  for each row execute function public.salon_terms_acceptances_validate_studio();

drop trigger if exists salon_terms_acceptances_append_only_upd on public.salon_terms_acceptances;
create trigger salon_terms_acceptances_append_only_upd
  before update on public.salon_terms_acceptances
  for each row execute function public.raise_append_only_violation();

drop trigger if exists salon_terms_acceptances_append_only_del on public.salon_terms_acceptances;
create trigger salon_terms_acceptances_append_only_del
  before delete on public.salon_terms_acceptances
  for each row execute function public.raise_append_only_violation();


-- ── RPC: create_salon_appointment ────────────────────────────────────────
create or replace function public.assert_business_idempotency_claim_for_appointment(
  p_id uuid,
  p_claim_token uuid,
  p_studio_id uuid,
  p_operation_scope text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.business_idempotency_keys%rowtype;
begin
  select * into v_row
  from public.business_idempotency_keys
  where id = p_id
  for update;

  if not found then
    raise exception 'idempotency record % not found', p_id using errcode = 'P0002';
  end if;

  if v_row.studio_id <> p_studio_id then
    raise exception 'idempotency record studio mismatch' using errcode = '23514';
  end if;

  if v_row.operation_scope <> p_operation_scope then
    raise exception 'idempotency operation scope mismatch' using errcode = '23514';
  end if;

  if v_row.status <> 'processing' or v_row.claim_token <> p_claim_token then
    raise exception 'idempotency claim token is not current' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.complete_business_idempotency_key_for_appointment(
  p_id uuid,
  p_claim_token uuid,
  p_result_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  select public.complete_business_idempotency_key(
    p_id := p_id,
    p_claim_token := p_claim_token,
    p_result_snapshot := p_result_snapshot
  ) into v_result;

  if coalesce((v_result ->> 'ok')::boolean, false) is distinct from true then
    raise exception 'idempotency claim token is not current' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.create_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_location_id uuid,
  p_salon_customer_id uuid,
  p_service_id uuid,
  p_employee_id uuid,
  p_starts_at timestamptz,
  p_resource_ids uuid[] default null,
  p_terms_version_id uuid default null,
  p_terms_accepted_at timestamptz default null,
  p_terms_acceptance_channel text default null,
  p_terms_acceptance_method text default null,
  p_terms_recorded_by uuid default null,
  p_expires_at timestamptz default null,
  p_internal_note text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_timing record;
  v_employee record;
  v_appointment public.salon_appointments%rowtype;
  v_ends_at timestamptz;
  v_occupied_from timestamptz;
  v_occupied_until timestamptz;
  v_expires_at timestamptz;
  v_terms record;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
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
      p_operation_scope := 'salon_appointment:create'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  if p_starts_at is null then
    raise exception 'starts_at is required' using errcode = '23514';
  end if;

  select * into v_timing
  from public.get_effective_service_timing_for_appointment(p_studio_id, p_service_id, p_location_id);

  v_ends_at := p_starts_at + make_interval(mins => v_timing.duration_minutes);
  v_occupied_from := p_starts_at - make_interval(mins => v_timing.prep_minutes);
  v_occupied_until := v_ends_at + make_interval(mins => v_timing.buffer_minutes);
  v_expires_at := coalesce(p_expires_at, now() + interval '15 minutes');

  select id, display_name
  into v_employee
  from public.employees
  where id = p_employee_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'employee % not found in studio %', p_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  perform public.assert_employee_available_for_appointment(
    p_studio_id,
    p_location_id,
    p_service_id,
    p_employee_id,
    v_occupied_from,
    v_occupied_until
  );

  perform * from public.assert_resources_valid_for_appointment(
    p_studio_id,
    p_location_id,
    p_service_id,
    p_resource_ids
  );

  insert into public.salon_appointments (
    studio_id,
    location_id,
    salon_customer_id,
    service_id,
    employee_id,
    status,
    starts_at,
    ends_at,
    occupied_from,
    occupied_until,
    expires_at,
    internal_note,
    service_title_snapshot,
    service_price_snapshot,
    service_currency_snapshot,
    service_duration_snapshot_minutes,
    prep_snapshot_minutes,
    buffer_snapshot_minutes,
    employee_name_snapshot,
    location_name_snapshot,
    created_by,
    updated_by
  )
  values (
    p_studio_id,
    p_location_id,
    p_salon_customer_id,
    p_service_id,
    p_employee_id,
    'pending',
    p_starts_at,
    v_ends_at,
    v_occupied_from,
    v_occupied_until,
    v_expires_at,
    p_internal_note,
    v_timing.service_title,
    v_timing.service_price,
    v_timing.service_currency,
    v_timing.duration_minutes,
    v_timing.prep_minutes,
    v_timing.buffer_minutes,
    v_employee.display_name,
    v_timing.location_name,
    p_actor_id,
    p_actor_id
  )
  returning * into v_appointment;

  insert into public.salon_appointment_resources (
    appointment_id,
    resource_id,
    studio_id,
    location_id,
    occupied_from,
    occupied_until,
    is_active,
    released_at
  )
  select
    v_appointment.id,
    rv.resource_id,
    p_studio_id,
    p_location_id,
    v_occupied_from,
    v_occupied_until,
    true,
    null
  from public.assert_resources_valid_for_appointment(p_studio_id, p_location_id, p_service_id, p_resource_ids) rv;

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
    v_appointment.id,
    p_studio_id,
    null,
    'pending',
    'user',
    p_actor_id,
    p_actor_role,
    'created'
  );

  if p_terms_version_id is not null then
    if p_terms_accepted_at is null then
      raise exception 'terms_accepted_at is required when terms_version_id is provided' using errcode = '23514';
    end if;
    if p_terms_acceptance_channel is null or btrim(p_terms_acceptance_channel) = '' then
      raise exception 'terms_acceptance_channel is required when terms_version_id is provided' using errcode = '23514';
    end if;
    if p_terms_acceptance_method is null or btrim(p_terms_acceptance_method) = '' then
      raise exception 'terms_acceptance_method is required when terms_version_id is provided' using errcode = '23514';
    end if;

    select id, studio_id, version_label, content_hash
    into v_terms
    from public.salon_terms_versions
    where id = p_terms_version_id
    for update;

    if not found or v_terms.studio_id <> p_studio_id then
      raise exception 'terms version % not found in studio %', p_terms_version_id, p_studio_id using errcode = '23514';
    end if;

    insert into public.salon_terms_acceptances (
      studio_id,
      terms_version_id,
      appointment_id,
      salon_customer_id,
      accepted_at,
      acceptance_channel,
      acceptance_method,
      recorded_by,
      content_hash_snapshot,
      version_label_snapshot
    )
    values (
      p_studio_id,
      p_terms_version_id,
      v_appointment.id,
      p_salon_customer_id,
      p_terms_accepted_at,
      btrim(p_terms_acceptance_channel),
      btrim(p_terms_acceptance_method),
      coalesce(p_terms_recorded_by, p_actor_id),
      v_terms.content_hash,
      v_terms.version_label
    );
  end if;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_created',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := p_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_appointment.id,
    p_before_state := null,
    p_after_state := to_jsonb(v_appointment),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_appointment.id,
    'status', v_appointment.status,
    'starts_at', v_appointment.starts_at,
    'ends_at', v_appointment.ends_at,
    'occupied_from', v_appointment.occupied_from,
    'occupied_until', v_appointment.occupied_until,
    'expires_at', v_appointment.expires_at
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


-- ── RPC: reschedule_salon_appointment ────────────────────────────────────
create or replace function public.reschedule_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_new_resource_ids uuid[] default null,
  p_reason text default null,
  p_new_location_id uuid default null,
  p_new_service_id uuid default null,
  p_new_employee_id uuid default null,
  p_new_expires_at timestamptz default null,
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
  v_target_location_id uuid;
  v_target_service_id uuid;
  v_target_employee_id uuid;
  v_timing record;
  v_employee_name text;
  v_new_ends_at timestamptz;
  v_new_occupied_from timestamptz;
  v_new_occupied_until timestamptz;
  v_new_expires_at timestamptz;
  v_reason text;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
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
      p_operation_scope := 'salon_appointment:reschedule'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  if p_new_starts_at is null then
    raise exception 'new starts_at is required' using errcode = '23514';
  end if;

  select * into v_before
  from public.salon_appointments
  where id = p_appointment_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_before.status not in ('pending', 'confirmed') then
    raise exception 'only pending/confirmed appointment can be rescheduled, current=%', v_before.status using errcode = '23514';
  end if;

  v_target_location_id := coalesce(p_new_location_id, v_before.location_id);
  v_target_service_id := coalesce(p_new_service_id, v_before.service_id);
  v_target_employee_id := coalesce(p_new_employee_id, v_before.employee_id);

  select * into v_timing
  from public.get_effective_service_timing_for_appointment(p_studio_id, v_target_service_id, v_target_location_id);

  v_new_ends_at := p_new_starts_at + make_interval(mins => v_timing.duration_minutes);
  v_new_occupied_from := p_new_starts_at - make_interval(mins => v_timing.prep_minutes);
  v_new_occupied_until := v_new_ends_at + make_interval(mins => v_timing.buffer_minutes);
  v_new_expires_at := case
    when v_before.status = 'pending' then coalesce(p_new_expires_at, v_before.expires_at, now() + interval '15 minutes')
    else null
  end;
  v_reason := coalesce(nullif(btrim(p_reason), ''), 'rescheduled');

  perform public.assert_employee_available_for_appointment(
    p_studio_id,
    v_target_location_id,
    v_target_service_id,
    v_target_employee_id,
    v_new_occupied_from,
    v_new_occupied_until
  );

  perform * from public.assert_resources_valid_for_appointment(
    p_studio_id,
    v_target_location_id,
    v_target_service_id,
    p_new_resource_ids
  );

  select display_name into v_employee_name
  from public.employees
  where id = v_target_employee_id and studio_id = p_studio_id
  for update;

  if v_employee_name is null then
    raise exception 'employee % not found in studio %', v_target_employee_id, p_studio_id using errcode = 'P0002';
  end if;

  update public.salon_appointments
  set
    location_id = v_target_location_id,
    service_id = v_target_service_id,
    employee_id = v_target_employee_id,
    starts_at = p_new_starts_at,
    ends_at = v_new_ends_at,
    occupied_from = v_new_occupied_from,
    occupied_until = v_new_occupied_until,
    expires_at = v_new_expires_at,
    service_title_snapshot = v_timing.service_title,
    service_price_snapshot = v_timing.service_price,
    service_currency_snapshot = v_timing.service_currency,
    service_duration_snapshot_minutes = v_timing.duration_minutes,
    prep_snapshot_minutes = v_timing.prep_minutes,
    buffer_snapshot_minutes = v_timing.buffer_minutes,
    employee_name_snapshot = v_employee_name,
    location_name_snapshot = v_timing.location_name,
    updated_by = p_actor_id
  where id = v_before.id
  returning * into v_after;

  update public.salon_appointment_resources
  set is_active = false,
      released_at = now()
  where appointment_id = v_before.id
    and is_active;

  insert into public.salon_appointment_resources (
    appointment_id,
    resource_id,
    studio_id,
    location_id,
    occupied_from,
    occupied_until,
    is_active,
    released_at
  )
  select
    v_before.id,
    rv.resource_id,
    p_studio_id,
    v_target_location_id,
    v_new_occupied_from,
    v_new_occupied_until,
    true,
    null
  from public.assert_resources_valid_for_appointment(p_studio_id, v_target_location_id, v_target_service_id, p_new_resource_ids) rv;

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
    v_after.status,
    'user',
    p_actor_id,
    p_actor_role,
    v_reason
  );

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_rescheduled',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_target_location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_before.id,
    p_before_state := to_jsonb(v_before),
    p_after_state := jsonb_build_object(
      'appointment', to_jsonb(v_after),
      'reschedule_reason', v_reason,
      'previous_starts_at', v_before.starts_at,
      'new_starts_at', v_after.starts_at
    ),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_after.id,
    'status', v_after.status,
    'starts_at', v_after.starts_at,
    'ends_at', v_after.ends_at,
    'occupied_from', v_after.occupied_from,
    'occupied_until', v_after.occupied_until,
    'reason', v_reason
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


-- ── RPC: cancel_salon_appointment ────────────────────────────────────────
create or replace function public.cancel_salon_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_reason text,
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
  v_reason text;
  v_idempotency_enabled boolean := false;
  v_result jsonb;
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
      p_operation_scope := 'salon_appointment:cancel'
    );
  end if;

  perform public.assert_salon_appointment_actor_role(p_actor_role);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then
    raise exception 'cancellation reason is required' using errcode = '23514';
  end if;

  select * into v_before
  from public.salon_appointments
  where id = p_appointment_id and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_before.status = 'cancelled' then
    v_result := jsonb_build_object(
      'ok', true,
      'appointment_id', v_before.id,
      'already_cancelled', true,
      'status', v_before.status
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

  if v_before.status in ('completed', 'no_show') then
    raise exception 'appointment status % cannot be cancelled', v_before.status using errcode = '23514';
  end if;

  update public.salon_appointments
  set status = 'cancelled',
      cancellation_reason = v_reason,
      cancellation_actor_id = p_actor_id,
      cancellation_actor_role = p_actor_role,
      cancelled_at = now(),
      expires_at = null,
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
    'cancelled',
    'user',
    p_actor_id,
    p_actor_role,
    v_reason
  );

  update public.salon_appointment_resources
  set is_active = false,
      released_at = now()
  where appointment_id = v_before.id
    and is_active;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_appointment_cancelled',
    p_target_type := 'salon_appointment',
    p_actor_type := 'user',
    p_location_id := v_before.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_before.id,
    p_before_state := to_jsonb(v_before),
    p_after_state := to_jsonb(v_after),
    p_idempotency_key_id := p_idempotency_key_id
  );

  v_result := jsonb_build_object(
    'ok', true,
    'appointment_id', v_after.id,
    'status', v_after.status,
    'already_cancelled', false,
    'cancelled_at', v_after.cancelled_at
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


-- ── RPC: expire_pending_salon_appointments ───────────────────────────────
create or replace function public.expire_pending_salon_appointments(
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_appointments%rowtype;
  v_count integer := 0;
  v_after public.salon_appointments%rowtype;
  v_batch_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
begin
  for v_row in
    select *
    from public.salon_appointments
    where status = 'pending'
      and expires_at is not null
      and expires_at < now()
    order by expires_at asc
    for update skip locked
    limit v_batch_limit
  loop
    update public.salon_appointments
    set status = 'cancelled',
        cancellation_reason = 'pending_expired',
        cancellation_actor_id = null,
        cancellation_actor_role = 'system',
        cancelled_at = now(),
        expires_at = null,
        updated_by = null
    where id = v_row.id
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
      v_row.id,
      v_row.studio_id,
      'pending',
      'cancelled',
      'system',
      null,
      'system',
      'pending_expired'
    );

    update public.salon_appointment_resources
    set is_active = false,
        released_at = now()
    where appointment_id = v_row.id
      and is_active;

    perform public.record_strong_audit(
      p_studio_id := v_row.studio_id,
      p_action := 'salon_appointment_expired',
      p_target_type := 'salon_appointment',
      p_actor_type := 'system',
      p_location_id := v_row.location_id,
      p_target_id := v_row.id,
      p_before_state := to_jsonb(v_row),
      p_after_state := to_jsonb(v_after)
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ── RPC: get_salon_appointment_by_id ─────────────────────────────────────
create or replace function public.get_salon_appointment_by_id(
  p_studio_id uuid,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_appointments%rowtype;
begin
  select * into v_row
  from public.salon_appointments
  where id = p_appointment_id
    and studio_id = p_studio_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'appointment', to_jsonb(v_row));
end;
$$;


-- ── RLS / grants ─────────────────────────────────────────────────────────
alter table public.salon_appointments enable row level security;
alter table public.salon_appointment_status_history enable row level security;
alter table public.salon_appointment_resources enable row level security;
alter table public.salon_terms_versions enable row level security;
alter table public.salon_terms_acceptances enable row level security;

revoke all on table public.salon_appointments from public, anon, authenticated;
revoke all on table public.salon_appointment_status_history from public, anon, authenticated;
revoke all on table public.salon_appointment_resources from public, anon, authenticated;
revoke all on table public.salon_terms_versions from public, anon, authenticated;
revoke all on table public.salon_terms_acceptances from public, anon, authenticated;

grant all on table public.salon_appointments to service_role;
grant select, insert on table public.salon_appointment_status_history to service_role;
grant all on table public.salon_appointment_resources to service_role;
grant all on table public.salon_terms_versions to service_role;
grant select, insert on table public.salon_terms_acceptances to service_role;

revoke all on function public.assert_business_idempotency_claim_for_appointment(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_business_idempotency_key_for_appointment(uuid, uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.assert_business_idempotency_claim_for_appointment(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.complete_business_idempotency_key_for_appointment(uuid, uuid, jsonb)
  to service_role;

revoke all on function public.create_salon_appointment(uuid, text, uuid, uuid, uuid, uuid, uuid, timestamptz, uuid[], uuid, timestamptz, text, text, uuid, timestamptz, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reschedule_salon_appointment(uuid, text, uuid, uuid, timestamptz, uuid[], text, uuid, uuid, uuid, timestamptz, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.cancel_salon_appointment(uuid, text, uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.expire_pending_salon_appointments(integer)
  from public, anon, authenticated;
revoke all on function public.get_salon_appointment_by_id(uuid, uuid)
  from public, anon, authenticated;

grant all on function public.create_salon_appointment(uuid, text, uuid, uuid, uuid, uuid, uuid, timestamptz, uuid[], uuid, timestamptz, text, text, uuid, timestamptz, text, uuid, uuid)
  to service_role;
grant all on function public.reschedule_salon_appointment(uuid, text, uuid, uuid, timestamptz, uuid[], text, uuid, uuid, uuid, timestamptz, uuid, uuid)
  to service_role;
grant all on function public.cancel_salon_appointment(uuid, text, uuid, uuid, text, uuid, uuid)
  to service_role;
grant all on function public.expire_pending_salon_appointments(integer)
  to service_role;
grant all on function public.get_salon_appointment_by_id(uuid, uuid)
  to service_role;
