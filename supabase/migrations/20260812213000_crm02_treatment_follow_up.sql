-- CRM-02: Treatment + Follow-up foundation.
-- Scope:
--   * Completed-appointment sourced Treatment records (studio scoped)
--   * Append-only Treatment revisions (sensitive body stored here, never in audits)
--   * Follow-up records + append-only follow-up history
--   * SECURITY DEFINER RPCs with FND-04 claim-token/idempotency fencing
-- Out of scope:
--   * commission / payroll entries
--   * replacing CRM-01 sensitive profile behavior

create unique index if not exists salon_appointments_studio_id_id_unique
  on public.salon_appointments (studio_id, id);

create unique index if not exists employees_studio_id_id_unique
  on public.employees (studio_id, id);

create or replace function public.crm02_assert_customer_in_studio(
  p_studio_id uuid,
  p_salon_customer_id uuid
)
returns public.salon_customers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer public.salon_customers;
begin
  select *
  into v_customer
  from public.salon_customers c
  where c.id = p_salon_customer_id
    and c.studio_id = p_studio_id
    and c.merged_into_id is null;

  if not found then
    raise exception 'customer % does not belong to studio %', p_salon_customer_id, p_studio_id
      using errcode = '23514';
  end if;

  return v_customer;
end;
$$;

create or replace function public.crm02_assert_location_in_studio(
  p_studio_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_location_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.locations l
    where l.id = p_location_id
      and l.studio_id = p_studio_id
  ) then
    raise exception 'location % does not belong to studio %', p_location_id, p_studio_id
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.crm02_assert_actor_base_scope(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid,
  p_actor_employee_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_owner boolean := false;
  v_has_global_role boolean := false;
  v_has_location_role boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  perform public.crm02_assert_location_in_studio(p_studio_id, p_location_id);

  if p_actor_role = 'owner' then
    select exists (
      select 1
      from public.studios s
      where s.id = p_studio_id
        and s.owner_id = p_actor_id
    ) into v_is_owner;

    if not v_is_owner then
      raise exception 'actor % is not owner for studio %', p_actor_id, p_studio_id using errcode = '42501';
    end if;

    return;
  end if;

  if p_actor_role not in ('manager', 'frontdesk', 'instructor') then
    raise exception 'invalid actor role %', p_actor_role using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.is_active = true
      and sm.location_id is null
      and sm.role = p_actor_role
  ) into v_has_global_role;

  if v_has_global_role then
    if p_actor_role = 'instructor' then
      if p_actor_employee_id is null then
        raise exception 'instructor actor_employee_id is required' using errcode = '42501';
      end if;
      if not exists (
        select 1
        from public.employees e
        where e.id = p_actor_employee_id
          and e.studio_id = p_studio_id
          and e.user_id = p_actor_id
          and e.employment_status = 'active'
      ) then
        raise exception 'instructor employee % is not active for actor %', p_actor_employee_id, p_actor_id
          using errcode = '42501';
      end if;
    end if;
    return;
  end if;

  if p_location_id is null then
    raise exception 'actor % has no global scope for role %', p_actor_id, p_actor_role using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.location_id = p_location_id
      and sm.is_active = true
      and sm.role = p_actor_role
  ) into v_has_location_role;

  if not v_has_location_role then
    raise exception 'actor % has no location scope % at %', p_actor_id, p_actor_role, p_location_id using errcode = '42501';
  end if;

  if p_actor_role = 'instructor' then
    if p_actor_employee_id is null then
      raise exception 'instructor actor_employee_id is required' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.employees e
      join public.employee_locations el
        on el.employee_id = e.id
       and el.location_id = p_location_id
       and el.studio_id = p_studio_id
       and el.is_active = true
      where e.id = p_actor_employee_id
        and e.studio_id = p_studio_id
        and e.user_id = p_actor_id
        and e.employment_status = 'active'
    ) then
      raise exception 'instructor employee % is not active in location %', p_actor_employee_id, p_location_id using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function public.crm02_assert_employee_in_location(
  p_studio_id uuid,
  p_location_id uuid,
  p_employee_id uuid
)
returns public.employees
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_employee public.employees;
begin
  select *
  into v_employee
  from public.employees e
  where e.id = p_employee_id
    and e.studio_id = p_studio_id
    and e.employment_status = 'active';

  if not found then
    raise exception 'employee % is not active in studio %', p_employee_id, p_studio_id using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.employee_locations el
    where el.employee_id = p_employee_id
      and el.location_id = p_location_id
      and el.studio_id = p_studio_id
      and el.is_active = true
  ) then
    raise exception 'employee % is not active in location %', p_employee_id, p_location_id using errcode = '23514';
  end if;

  return v_employee;
end;
$$;

create table if not exists public.salon_treatments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  appointment_id uuid not null references public.salon_appointments(id) on delete restrict,
  service_id uuid not null references public.studio_services(id) on delete restrict,
  actual_employee_id uuid not null references public.employees(id) on delete restrict,
  service_title_snapshot text not null,
  service_duration_snapshot_minutes integer not null check (service_duration_snapshot_minutes > 0),
  service_price_snapshot numeric(12,2) not null,
  service_currency_snapshot text not null,
  actual_employee_name_snapshot text not null,
  lifecycle_status text not null default 'open' check (lifecycle_status = any (array['open'::text, 'completed'::text, 'archived'::text])),
  latest_revision_no integer not null default 0 check (latest_revision_no >= 0),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  create_idempotency_key_id uuid references public.business_idempotency_keys(id) on delete set null,
  create_idempotency_claim_token uuid,
  unique (studio_id, appointment_id)
);

create unique index if not exists salon_treatments_create_idempotency_unique
  on public.salon_treatments (create_idempotency_key_id)
  where create_idempotency_key_id is not null;

create index if not exists idx_salon_treatments_studio_customer_created
  on public.salon_treatments (studio_id, salon_customer_id, created_at desc);

create index if not exists idx_salon_treatments_studio_location_created
  on public.salon_treatments (studio_id, location_id, created_at desc);

create index if not exists idx_salon_treatments_studio_employee_created
  on public.salon_treatments (studio_id, actual_employee_id, created_at desc);

create or replace function public.salon_treatments_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer public.salon_customers;
  v_appointment public.salon_appointments;
  v_service public.studio_services;
  v_employee public.employees;
begin
  v_customer := public.crm02_assert_customer_in_studio(new.studio_id, new.salon_customer_id);
  perform public.crm02_assert_location_in_studio(new.studio_id, new.location_id);

  select *
  into v_appointment
  from public.salon_appointments a
  where a.id = new.appointment_id
    and a.studio_id = new.studio_id;

  if not found then
    raise exception 'appointment % does not belong to studio %', new.appointment_id, new.studio_id
      using errcode = '23514';
  end if;

  if v_appointment.status <> 'completed' then
    raise exception 'appointment % is not completed', new.appointment_id using errcode = '23514';
  end if;

  if v_appointment.salon_customer_id <> new.salon_customer_id then
    raise exception 'treatment customer does not match appointment customer' using errcode = '23514';
  end if;

  if v_appointment.location_id <> new.location_id then
    raise exception 'treatment location does not match appointment location' using errcode = '23514';
  end if;

  if v_appointment.service_id <> new.service_id then
    raise exception 'treatment service does not match appointment service' using errcode = '23514';
  end if;

  select * into v_service
  from public.studio_services s
  where s.id = new.service_id
    and s.studio_id = new.studio_id;

  if not found then
    raise exception 'service % does not belong to studio %', new.service_id, new.studio_id
      using errcode = '23514';
  end if;

  v_employee := public.crm02_assert_employee_in_location(new.studio_id, new.location_id, new.actual_employee_id);

  return new;
end;
$$;

drop trigger if exists salon_treatments_validate_refs_trg on public.salon_treatments;
create trigger salon_treatments_validate_refs_trg
  before insert or update of studio_id, location_id, salon_customer_id, appointment_id, service_id, actual_employee_id
  on public.salon_treatments
  for each row execute function public.salon_treatments_validate_refs();

drop trigger if exists set_salon_treatments_updated_at on public.salon_treatments;
create trigger set_salon_treatments_updated_at
  before update on public.salon_treatments
  for each row execute function public.set_updated_at_timestamp();

create table if not exists public.salon_treatment_revisions (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.salon_treatments(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  lifecycle_status text not null check (lifecycle_status = any (array['open'::text, 'completed'::text, 'archived'::text])),
  revision_reason text,
  note_summary text,
  sensitive_note_body text,
  created_by uuid references public.users(id) on delete set null,
  created_role text,
  created_at timestamptz not null default now(),
  idempotency_key_id uuid references public.business_idempotency_keys(id) on delete set null,
  idempotency_claim_token uuid,
  unique (treatment_id, revision_no)
);

create unique index if not exists salon_treatment_revisions_idempotency_unique
  on public.salon_treatment_revisions (idempotency_key_id)
  where idempotency_key_id is not null;

create index if not exists idx_salon_treatment_revisions_treatment_created
  on public.salon_treatment_revisions (treatment_id, created_at desc);

create or replace function public.salon_treatment_revisions_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_treatment public.salon_treatments;
begin
  select *
  into v_treatment
  from public.salon_treatments t
  where t.id = new.treatment_id;

  if not found then
    raise exception 'treatment % not found', new.treatment_id using errcode = 'P0002';
  end if;

  if v_treatment.studio_id <> new.studio_id then
    raise exception 'revision studio_id must match treatment studio_id' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists salon_treatment_revisions_validate_refs_trg on public.salon_treatment_revisions;
create trigger salon_treatment_revisions_validate_refs_trg
  before insert on public.salon_treatment_revisions
  for each row execute function public.salon_treatment_revisions_validate_refs();

drop trigger if exists salon_treatment_revisions_append_only_upd on public.salon_treatment_revisions;
create trigger salon_treatment_revisions_append_only_upd
  before update on public.salon_treatment_revisions
  for each row execute function public.raise_append_only_violation();

drop trigger if exists salon_treatment_revisions_append_only_del on public.salon_treatment_revisions;
create trigger salon_treatment_revisions_append_only_del
  before delete on public.salon_treatment_revisions
  for each row execute function public.raise_append_only_violation();

create table if not exists public.salon_treatment_follow_ups (
  id uuid primary key default gen_random_uuid(),
  treatment_id uuid not null references public.salon_treatments(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  due_on date not null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  owner_name_snapshot text,
  status text not null default 'pending' check (status = any (array['pending'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])),
  note_summary text,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_salon_treatment_follow_ups_queue
  on public.salon_treatment_follow_ups (studio_id, status, due_on, location_id);

create index if not exists idx_salon_treatment_follow_ups_customer
  on public.salon_treatment_follow_ups (studio_id, salon_customer_id, due_on);

create index if not exists idx_salon_treatment_follow_ups_owner
  on public.salon_treatment_follow_ups (studio_id, owner_employee_id, due_on)
  where owner_employee_id is not null;

create or replace function public.salon_treatment_follow_ups_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_treatment public.salon_treatments;
  v_employee public.employees;
begin
  select *
  into v_treatment
  from public.salon_treatments t
  where t.id = new.treatment_id;

  if not found then
    raise exception 'treatment % not found', new.treatment_id using errcode = 'P0002';
  end if;

  if v_treatment.studio_id <> new.studio_id
     or v_treatment.location_id <> new.location_id
     or v_treatment.salon_customer_id <> new.salon_customer_id then
    raise exception 'follow-up scope must match treatment scope' using errcode = '23514';
  end if;

  if new.owner_employee_id is not null then
    v_employee := public.crm02_assert_employee_in_location(new.studio_id, new.location_id, new.owner_employee_id);
    new.owner_name_snapshot := v_employee.display_name;
  else
    new.owner_name_snapshot := null;
  end if;

  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' and new.completed_at is not null then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists salon_treatment_follow_ups_validate_refs_trg on public.salon_treatment_follow_ups;
create trigger salon_treatment_follow_ups_validate_refs_trg
  before insert or update of treatment_id, studio_id, location_id, salon_customer_id, owner_employee_id, status, completed_at
  on public.salon_treatment_follow_ups
  for each row execute function public.salon_treatment_follow_ups_validate_refs();

drop trigger if exists set_salon_treatment_follow_ups_updated_at on public.salon_treatment_follow_ups;
create trigger set_salon_treatment_follow_ups_updated_at
  before update on public.salon_treatment_follow_ups
  for each row execute function public.set_updated_at_timestamp();

create table if not exists public.salon_treatment_follow_up_history (
  id uuid primary key default gen_random_uuid(),
  follow_up_id uuid not null references public.salon_treatment_follow_ups(id) on delete restrict,
  studio_id uuid not null references public.studios(id) on delete restrict,
  from_status text,
  to_status text not null check (to_status = any (array['pending'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])),
  due_on date not null,
  owner_employee_id uuid references public.employees(id) on delete set null,
  note_summary text,
  actor_id uuid references public.users(id) on delete set null,
  actor_role text,
  changed_at timestamptz not null default now(),
  idempotency_key_id uuid references public.business_idempotency_keys(id) on delete set null,
  idempotency_claim_token uuid
);

create unique index if not exists salon_treatment_follow_up_history_idempotency_unique
  on public.salon_treatment_follow_up_history (idempotency_key_id)
  where idempotency_key_id is not null;

create index if not exists idx_salon_treatment_follow_up_history_follow_up_changed
  on public.salon_treatment_follow_up_history (follow_up_id, changed_at desc);

create or replace function public.salon_treatment_follow_up_history_validate_refs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_follow_up public.salon_treatment_follow_ups;
begin
  select *
  into v_follow_up
  from public.salon_treatment_follow_ups f
  where f.id = new.follow_up_id;

  if not found then
    raise exception 'follow-up % not found', new.follow_up_id using errcode = 'P0002';
  end if;

  if v_follow_up.studio_id <> new.studio_id then
    raise exception 'follow-up history studio mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists salon_treatment_follow_up_history_validate_refs_trg on public.salon_treatment_follow_up_history;
create trigger salon_treatment_follow_up_history_validate_refs_trg
  before insert on public.salon_treatment_follow_up_history
  for each row execute function public.salon_treatment_follow_up_history_validate_refs();

drop trigger if exists salon_treatment_follow_up_history_append_only_upd on public.salon_treatment_follow_up_history;
create trigger salon_treatment_follow_up_history_append_only_upd
  before update on public.salon_treatment_follow_up_history
  for each row execute function public.raise_append_only_violation();

drop trigger if exists salon_treatment_follow_up_history_append_only_del on public.salon_treatment_follow_up_history;
create trigger salon_treatment_follow_up_history_append_only_del
  before delete on public.salon_treatment_follow_up_history
  for each row execute function public.raise_append_only_violation();

create or replace function public.crm02_assert_current_claim(
  p_studio_id uuid,
  p_operation_scope text,
  p_idempotency_key_id uuid,
  p_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_idempotency_key_id is null or p_claim_token is null then
    raise exception 'idempotency key id and claim token are required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.business_idempotency_keys k
    where k.id = p_idempotency_key_id
      and k.studio_id = p_studio_id
      and k.operation_scope = p_operation_scope
      and k.status = 'processing'
      and k.claim_token = p_claim_token
  ) then
    raise exception 'idempotency claim token is not current for %', p_operation_scope using errcode = '23514';
  end if;
end;
$$;

create or replace function public.crm02_create_or_link_treatment_from_appointment(
  p_actor_id uuid,
  p_actor_role text,
  p_actor_employee_id uuid,
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actual_employee_id uuid default null,
  p_lifecycle_status text default 'open',
  p_revision_reason text default null,
  p_note_summary text default null,
  p_sensitive_note_body text default null,
  p_follow_up_due_on date default null,
  p_follow_up_owner_employee_id uuid default null,
  p_follow_up_note_summary text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_treatment public.salon_treatments;
  v_treatment public.salon_treatments;
  v_appointment public.salon_appointments;
  v_employee public.employees;
  v_revision public.salon_treatment_revisions;
  v_follow_up public.salon_treatment_follow_ups;
  v_complete jsonb;
  v_result jsonb;
begin
  perform public.crm02_assert_current_claim(
    p_studio_id,
    'salon_treatment:create_from_appointment',
    p_idempotency_key_id,
    p_idempotency_claim_token
  );

  select *
  into v_existing_treatment
  from public.salon_treatments
  where create_idempotency_key_id = p_idempotency_key_id
  limit 1;

  if found then
    v_result := jsonb_build_object(
      'treatmentId', v_existing_treatment.id,
      'alreadyLinked', false,
      'followUpId', null
    );

    v_complete := public.complete_business_idempotency_key(
      p_idempotency_key_id,
      p_idempotency_claim_token,
      v_result
    );
    if coalesce((v_complete->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for salon_treatment:create_from_appointment'
        using errcode = '23514';
    end if;

    return jsonb_build_object('ok', true) || v_result;
  end if;

  select *
  into v_appointment
  from public.salon_appointments a
  where a.id = p_appointment_id
    and a.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'appointment % not found in studio %', p_appointment_id, p_studio_id using errcode = 'P0002';
  end if;

  if v_appointment.status <> 'completed' then
    raise exception 'appointment % must be completed before treatment can be created', p_appointment_id using errcode = '23514';
  end if;

  perform public.crm02_assert_actor_base_scope(
    p_studio_id,
    p_actor_id,
    p_actor_role,
    v_appointment.location_id,
    p_actor_employee_id
  );

  if p_actor_role = 'instructor' and p_actor_employee_id is distinct from v_appointment.employee_id then
    raise exception 'instructor can only create treatment for own serviced appointment' using errcode = '42501';
  end if;

  select *
  into v_existing_treatment
  from public.salon_treatments t
  where t.studio_id = p_studio_id
    and t.appointment_id = p_appointment_id
  for update;

  if found then
    if p_actor_role = 'instructor' and p_actor_employee_id is distinct from v_existing_treatment.actual_employee_id then
      raise exception 'instructor can only link own treatment by actual employee relationship' using errcode = '42501';
    end if;

    v_result := jsonb_build_object(
      'treatmentId', v_existing_treatment.id,
      'alreadyLinked', true,
      'followUpId', null
    );

    v_complete := public.complete_business_idempotency_key(
      p_idempotency_key_id,
      p_idempotency_claim_token,
      v_result
    );
    if coalesce((v_complete->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for salon_treatment:create_from_appointment'
        using errcode = '23514';
    end if;

    return jsonb_build_object('ok', true) || v_result;
  end if;

  if p_lifecycle_status not in ('open', 'completed', 'archived') then
    raise exception 'invalid lifecycle_status %', p_lifecycle_status using errcode = '22023';
  end if;

  v_employee := public.crm02_assert_employee_in_location(
    p_studio_id,
    v_appointment.location_id,
    coalesce(p_actual_employee_id, v_appointment.employee_id)
  );

  if p_actor_role = 'instructor' and p_actor_employee_id is distinct from v_employee.id then
    raise exception 'instructor cannot assign treatment to another employee' using errcode = '42501';
  end if;

  insert into public.salon_treatments (
    studio_id,
    location_id,
    salon_customer_id,
    appointment_id,
    service_id,
    actual_employee_id,
    service_title_snapshot,
    service_duration_snapshot_minutes,
    service_price_snapshot,
    service_currency_snapshot,
    actual_employee_name_snapshot,
    lifecycle_status,
    latest_revision_no,
    created_by,
    updated_by,
    create_idempotency_key_id,
    create_idempotency_claim_token
  ) values (
    p_studio_id,
    v_appointment.location_id,
    v_appointment.salon_customer_id,
    v_appointment.id,
    v_appointment.service_id,
    v_employee.id,
    v_appointment.service_title_snapshot,
    v_appointment.service_duration_snapshot_minutes,
    v_appointment.service_price_snapshot,
    v_appointment.service_currency_snapshot,
    v_employee.display_name,
    p_lifecycle_status,
    1,
    p_actor_id,
    p_actor_id,
    p_idempotency_key_id,
    p_idempotency_claim_token
  )
  returning * into v_treatment;

  insert into public.salon_treatment_revisions (
    treatment_id,
    studio_id,
    revision_no,
    lifecycle_status,
    revision_reason,
    note_summary,
    sensitive_note_body,
    created_by,
    created_role,
    idempotency_key_id,
    idempotency_claim_token
  ) values (
    v_treatment.id,
    p_studio_id,
    1,
    p_lifecycle_status,
    p_revision_reason,
    p_note_summary,
    p_sensitive_note_body,
    p_actor_id,
    p_actor_role,
    p_idempotency_key_id,
    p_idempotency_claim_token
  )
  returning * into v_revision;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_treatment_created',
    p_target_type := 'salon_treatments',
    p_actor_type := 'user',
    p_location_id := v_treatment.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_treatment.id,
    p_before_state := null,
    p_after_state := jsonb_build_object(
      'appointmentId', v_treatment.appointment_id,
      'customerId', v_treatment.salon_customer_id,
      'serviceId', v_treatment.service_id,
      'actualEmployeeId', v_treatment.actual_employee_id,
      'lifecycleStatus', v_treatment.lifecycle_status,
      'revisionNo', v_revision.revision_no,
      'hasSensitiveNoteBody', (p_sensitive_note_body is not null and btrim(p_sensitive_note_body) <> '')
    ),
    p_correlation_id := null,
    p_idempotency_key_id := p_idempotency_key_id,
    p_provider_event_id := null
  );

  if p_follow_up_due_on is not null then
    insert into public.salon_treatment_follow_ups (
      treatment_id,
      studio_id,
      location_id,
      salon_customer_id,
      due_on,
      owner_employee_id,
      status,
      note_summary,
      created_by,
      updated_by
    ) values (
      v_treatment.id,
      v_treatment.studio_id,
      v_treatment.location_id,
      v_treatment.salon_customer_id,
      p_follow_up_due_on,
      p_follow_up_owner_employee_id,
      'pending',
      p_follow_up_note_summary,
      p_actor_id,
      p_actor_id
    )
    returning * into v_follow_up;

    insert into public.salon_treatment_follow_up_history (
      follow_up_id,
      studio_id,
      from_status,
      to_status,
      due_on,
      owner_employee_id,
      note_summary,
      actor_id,
      actor_role,
      idempotency_key_id,
      idempotency_claim_token
    ) values (
      v_follow_up.id,
      p_studio_id,
      null,
      v_follow_up.status,
      v_follow_up.due_on,
      v_follow_up.owner_employee_id,
      v_follow_up.note_summary,
      p_actor_id,
      p_actor_role,
      null,
      null
    );

    perform public.record_strong_audit(
      p_studio_id := p_studio_id,
      p_action := 'salon_treatment_follow_up_created',
      p_target_type := 'salon_treatment_follow_ups',
      p_actor_type := 'user',
      p_location_id := v_treatment.location_id,
      p_actor_id := p_actor_id,
      p_actor_role := p_actor_role,
      p_target_id := v_follow_up.id,
      p_before_state := null,
      p_after_state := jsonb_build_object(
        'treatmentId', v_treatment.id,
        'dueOn', v_follow_up.due_on,
        'status', v_follow_up.status,
        'ownerEmployeeId', v_follow_up.owner_employee_id
      ),
      p_correlation_id := null,
      p_idempotency_key_id := p_idempotency_key_id,
      p_provider_event_id := null
    );
  end if;

  v_result := jsonb_build_object(
    'treatmentId', v_treatment.id,
    'alreadyLinked', false,
    'followUpId', coalesce(v_follow_up.id, null)
  );

  v_complete := public.complete_business_idempotency_key(
    p_idempotency_key_id,
    p_idempotency_claim_token,
    v_result
  );

  if coalesce((v_complete->>'ok')::boolean, false) is false then
    raise exception 'idempotency claim token is not current for salon_treatment:create_from_appointment'
      using errcode = '23514';
  end if;

  return jsonb_build_object('ok', true) || v_result;
end;
$$;

create or replace function public.crm02_revise_treatment(
  p_actor_id uuid,
  p_actor_role text,
  p_actor_employee_id uuid,
  p_studio_id uuid,
  p_treatment_id uuid,
  p_lifecycle_status text,
  p_revision_reason text default null,
  p_note_summary text default null,
  p_sensitive_note_body text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_treatment public.salon_treatments;
  v_existing_rev public.salon_treatment_revisions;
  v_revision_no integer;
  v_revision public.salon_treatment_revisions;
  v_complete jsonb;
  v_result jsonb;
begin
  perform public.crm02_assert_current_claim(
    p_studio_id,
    'salon_treatment:revise',
    p_idempotency_key_id,
    p_idempotency_claim_token
  );

  select *
  into v_existing_rev
  from public.salon_treatment_revisions r
  where r.idempotency_key_id = p_idempotency_key_id
  limit 1;

  if found then
    v_result := jsonb_build_object(
      'treatmentId', v_existing_rev.treatment_id,
      'revisionId', v_existing_rev.id,
      'revisionNo', v_existing_rev.revision_no,
      'lifecycleStatus', v_existing_rev.lifecycle_status
    );

    v_complete := public.complete_business_idempotency_key(
      p_idempotency_key_id,
      p_idempotency_claim_token,
      v_result
    );
    if coalesce((v_complete->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for salon_treatment:revise'
        using errcode = '23514';
    end if;

    return jsonb_build_object('ok', true) || v_result;
  end if;

  select *
  into v_treatment
  from public.salon_treatments t
  where t.id = p_treatment_id
    and t.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'treatment % not found in studio %', p_treatment_id, p_studio_id using errcode = 'P0002';
  end if;

  perform public.crm02_assert_actor_base_scope(
    p_studio_id,
    p_actor_id,
    p_actor_role,
    v_treatment.location_id,
    p_actor_employee_id
  );

  if p_actor_role = 'instructor' and p_actor_employee_id is distinct from v_treatment.actual_employee_id then
    raise exception 'instructor can only revise own treatment' using errcode = '42501';
  end if;

  if p_lifecycle_status not in ('open', 'completed', 'archived') then
    raise exception 'invalid lifecycle_status %', p_lifecycle_status using errcode = '22023';
  end if;

  v_revision_no := v_treatment.latest_revision_no + 1;

  insert into public.salon_treatment_revisions (
    treatment_id,
    studio_id,
    revision_no,
    lifecycle_status,
    revision_reason,
    note_summary,
    sensitive_note_body,
    created_by,
    created_role,
    idempotency_key_id,
    idempotency_claim_token
  ) values (
    v_treatment.id,
    p_studio_id,
    v_revision_no,
    p_lifecycle_status,
    p_revision_reason,
    p_note_summary,
    p_sensitive_note_body,
    p_actor_id,
    p_actor_role,
    p_idempotency_key_id,
    p_idempotency_claim_token
  )
  returning * into v_revision;

  update public.salon_treatments
  set lifecycle_status = p_lifecycle_status,
      latest_revision_no = v_revision_no,
      updated_by = p_actor_id
  where id = v_treatment.id;

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_treatment_revised',
    p_target_type := 'salon_treatment_revisions',
    p_actor_type := 'user',
    p_location_id := v_treatment.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_revision.id,
    p_before_state := jsonb_build_object(
      'lifecycleStatus', v_treatment.lifecycle_status,
      'latestRevisionNo', v_treatment.latest_revision_no
    ),
    p_after_state := jsonb_build_object(
      'treatmentId', v_treatment.id,
      'revisionNo', v_revision.revision_no,
      'lifecycleStatus', p_lifecycle_status,
      'revisionReason', p_revision_reason,
      'hasSensitiveNoteBody', (p_sensitive_note_body is not null and btrim(p_sensitive_note_body) <> '')
    ),
    p_correlation_id := null,
    p_idempotency_key_id := p_idempotency_key_id,
    p_provider_event_id := null
  );

  v_result := jsonb_build_object(
    'treatmentId', v_treatment.id,
    'revisionId', v_revision.id,
    'revisionNo', v_revision.revision_no,
    'lifecycleStatus', p_lifecycle_status
  );

  v_complete := public.complete_business_idempotency_key(
    p_idempotency_key_id,
    p_idempotency_claim_token,
    v_result
  );

  if coalesce((v_complete->>'ok')::boolean, false) is false then
    raise exception 'idempotency claim token is not current for salon_treatment:revise'
      using errcode = '23514';
  end if;

  return jsonb_build_object('ok', true) || v_result;
end;
$$;

create or replace function public.crm02_upsert_treatment_follow_up(
  p_actor_id uuid,
  p_actor_role text,
  p_actor_employee_id uuid,
  p_studio_id uuid,
  p_treatment_id uuid,
  p_follow_up_id uuid default null,
  p_due_on date default null,
  p_owner_employee_id uuid default null,
  p_status text default null,
  p_note_summary text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_treatment public.salon_treatments;
  v_follow_up public.salon_treatment_follow_ups;
  v_existing_history public.salon_treatment_follow_up_history;
  v_before_status text;
  v_after_status text;
  v_due_on date;
  v_result jsonb;
  v_complete jsonb;
begin
  perform public.crm02_assert_current_claim(
    p_studio_id,
    'salon_treatment_follow_up:upsert',
    p_idempotency_key_id,
    p_idempotency_claim_token
  );

  select *
  into v_existing_history
  from public.salon_treatment_follow_up_history h
  where h.idempotency_key_id = p_idempotency_key_id
  limit 1;

  if found then
    select *
    into v_follow_up
    from public.salon_treatment_follow_ups f
    where f.id = v_existing_history.follow_up_id;

    v_result := jsonb_build_object(
      'followUpId', v_follow_up.id,
      'treatmentId', v_follow_up.treatment_id,
      'status', v_follow_up.status,
      'dueOn', v_follow_up.due_on
    );

    v_complete := public.complete_business_idempotency_key(
      p_idempotency_key_id,
      p_idempotency_claim_token,
      v_result
    );
    if coalesce((v_complete->>'ok')::boolean, false) is false then
      raise exception 'idempotency claim token is not current for salon_treatment_follow_up:upsert'
        using errcode = '23514';
    end if;

    return jsonb_build_object('ok', true) || v_result;
  end if;

  select *
  into v_treatment
  from public.salon_treatments t
  where t.id = p_treatment_id
    and t.studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'treatment % not found in studio %', p_treatment_id, p_studio_id using errcode = 'P0002';
  end if;

  perform public.crm02_assert_actor_base_scope(
    p_studio_id,
    p_actor_id,
    p_actor_role,
    v_treatment.location_id,
    p_actor_employee_id
  );

  if p_actor_role = 'instructor' and p_actor_employee_id is distinct from v_treatment.actual_employee_id then
    raise exception 'instructor can only manage own treatment follow-up' using errcode = '42501';
  end if;

  if p_follow_up_id is null then
    if p_due_on is null then
      raise exception 'due_on is required when creating follow-up' using errcode = '22023';
    end if;

    v_after_status := coalesce(p_status, 'pending');
    if v_after_status not in ('pending', 'in_progress', 'done', 'cancelled') then
      raise exception 'invalid follow-up status %', v_after_status using errcode = '22023';
    end if;

    insert into public.salon_treatment_follow_ups (
      treatment_id,
      studio_id,
      location_id,
      salon_customer_id,
      due_on,
      owner_employee_id,
      status,
      note_summary,
      created_by,
      updated_by
    ) values (
      v_treatment.id,
      v_treatment.studio_id,
      v_treatment.location_id,
      v_treatment.salon_customer_id,
      p_due_on,
      p_owner_employee_id,
      v_after_status,
      p_note_summary,
      p_actor_id,
      p_actor_id
    )
    returning * into v_follow_up;

    v_before_status := null;
  else
    select *
    into v_follow_up
    from public.salon_treatment_follow_ups f
    where f.id = p_follow_up_id
      and f.treatment_id = v_treatment.id
      and f.studio_id = p_studio_id
    for update;

    if not found then
      raise exception 'follow-up % not found for treatment %', p_follow_up_id, v_treatment.id using errcode = 'P0002';
    end if;

    v_before_status := v_follow_up.status;
    v_after_status := coalesce(p_status, v_follow_up.status);

    if v_after_status not in ('pending', 'in_progress', 'done', 'cancelled') then
      raise exception 'invalid follow-up status %', v_after_status using errcode = '22023';
    end if;

    update public.salon_treatment_follow_ups
    set due_on = coalesce(p_due_on, v_follow_up.due_on),
        owner_employee_id = p_owner_employee_id,
        status = v_after_status,
        note_summary = p_note_summary,
        updated_by = p_actor_id
    where id = v_follow_up.id
    returning * into v_follow_up;
  end if;

  v_due_on := v_follow_up.due_on;

  insert into public.salon_treatment_follow_up_history (
    follow_up_id,
    studio_id,
    from_status,
    to_status,
    due_on,
    owner_employee_id,
    note_summary,
    actor_id,
    actor_role,
    idempotency_key_id,
    idempotency_claim_token
  ) values (
    v_follow_up.id,
    p_studio_id,
    v_before_status,
    v_follow_up.status,
    v_due_on,
    v_follow_up.owner_employee_id,
    v_follow_up.note_summary,
    p_actor_id,
    p_actor_role,
    p_idempotency_key_id,
    p_idempotency_claim_token
  );

  perform public.record_strong_audit(
    p_studio_id := p_studio_id,
    p_action := 'salon_treatment_follow_up_upserted',
    p_target_type := 'salon_treatment_follow_ups',
    p_actor_type := 'user',
    p_location_id := v_treatment.location_id,
    p_actor_id := p_actor_id,
    p_actor_role := p_actor_role,
    p_target_id := v_follow_up.id,
    p_before_state := jsonb_build_object(
      'status', v_before_status
    ),
    p_after_state := jsonb_build_object(
      'treatmentId', v_follow_up.treatment_id,
      'dueOn', v_follow_up.due_on,
      'status', v_follow_up.status,
      'ownerEmployeeId', v_follow_up.owner_employee_id
    ),
    p_correlation_id := null,
    p_idempotency_key_id := p_idempotency_key_id,
    p_provider_event_id := null
  );

  v_result := jsonb_build_object(
    'followUpId', v_follow_up.id,
    'treatmentId', v_follow_up.treatment_id,
    'status', v_follow_up.status,
    'dueOn', v_follow_up.due_on
  );

  v_complete := public.complete_business_idempotency_key(
    p_idempotency_key_id,
    p_idempotency_claim_token,
    v_result
  );
  if coalesce((v_complete->>'ok')::boolean, false) is false then
    raise exception 'idempotency claim token is not current for salon_treatment_follow_up:upsert'
      using errcode = '23514';
  end if;

  return jsonb_build_object('ok', true) || v_result;
end;
$$;

alter table public.salon_treatments enable row level security;
alter table public.salon_treatment_revisions enable row level security;
alter table public.salon_treatment_follow_ups enable row level security;
alter table public.salon_treatment_follow_up_history enable row level security;

revoke all on table public.salon_treatments from public, anon, authenticated;
revoke all on table public.salon_treatment_revisions from public, anon, authenticated;
revoke all on table public.salon_treatment_follow_ups from public, anon, authenticated;
revoke all on table public.salon_treatment_follow_up_history from public, anon, authenticated;

grant all on table public.salon_treatments to service_role;
grant select, insert on table public.salon_treatment_revisions to service_role;
grant all on table public.salon_treatment_follow_ups to service_role;
grant select, insert on table public.salon_treatment_follow_up_history to service_role;

revoke all on function public.crm02_assert_customer_in_studio(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_assert_location_in_studio(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_assert_actor_base_scope(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_assert_employee_in_location(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_assert_current_claim(uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_create_or_link_treatment_from_appointment(uuid, text, uuid, uuid, uuid, uuid, text, text, text, text, date, uuid, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_revise_treatment(uuid, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.crm02_upsert_treatment_follow_up(uuid, text, uuid, uuid, uuid, uuid, date, uuid, text, text, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.crm02_assert_customer_in_studio(uuid, uuid)
  to service_role;
grant execute on function public.crm02_assert_location_in_studio(uuid, uuid)
  to service_role;
grant execute on function public.crm02_assert_actor_base_scope(uuid, uuid, text, uuid, uuid)
  to service_role;
grant execute on function public.crm02_assert_employee_in_location(uuid, uuid, uuid)
  to service_role;
grant execute on function public.crm02_assert_current_claim(uuid, text, uuid, uuid)
  to service_role;
grant execute on function public.crm02_create_or_link_treatment_from_appointment(uuid, text, uuid, uuid, uuid, uuid, text, text, text, text, date, uuid, text, uuid, uuid)
  to service_role;
grant execute on function public.crm02_revise_treatment(uuid, text, uuid, uuid, uuid, text, text, text, text, uuid, uuid)
  to service_role;
grant execute on function public.crm02_upsert_treatment_follow_up(uuid, text, uuid, uuid, uuid, uuid, date, uuid, text, text, uuid, uuid)
  to service_role;
