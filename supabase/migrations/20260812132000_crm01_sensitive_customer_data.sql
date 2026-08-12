-- CRM-01: salon customer sensitive data + consent foundation.
-- Extends FND-02 salon_customers (no second customer identity).

create unique index if not exists salon_customers_studio_id_id_unique
  on public.salon_customers (studio_id, id);

-- ── Shared helpers ───────────────────────────────────────────────────────
create or replace function public.crm01_assert_customer_in_studio(
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
    and c.studio_id = p_studio_id;

  if not found then
    raise exception 'customer % does not belong to studio %', p_salon_customer_id, p_studio_id
      using errcode = '23514';
  end if;

  return v_customer;
end;
$$;

create or replace function public.crm01_assert_location_in_studio(
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

create or replace function public.crm01_assert_actor_scope(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer public.salon_customers;
  v_has_global_scope boolean := false;
  v_has_location_scope boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  v_customer := public.crm01_assert_customer_in_studio(p_studio_id, p_salon_customer_id);
  perform public.crm01_assert_location_in_studio(p_studio_id, p_location_id);

  if p_actor_role in ('system', 'service') then
    return;
  end if;

  if p_actor_role = 'client' then
    if v_customer.user_id is null or v_customer.user_id <> p_actor_id then
      raise exception 'client actor % does not own customer %', p_actor_id, p_salon_customer_id
        using errcode = '42501';
    end if;
    return;
  end if;

  select exists (
    select 1
    from public.studios s
    where s.id = p_studio_id
      and s.owner_id = p_actor_id
  ) into v_has_global_scope;

  if not v_has_global_scope then
    select exists (
      select 1
      from public.staff_memberships sm
      where sm.user_id = p_actor_id
        and sm.studio_id = p_studio_id
        and sm.is_active = true
        and sm.location_id is null
        and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text, 'instructor'::text])
    ) into v_has_global_scope;
  end if;

  if v_has_global_scope then
    return;
  end if;

  if p_location_id is null then
    raise exception 'actor % has no studio-global scope', p_actor_id using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.location_id = p_location_id
      and sm.is_active = true
      and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text, 'instructor'::text])
  ) into v_has_location_scope;

  if not v_has_location_scope then
    raise exception 'actor % has no scope for location %', p_actor_id, p_location_id using errcode = '42501';
  end if;
end;
$$;

create or replace function public.crm01_assert_actor_in_studio(
  p_studio_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;

  if not exists (select 1 from public.users u where u.id = p_actor_id) then
    raise exception 'actor % does not exist', p_actor_id using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.studios s
    where s.id = p_studio_id
      and s.owner_id = p_actor_id
  ) then
    return;
  end if;

  if exists (
    select 1
    from public.staff_memberships sm
    where sm.user_id = p_actor_id
      and sm.studio_id = p_studio_id
      and sm.is_active = true
      and sm.role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text, 'instructor'::text])
  ) then
    return;
  end if;

  raise exception 'actor % has no active role in studio %', p_actor_id, p_studio_id using errcode = '42501';
end;
$$;

-- ── Preferences ──────────────────────────────────────────────────────────
create table if not exists public.salon_customer_preferences (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null,
  preferred_services text,
  preferred_employee_ids uuid[] not null default '{}',
  preferred_location_ids uuid[] not null default '{}',
  preferred_time_slots text[] not null default '{}',
  communication_language text,
  product_preferences text,
  environment_preferences text,
  contact_preference text,
  notes text,
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_customer_preferences_customer_studio_fk
    foreign key (studio_id, salon_customer_id)
    references public.salon_customers (studio_id, id)
    on delete cascade,
  constraint salon_customer_preferences_unique_customer
    unique (studio_id, salon_customer_id)
);

create index if not exists idx_salon_customer_preferences_studio_customer
  on public.salon_customer_preferences (studio_id, salon_customer_id);

-- ── Health profiles ──────────────────────────────────────────────────────
create table if not exists public.salon_customer_health_profiles (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null,
  allergies text,
  reaction_ingredients text,
  reaction_products text,
  declared_health_conditions text,
  service_affecting_conditions text,
  contraindications text,
  patch_test_required boolean not null default false,
  patch_test_date date,
  patch_test_result text,
  last_confirmed_at timestamptz,
  recorded_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_customer_health_profiles_customer_studio_fk
    foreign key (studio_id, salon_customer_id)
    references public.salon_customers (studio_id, id)
    on delete cascade,
  constraint salon_customer_health_profiles_unique_customer
    unique (studio_id, salon_customer_id),
  constraint salon_customer_health_patch_test_result_check
    check (patch_test_result is null or patch_test_result = any (array['pending'::text, 'pass'::text, 'fail'::text, 'not_required'::text]))
);

create index if not exists idx_salon_customer_health_profiles_studio_customer
  on public.salon_customer_health_profiles (studio_id, salon_customer_id);

-- ── Consent events (append-only) ─────────────────────────────────────────
create table if not exists public.salon_customer_consents (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null,
  consent_key text not null check (consent_key = 'email_marketing'),
  channel text not null check (channel = 'email'),
  status text not null check (status = any (array['granted'::text, 'withdrawn'::text])),
  source text not null check (source = any (array['frontdesk'::text, 'client_portal'::text, 'imported'::text, 'system'::text, 'api'::text])),
  occurred_at timestamptz not null default now(),
  text_version text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  actor_id uuid not null references public.users(id) on delete restrict,
  actor_role text not null,
  location_id uuid references public.locations(id) on delete set null,
  correlation_id text,
  idempotency_key_id uuid references public.business_idempotency_keys(id) on delete set null,
  idempotency_claim_token uuid,
  created_at timestamptz not null default now(),
  constraint salon_customer_consents_customer_studio_fk
    foreign key (studio_id, salon_customer_id)
    references public.salon_customers (studio_id, id)
    on delete cascade
);

create index if not exists idx_salon_customer_consents_studio_customer_occurred
  on public.salon_customer_consents (studio_id, salon_customer_id, consent_key, channel, occurred_at desc, created_at desc);

create unique index if not exists salon_customer_consents_idempotency_key_unique
  on public.salon_customer_consents (idempotency_key_id)
  where idempotency_key_id is not null;

-- ── Sensitive access audits (append-only) ────────────────────────────────
create table if not exists public.salon_customer_access_audits (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null,
  location_id uuid references public.locations(id) on delete set null,
  actor_id uuid not null references public.users(id) on delete restrict,
  actor_role text not null,
  action text not null check (action = any (array[
    'health_view'::text,
    'health_update'::text,
    'preference_view'::text,
    'preference_update'::text,
    'consent_view'::text,
    'consent_update'::text,
    'safety_summary_view'::text,
    'sensitive_export'::text
  ])),
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  constraint salon_customer_access_audits_customer_studio_fk
    foreign key (studio_id, salon_customer_id)
    references public.salon_customers (studio_id, id)
    on delete cascade
);

create index if not exists idx_salon_customer_access_audits_studio_customer_created
  on public.salon_customer_access_audits (studio_id, salon_customer_id, created_at desc);

-- ── Validation triggers ───────────────────────────────────────────────────
create or replace function public.crm01_validate_preferences_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
begin
  v_actor := case when tg_op = 'INSERT' then coalesce(new.updated_by, new.created_by) else new.updated_by end;
  perform public.crm01_assert_actor_in_studio(new.studio_id, v_actor);
  return new;
end;
$$;

drop trigger if exists salon_customer_preferences_validate_scope_trg on public.salon_customer_preferences;
create trigger salon_customer_preferences_validate_scope_trg
  before insert or update of studio_id, salon_customer_id, created_by, updated_by
  on public.salon_customer_preferences
  for each row execute function public.crm01_validate_preferences_scope();

create or replace function public.crm01_validate_health_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid;
begin
  v_actor := case when tg_op = 'INSERT' then coalesce(new.updated_by, new.recorded_by) else new.updated_by end;
  perform public.crm01_assert_actor_in_studio(new.studio_id, v_actor);
  return new;
end;
$$;

drop trigger if exists salon_customer_health_profiles_validate_scope_trg on public.salon_customer_health_profiles;
create trigger salon_customer_health_profiles_validate_scope_trg
  before insert or update of studio_id, salon_customer_id, recorded_by, updated_by
  on public.salon_customer_health_profiles
  for each row execute function public.crm01_validate_health_scope();

create or replace function public.crm01_validate_consent_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.crm01_assert_actor_scope(
    new.studio_id,
    new.salon_customer_id,
    new.actor_id,
    new.actor_role,
    new.location_id
  );

  if new.idempotency_key_id is not null then
    if not exists (
      select 1
      from public.business_idempotency_keys b
      where b.id = new.idempotency_key_id
        and b.studio_id = new.studio_id
        and b.operation_scope = 'salon_customer_consent:email'
    ) then
      raise exception 'idempotency key % is invalid for studio % consent scope', new.idempotency_key_id, new.studio_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists salon_customer_consents_validate_scope_trg on public.salon_customer_consents;
create trigger salon_customer_consents_validate_scope_trg
  before insert or update of studio_id, salon_customer_id, actor_id, actor_role, location_id, idempotency_key_id
  on public.salon_customer_consents
  for each row execute function public.crm01_validate_consent_scope();

create or replace function public.crm01_validate_access_audit_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.crm01_assert_actor_scope(
    new.studio_id,
    new.salon_customer_id,
    new.actor_id,
    new.actor_role,
    new.location_id
  );
  return new;
end;
$$;

drop trigger if exists salon_customer_access_audits_validate_scope_trg on public.salon_customer_access_audits;
create trigger salon_customer_access_audits_validate_scope_trg
  before insert or update of studio_id, salon_customer_id, actor_id, actor_role, location_id
  on public.salon_customer_access_audits
  for each row execute function public.crm01_validate_access_audit_scope();

-- ── Append-only guards ───────────────────────────────────────────────────
create or replace function public.prevent_update_delete_salon_customer_consents()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'salon_customer_consents is append-only; % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists salon_customer_consents_prevent_mutation on public.salon_customer_consents;
create trigger salon_customer_consents_prevent_mutation
  before update or delete on public.salon_customer_consents
  for each row execute function public.prevent_update_delete_salon_customer_consents();

create or replace function public.prevent_update_delete_salon_customer_access_audits()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'salon_customer_access_audits is append-only; % is not allowed', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists salon_customer_access_audits_prevent_mutation on public.salon_customer_access_audits;
create trigger salon_customer_access_audits_prevent_mutation
  before update or delete on public.salon_customer_access_audits
  for each row execute function public.prevent_update_delete_salon_customer_access_audits();

-- ── Updated-at triggers ──────────────────────────────────────────────────
drop trigger if exists set_salon_customer_preferences_updated_at on public.salon_customer_preferences;
create trigger set_salon_customer_preferences_updated_at
  before update on public.salon_customer_preferences
  for each row execute function public.set_updated_at_timestamp();

drop trigger if exists set_salon_customer_health_profiles_updated_at on public.salon_customer_health_profiles;
create trigger set_salon_customer_health_profiles_updated_at
  before update on public.salon_customer_health_profiles
  for each row execute function public.set_updated_at_timestamp();

-- ── RLS / grants ─────────────────────────────────────────────────────────
alter table public.salon_customer_preferences enable row level security;
alter table public.salon_customer_health_profiles enable row level security;
alter table public.salon_customer_consents enable row level security;
alter table public.salon_customer_access_audits enable row level security;

revoke all on table public.salon_customer_preferences from public;
revoke all on table public.salon_customer_preferences from anon;
revoke all on table public.salon_customer_preferences from authenticated;
grant select on table public.salon_customer_preferences to service_role;

revoke all on table public.salon_customer_health_profiles from public;
revoke all on table public.salon_customer_health_profiles from anon;
revoke all on table public.salon_customer_health_profiles from authenticated;
grant select on table public.salon_customer_health_profiles to service_role;

revoke all on table public.salon_customer_consents from public;
revoke all on table public.salon_customer_consents from anon;
revoke all on table public.salon_customer_consents from authenticated;
grant select on table public.salon_customer_consents to service_role;

revoke all on table public.salon_customer_access_audits from public;
revoke all on table public.salon_customer_access_audits from anon;
revoke all on table public.salon_customer_access_audits from authenticated;
grant select on table public.salon_customer_access_audits to service_role;

-- ── Privileged helpers / RPC ─────────────────────────────────────────────
create or replace function public.record_salon_customer_access_audit(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_location_id uuid default null,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_metadata is null then
    p_metadata := '{}'::jsonb;
  end if;

  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  insert into public.salon_customer_access_audits (
    studio_id,
    salon_customer_id,
    location_id,
    actor_id,
    actor_role,
    action,
    reason,
    metadata
  ) values (
    p_studio_id,
    p_salon_customer_id,
    p_location_id,
    p_actor_id,
    p_actor_role,
    p_action,
    p_reason,
    p_metadata
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.upsert_salon_customer_preferences(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_preferred_services text default null,
  p_preferred_employee_ids uuid[] default '{}',
  p_preferred_location_ids uuid[] default '{}',
  p_preferred_time_slots text[] default '{}',
  p_communication_language text default null,
  p_product_preferences text default null,
  p_environment_preferences text default null,
  p_contact_preference text default null,
  p_notes text default null,
  p_reason text default null,
  p_location_id uuid default null
)
returns public.salon_customer_preferences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_customer_preferences;
  v_existing_id uuid;
begin
  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  select id into v_existing_id
  from public.salon_customer_preferences
  where studio_id = p_studio_id
    and salon_customer_id = p_salon_customer_id;

  insert into public.salon_customer_preferences (
    studio_id,
    salon_customer_id,
    preferred_services,
    preferred_employee_ids,
    preferred_location_ids,
    preferred_time_slots,
    communication_language,
    product_preferences,
    environment_preferences,
    contact_preference,
    notes,
    created_by,
    updated_by
  ) values (
    p_studio_id,
    p_salon_customer_id,
    p_preferred_services,
    coalesce(p_preferred_employee_ids, '{}'),
    coalesce(p_preferred_location_ids, '{}'),
    coalesce(p_preferred_time_slots, '{}'),
    p_communication_language,
    p_product_preferences,
    p_environment_preferences,
    p_contact_preference,
    p_notes,
    p_actor_id,
    p_actor_id
  )
  on conflict (studio_id, salon_customer_id)
  do update set
    preferred_services = excluded.preferred_services,
    preferred_employee_ids = excluded.preferred_employee_ids,
    preferred_location_ids = excluded.preferred_location_ids,
    preferred_time_slots = excluded.preferred_time_slots,
    communication_language = excluded.communication_language,
    product_preferences = excluded.product_preferences,
    environment_preferences = excluded.environment_preferences,
    contact_preference = excluded.contact_preference,
    notes = excluded.notes,
    updated_by = p_actor_id
  returning * into v_row;

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    'preference_update',
    p_location_id,
    p_reason,
    jsonb_build_object('profileId', v_row.id)
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_preferences_upsert',
    'salon_customer_preferences',
    'user',
    p_location_id,
    p_actor_id,
    p_actor_role,
    v_row.id,
    jsonb_build_object('existed', v_existing_id is not null),
    jsonb_build_object('profileId', v_row.id),
    null,
    null,
    null
  );

  return v_row;
end;
$$;

create or replace function public.upsert_salon_customer_health_profile(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_allergies text default null,
  p_reaction_ingredients text default null,
  p_reaction_products text default null,
  p_declared_health_conditions text default null,
  p_service_affecting_conditions text default null,
  p_contraindications text default null,
  p_patch_test_required boolean default false,
  p_patch_test_date date default null,
  p_patch_test_result text default null,
  p_last_confirmed_at timestamptz default null,
  p_reason text default null,
  p_location_id uuid default null
)
returns public.salon_customer_health_profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_customer_health_profiles;
  v_existing_id uuid;
begin
  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  select id into v_existing_id
  from public.salon_customer_health_profiles
  where studio_id = p_studio_id
    and salon_customer_id = p_salon_customer_id;

  insert into public.salon_customer_health_profiles (
    studio_id,
    salon_customer_id,
    allergies,
    reaction_ingredients,
    reaction_products,
    declared_health_conditions,
    service_affecting_conditions,
    contraindications,
    patch_test_required,
    patch_test_date,
    patch_test_result,
    last_confirmed_at,
    recorded_by,
    updated_by
  ) values (
    p_studio_id,
    p_salon_customer_id,
    p_allergies,
    p_reaction_ingredients,
    p_reaction_products,
    p_declared_health_conditions,
    p_service_affecting_conditions,
    p_contraindications,
    coalesce(p_patch_test_required, false),
    p_patch_test_date,
    p_patch_test_result,
    p_last_confirmed_at,
    p_actor_id,
    p_actor_id
  )
  on conflict (studio_id, salon_customer_id)
  do update set
    allergies = excluded.allergies,
    reaction_ingredients = excluded.reaction_ingredients,
    reaction_products = excluded.reaction_products,
    declared_health_conditions = excluded.declared_health_conditions,
    service_affecting_conditions = excluded.service_affecting_conditions,
    contraindications = excluded.contraindications,
    patch_test_required = excluded.patch_test_required,
    patch_test_date = excluded.patch_test_date,
    patch_test_result = excluded.patch_test_result,
    last_confirmed_at = excluded.last_confirmed_at,
    updated_by = p_actor_id
  returning * into v_row;

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    'health_update',
    p_location_id,
    p_reason,
    jsonb_build_object(
      'profileId', v_row.id,
      'hasAllergyAlert', coalesce(nullif(trim(coalesce(v_row.allergies, '')), ''), null) is not null,
      'hasContraindicationAlert', coalesce(nullif(trim(coalesce(v_row.contraindications, '')), ''), null) is not null,
      'patchTestRequired', v_row.patch_test_required
    )
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_health_profile_upsert',
    'salon_customer_health_profiles',
    'user',
    p_location_id,
    p_actor_id,
    p_actor_role,
    v_row.id,
    jsonb_build_object('existed', v_existing_id is not null),
    jsonb_build_object(
      'profileId', v_row.id,
      'hasAllergyAlert', coalesce(nullif(trim(coalesce(v_row.allergies, '')), ''), null) is not null,
      'hasConditionAlert', coalesce(nullif(trim(coalesce(v_row.declared_health_conditions, '')), ''), null) is not null,
      'hasContraindicationAlert', coalesce(nullif(trim(coalesce(v_row.contraindications, '')), ''), null) is not null,
      'patchTestRequired', v_row.patch_test_required,
      'lastConfirmedAt', v_row.last_confirmed_at
    ),
    null,
    null,
    null
  );

  return v_row;
end;
$$;

create or replace function public.record_salon_customer_email_consent(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_status text,
  p_source text,
  p_text_version text,
  p_evidence jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_location_id uuid default null,
  p_correlation_id text default null,
  p_idempotency_key_id uuid default null,
  p_idempotency_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event public.salon_customer_consents;
  v_latest_status text;
begin
  if p_status not in ('granted', 'withdrawn') then
    raise exception 'invalid consent status %', p_status using errcode = '22023';
  end if;

  if p_source not in ('frontdesk', 'client_portal', 'imported', 'system', 'api') then
    raise exception 'invalid consent source %', p_source using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_text_version, '')), '') is null then
    raise exception 'consent text version is required' using errcode = '22023';
  end if;

  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  if p_idempotency_key_id is not null then
    if not exists (
      select 1
      from public.business_idempotency_keys k
      where k.id = p_idempotency_key_id
        and k.studio_id = p_studio_id
        and k.operation_scope = 'salon_customer_consent:email'
        and k.status = 'processing'
        and k.claim_token = p_idempotency_claim_token
    ) then
      return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
    end if;
  end if;

  insert into public.salon_customer_consents (
    studio_id,
    salon_customer_id,
    consent_key,
    channel,
    status,
    source,
    occurred_at,
    text_version,
    evidence,
    actor_id,
    actor_role,
    location_id,
    correlation_id,
    idempotency_key_id,
    idempotency_claim_token
  ) values (
    p_studio_id,
    p_salon_customer_id,
    'email_marketing',
    'email',
    p_status,
    p_source,
    coalesce(p_occurred_at, now()),
    p_text_version,
    coalesce(p_evidence, '{}'::jsonb),
    p_actor_id,
    p_actor_role,
    p_location_id,
    p_correlation_id,
    p_idempotency_key_id,
    p_idempotency_claim_token
  )
  returning * into v_event;

  select c.status into v_latest_status
  from public.salon_customer_consents c
  where c.studio_id = p_studio_id
    and c.salon_customer_id = p_salon_customer_id
    and c.consent_key = 'email_marketing'
    and c.channel = 'email'
  order by c.occurred_at desc, c.created_at desc, c.id desc
  limit 1;

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    'consent_update',
    p_location_id,
    null,
    jsonb_build_object('eventId', v_event.id, 'status', v_event.status, 'textVersion', v_event.text_version)
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_email_consent_recorded',
    'salon_customer_consents',
    'user',
    p_location_id,
    p_actor_id,
    p_actor_role,
    v_event.id,
    null,
    jsonb_build_object('status', v_event.status, 'textVersion', v_event.text_version, 'occurredAt', v_event.occurred_at),
    p_correlation_id,
    p_idempotency_key_id,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'eventId', v_event.id,
    'effectiveStatus', v_latest_status
  );
end;
$$;

create or replace function public.record_salon_customer_email_consent_idempotent(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_status text,
  p_source text,
  p_text_version text,
  p_idempotency_key_id uuid,
  p_idempotency_claim_token uuid,
  p_evidence jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_location_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_event public.salon_customer_consents;
  v_effective_status text;
  v_complete jsonb;
  v_record_result jsonb;
begin
  if p_idempotency_key_id is null or p_idempotency_claim_token is null then
    raise exception 'idempotency key id and claim token are required' using errcode = '22023';
  end if;

  select *
  into v_existing_event
  from public.salon_customer_consents
  where idempotency_key_id = p_idempotency_key_id
  limit 1;

  if found then
    select c.status into v_effective_status
    from public.salon_customer_consents c
    where c.studio_id = p_studio_id
      and c.salon_customer_id = p_salon_customer_id
      and c.consent_key = 'email_marketing'
      and c.channel = 'email'
    order by c.occurred_at desc, c.created_at desc, c.id desc
    limit 1;

    v_complete := public.complete_business_idempotency_key(
      p_idempotency_key_id,
      p_idempotency_claim_token,
      jsonb_build_object('eventId', v_existing_event.id, 'effectiveStatus', v_effective_status)
    );

    if coalesce((v_complete ->> 'ok')::boolean, false) is false then
      return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
    end if;

    return jsonb_build_object('ok', true, 'eventId', v_existing_event.id, 'effectiveStatus', v_effective_status);
  end if;

  v_record_result := public.record_salon_customer_email_consent(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_status,
    p_source,
    p_text_version,
    p_evidence,
    p_occurred_at,
    p_location_id,
    p_correlation_id,
    p_idempotency_key_id,
    p_idempotency_claim_token
  );

  if coalesce((v_record_result ->> 'ok')::boolean, false) is false then
    return v_record_result;
  end if;

  v_complete := public.complete_business_idempotency_key(
    p_idempotency_key_id,
    p_idempotency_claim_token,
    jsonb_build_object(
      'eventId', v_record_result ->> 'eventId',
      'effectiveStatus', v_record_result ->> 'effectiveStatus'
    )
  );

  if coalesce((v_complete ->> 'ok')::boolean, false) is false then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return v_record_result;
end;
$$;

-- ── Function grants ──────────────────────────────────────────────────────
revoke all on function public.crm01_assert_customer_in_studio(uuid, uuid) from public;
revoke all on function public.crm01_assert_customer_in_studio(uuid, uuid) from anon;
revoke all on function public.crm01_assert_customer_in_studio(uuid, uuid) from authenticated;
grant execute on function public.crm01_assert_customer_in_studio(uuid, uuid) to service_role;

revoke all on function public.crm01_assert_location_in_studio(uuid, uuid) from public;
revoke all on function public.crm01_assert_location_in_studio(uuid, uuid) from anon;
revoke all on function public.crm01_assert_location_in_studio(uuid, uuid) from authenticated;
grant execute on function public.crm01_assert_location_in_studio(uuid, uuid) to service_role;

revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from public;
revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from anon;
revoke all on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) from authenticated;
grant execute on function public.crm01_assert_actor_scope(uuid, uuid, uuid, text, uuid) to service_role;

revoke all on function public.crm01_assert_actor_in_studio(uuid, uuid) from public;
revoke all on function public.crm01_assert_actor_in_studio(uuid, uuid) from anon;
revoke all on function public.crm01_assert_actor_in_studio(uuid, uuid) from authenticated;
grant execute on function public.crm01_assert_actor_in_studio(uuid, uuid) to service_role;

revoke all on function public.crm01_validate_preferences_scope() from public;
revoke all on function public.crm01_validate_preferences_scope() from anon;
revoke all on function public.crm01_validate_preferences_scope() from authenticated;
grant execute on function public.crm01_validate_preferences_scope() to service_role;

revoke all on function public.crm01_validate_health_scope() from public;
revoke all on function public.crm01_validate_health_scope() from anon;
revoke all on function public.crm01_validate_health_scope() from authenticated;
grant execute on function public.crm01_validate_health_scope() to service_role;

revoke all on function public.crm01_validate_consent_scope() from public;
revoke all on function public.crm01_validate_consent_scope() from anon;
revoke all on function public.crm01_validate_consent_scope() from authenticated;
grant execute on function public.crm01_validate_consent_scope() to service_role;

revoke all on function public.crm01_validate_access_audit_scope() from public;
revoke all on function public.crm01_validate_access_audit_scope() from anon;
revoke all on function public.crm01_validate_access_audit_scope() from authenticated;
grant execute on function public.crm01_validate_access_audit_scope() to service_role;

revoke all on function public.prevent_update_delete_salon_customer_consents() from public;
revoke all on function public.prevent_update_delete_salon_customer_consents() from anon;
revoke all on function public.prevent_update_delete_salon_customer_consents() from authenticated;
grant execute on function public.prevent_update_delete_salon_customer_consents() to service_role;

revoke all on function public.prevent_update_delete_salon_customer_access_audits() from public;
revoke all on function public.prevent_update_delete_salon_customer_access_audits() from anon;
revoke all on function public.prevent_update_delete_salon_customer_access_audits() from authenticated;
grant execute on function public.prevent_update_delete_salon_customer_access_audits() to service_role;

revoke all on function public.record_salon_customer_access_audit(uuid, uuid, uuid, text, text, uuid, text, jsonb) from public;
revoke all on function public.record_salon_customer_access_audit(uuid, uuid, uuid, text, text, uuid, text, jsonb) from anon;
revoke all on function public.record_salon_customer_access_audit(uuid, uuid, uuid, text, text, uuid, text, jsonb) from authenticated;
grant execute on function public.record_salon_customer_access_audit(uuid, uuid, uuid, text, text, uuid, text, jsonb) to service_role;

revoke all on function public.upsert_salon_customer_preferences(uuid, uuid, uuid, text, text, uuid[], uuid[], text[], text, text, text, text, text, text, uuid) from public;
revoke all on function public.upsert_salon_customer_preferences(uuid, uuid, uuid, text, text, uuid[], uuid[], text[], text, text, text, text, text, text, uuid) from anon;
revoke all on function public.upsert_salon_customer_preferences(uuid, uuid, uuid, text, text, uuid[], uuid[], text[], text, text, text, text, text, text, uuid) from authenticated;
grant execute on function public.upsert_salon_customer_preferences(uuid, uuid, uuid, text, text, uuid[], uuid[], text[], text, text, text, text, text, text, uuid) to service_role;

revoke all on function public.upsert_salon_customer_health_profile(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, date, text, timestamptz, text, uuid) from public;
revoke all on function public.upsert_salon_customer_health_profile(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, date, text, timestamptz, text, uuid) from anon;
revoke all on function public.upsert_salon_customer_health_profile(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, date, text, timestamptz, text, uuid) from authenticated;
grant execute on function public.upsert_salon_customer_health_profile(uuid, uuid, uuid, text, text, text, text, text, text, text, boolean, date, text, timestamptz, text, uuid) to service_role;

revoke all on function public.record_salon_customer_email_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) from public;
revoke all on function public.record_salon_customer_email_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) from anon;
revoke all on function public.record_salon_customer_email_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) from authenticated;
grant execute on function public.record_salon_customer_email_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) to service_role;

revoke all on function public.record_salon_customer_email_consent_idempotent(uuid, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, timestamptz, uuid, text) from public;
revoke all on function public.record_salon_customer_email_consent_idempotent(uuid, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, timestamptz, uuid, text) from anon;
revoke all on function public.record_salon_customer_email_consent_idempotent(uuid, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, timestamptz, uuid, text) from authenticated;
grant execute on function public.record_salon_customer_email_consent_idempotent(uuid, uuid, uuid, text, text, text, text, uuid, uuid, jsonb, timestamptz, uuid, text) to service_role;
