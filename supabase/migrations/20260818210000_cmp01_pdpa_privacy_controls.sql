-- CMP-01: versioned privacy notice, DSAR log, anonymize, retention rules.
-- Extends CRM-01 consent/audit foundations. Does not edit prior migrations.

-- ── Studio retention settings ────────────────────────────────────────────
alter table public.studios
  add column if not exists customer_retention_days integer not null default 1825;
alter table public.studios
  add column if not exists appointment_retention_days integer not null default 1825;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'studios_customer_retention_days_check'
      and conrelid = 'public.studios'::regclass
  ) then
    alter table public.studios
      add constraint studios_customer_retention_days_check
      check (customer_retention_days >= 1 and customer_retention_days <= 36500);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'studios_appointment_retention_days_check'
      and conrelid = 'public.studios'::regclass
  ) then
    alter table public.studios
      add constraint studios_appointment_retention_days_check
      check (appointment_retention_days >= 1 and appointment_retention_days <= 36500);
  end if;
end
$$;

-- ── Customer anonymize marker ────────────────────────────────────────────
alter table public.salon_customers
  add column if not exists anonymized_at timestamptz;

create index if not exists idx_salon_customers_studio_anonymized
  on public.salon_customers (studio_id)
  where anonymized_at is not null;

-- ── Appointment retention review (table exists in production APT-02) ─────
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'salon_appointments'
  ) then
    alter table public.salon_appointments
      add column if not exists retention_reviewed_at timestamptz;
    create index if not exists idx_salon_appointments_studio_retention_reviewed
      on public.salon_appointments (studio_id, starts_at)
      where retention_reviewed_at is null;
  end if;
end
$$;

-- ── Consent key/channel: allow privacy_notice ────────────────────────────
alter table public.salon_customer_consents
  drop constraint if exists salon_customer_consents_consent_key_check;
alter table public.salon_customer_consents
  add constraint salon_customer_consents_consent_key_check
  check (consent_key = any (array['email_marketing'::text, 'privacy_notice'::text]));

alter table public.salon_customer_consents
  drop constraint if exists salon_customer_consents_channel_check;
alter table public.salon_customer_consents
  add constraint salon_customer_consents_channel_check
  check (channel = any (array['email'::text, 'web'::text]));

alter table public.salon_customer_access_audits
  drop constraint if exists salon_customer_access_audits_action_check;
alter table public.salon_customer_access_audits
  add constraint salon_customer_access_audits_action_check
  check (action = any (array[
    'health_view'::text,
    'health_update'::text,
    'preference_view'::text,
    'preference_update'::text,
    'consent_view'::text,
    'consent_update'::text,
    'safety_summary_view'::text,
    'sensitive_export'::text,
    'data_request_view'::text,
    'data_request_update'::text
  ]));

create or replace function public.crm01_validate_consent_scope()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_expected_scope text;
begin
  perform public.crm01_assert_actor_scope(
    new.studio_id,
    new.salon_customer_id,
    new.actor_id,
    new.actor_role,
    new.location_id
  );

  if new.idempotency_key_id is not null then
    v_expected_scope := case new.consent_key
      when 'email_marketing' then 'salon_customer_consent:email'
      when 'privacy_notice' then 'salon_customer_consent:privacy'
      else null
    end;
    if v_expected_scope is null
      or not exists (
        select 1
        from public.business_idempotency_keys b
        where b.id = new.idempotency_key_id
          and b.studio_id = new.studio_id
          and b.operation_scope = v_expected_scope
      )
    then
      raise exception 'idempotency key % is invalid for studio % consent scope', new.idempotency_key_id, new.studio_id
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ── Privacy notice versions ──────────────────────────────────────────────
create table if not exists public.salon_privacy_notice_versions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete restrict,
  version_label text not null,
  content_hash text not null,
  content_snapshot jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  published_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_privacy_notice_versions_hash_non_empty check (length(btrim(content_hash)) > 0),
  constraint salon_privacy_notice_versions_label_non_empty check (length(btrim(version_label)) > 0)
);

create unique index if not exists salon_privacy_notice_versions_studio_hash_unique
  on public.salon_privacy_notice_versions (studio_id, content_hash);

create index if not exists idx_salon_privacy_notice_versions_studio_published
  on public.salon_privacy_notice_versions (studio_id, published_at desc);

drop trigger if exists set_salon_privacy_notice_versions_updated_at on public.salon_privacy_notice_versions;
create trigger set_salon_privacy_notice_versions_updated_at
  before update on public.salon_privacy_notice_versions
  for each row execute function public.set_updated_at_timestamp();

create or replace function public.prevent_mutate_salon_privacy_notice_versions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'salon_privacy_notice_versions is append-only; DELETE is not allowed'
      using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'is_active' - 'updated_at') <> (to_jsonb(old) - 'is_active' - 'updated_at') then
    raise exception 'salon_privacy_notice_versions is append-only except is_active'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists salon_privacy_notice_versions_prevent_mutation on public.salon_privacy_notice_versions;
create trigger salon_privacy_notice_versions_prevent_mutation
  before update or delete on public.salon_privacy_notice_versions
  for each row execute function public.prevent_mutate_salon_privacy_notice_versions();

-- ── Data subject access / correction requests ────────────────────────────
create table if not exists public.salon_customer_data_requests (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  salon_customer_id uuid not null,
  request_type text not null check (request_type = any (array['access'::text, 'correction'::text])),
  status text not null default 'open' check (status = any (array['open'::text, 'completed'::text, 'rejected'::text])),
  customer_note text,
  staff_note text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_id uuid not null references public.users(id) on delete restrict,
  actor_role text not null,
  completed_by uuid references public.users(id) on delete restrict,
  location_id uuid references public.locations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_customer_data_requests_customer_studio_fk
    foreign key (studio_id, salon_customer_id)
    references public.salon_customers (studio_id, id)
    on delete cascade,
  constraint salon_customer_data_requests_closed_fields check (
    (status = 'open' and completed_at is null and completed_by is null)
    or (status <> 'open' and completed_at is not null)
  )
);

create index if not exists idx_salon_customer_data_requests_studio_customer
  on public.salon_customer_data_requests (studio_id, salon_customer_id, requested_at desc);

create index if not exists idx_salon_customer_data_requests_studio_status
  on public.salon_customer_data_requests (studio_id, status, requested_at desc);

drop trigger if exists set_salon_customer_data_requests_updated_at on public.salon_customer_data_requests;
create trigger set_salon_customer_data_requests_updated_at
  before update on public.salon_customer_data_requests
  for each row execute function public.set_updated_at_timestamp();

create or replace function public.cmp01_validate_data_request_scope()
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

drop trigger if exists salon_customer_data_requests_validate_scope_trg on public.salon_customer_data_requests;
create trigger salon_customer_data_requests_validate_scope_trg
  before insert or update of studio_id, salon_customer_id, actor_id, actor_role, location_id
  on public.salon_customer_data_requests
  for each row execute function public.cmp01_validate_data_request_scope();

create or replace function public.prevent_closed_salon_customer_data_request_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'salon_customer_data_requests cannot be deleted'
      using errcode = '42501';
  end if;
  if old.status <> 'open' then
    raise exception 'salon_customer_data_requests is append-only after complete'
      using errcode = '42501';
  end if;
  if new.request_type <> old.request_type then
    raise exception 'salon_customer_data_requests.request_type cannot change'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists salon_customer_data_requests_prevent_closed_mutation on public.salon_customer_data_requests;
create trigger salon_customer_data_requests_prevent_closed_mutation
  before update or delete on public.salon_customer_data_requests
  for each row execute function public.prevent_closed_salon_customer_data_request_mutation();

-- ── RLS / grants ─────────────────────────────────────────────────────────
alter table public.salon_privacy_notice_versions enable row level security;
alter table public.salon_customer_data_requests enable row level security;

revoke all on table public.salon_privacy_notice_versions from public;
revoke all on table public.salon_privacy_notice_versions from anon;
revoke all on table public.salon_privacy_notice_versions from authenticated;
grant select, insert, update on table public.salon_privacy_notice_versions to service_role;

revoke all on table public.salon_customer_data_requests from public;
revoke all on table public.salon_customer_data_requests from anon;
revoke all on table public.salon_customer_data_requests from authenticated;
grant select, insert, update on table public.salon_customer_data_requests to service_role;

-- ── RPCs ─────────────────────────────────────────────────────────────────
create or replace function public.cmp01_assert_privacy_publisher(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_owner boolean := false;
  v_has_global_role boolean := false;
begin
  if p_actor_id is null then
    raise exception 'actor_id is required' using errcode = '22023';
  end if;
  if p_actor_role not in ('owner', 'manager') then
    raise exception 'privacy publisher role must be owner or manager' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.studios s
    where s.id = p_studio_id and s.owner_id = p_actor_id
  ) into v_is_owner;

  if v_is_owner then
    if p_actor_role <> 'owner' then
      raise exception 'studio owner % must declare role owner, got %', p_actor_id, p_actor_role
        using errcode = '42501';
    end if;
    return;
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

  if not v_has_global_role then
    raise exception 'actor % cannot publish privacy controls for studio %', p_actor_id, p_studio_id
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.publish_salon_privacy_notice(
  p_studio_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_version_label text,
  p_content_hash text,
  p_content_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_privacy_notice_versions;
begin
  if nullif(trim(coalesce(p_version_label, '')), '') is null then
    raise exception 'privacy notice version label is required' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_content_hash, '')), '') is null then
    raise exception 'privacy notice content hash is required' using errcode = '22023';
  end if;

  perform public.cmp01_assert_privacy_publisher(p_studio_id, p_actor_id, p_actor_role);

  select *
  into v_row
  from public.salon_privacy_notice_versions
  where studio_id = p_studio_id
    and content_hash = trim(p_content_hash)
  limit 1;

  if found then
    update public.salon_privacy_notice_versions
    set is_active = false
    where studio_id = p_studio_id
      and is_active = true
      and id <> v_row.id;

    update public.salon_privacy_notice_versions
    set is_active = true
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'ok', true,
      'id', v_row.id,
      'versionLabel', v_row.version_label
    );
  end if;

  update public.salon_privacy_notice_versions
  set is_active = false
  where studio_id = p_studio_id
    and is_active = true;

  insert into public.salon_privacy_notice_versions (
    studio_id,
    version_label,
    content_hash,
    content_snapshot,
    is_active,
    published_by
  ) values (
    p_studio_id,
    trim(p_version_label),
    trim(p_content_hash),
    coalesce(p_content_snapshot, '{}'::jsonb),
    true,
    p_actor_id
  )
  returning * into v_row;

  perform public.record_strong_audit(
    p_studio_id,
    'salon_privacy_notice_published',
    'salon_privacy_notice_versions',
    'user',
    null,
    p_actor_id,
    p_actor_role,
    v_row.id,
    null,
    jsonb_build_object('versionLabel', v_row.version_label, 'contentHash', v_row.content_hash),
    null,
    null,
    null
  );

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'versionLabel', v_row.version_label
  );
end;
$$;

create or replace function public.record_salon_customer_privacy_consent(
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
        and k.operation_scope = 'salon_customer_consent:privacy'
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
    'privacy_notice',
    'web',
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
    and c.consent_key = 'privacy_notice'
    and c.channel = 'web'
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
    jsonb_build_object('eventId', v_event.id, 'status', v_event.status, 'textVersion', v_event.text_version, 'consentKey', 'privacy_notice')
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_privacy_consent_recorded',
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

create or replace function public.create_salon_customer_data_request(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_request_type text,
  p_customer_note text default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_customer_data_requests;
begin
  if p_request_type not in ('access', 'correction') then
    raise exception 'invalid data request type %', p_request_type using errcode = '22023';
  end if;

  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  insert into public.salon_customer_data_requests (
    studio_id,
    salon_customer_id,
    request_type,
    status,
    customer_note,
    actor_id,
    actor_role,
    location_id
  ) values (
    p_studio_id,
    p_salon_customer_id,
    p_request_type,
    'open',
    nullif(trim(coalesce(p_customer_note, '')), ''),
    p_actor_id,
    p_actor_role,
    p_location_id
  )
  returning * into v_row;

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    'data_request_update',
    p_location_id,
    null,
    jsonb_build_object('requestId', v_row.id, 'requestType', v_row.request_type, 'status', v_row.status)
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_data_request_created',
    'salon_customer_data_requests',
    'user',
    p_location_id,
    p_actor_id,
    p_actor_role,
    v_row.id,
    null,
    jsonb_build_object('requestType', v_row.request_type, 'status', v_row.status),
    null,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'id', v_row.id);
end;
$$;

create or replace function public.complete_salon_customer_data_request(
  p_studio_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_status text,
  p_staff_note text,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.salon_customer_data_requests;
begin
  if p_status not in ('completed', 'rejected') then
    raise exception 'invalid data request close status %', p_status using errcode = '22023';
  end if;
  if nullif(trim(coalesce(p_staff_note, '')), '') is null then
    raise exception 'staff note is required to close a data request' using errcode = '22023';
  end if;

  select *
  into v_row
  from public.salon_customer_data_requests
  where id = p_request_id
    and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'data request % not found in studio %', p_request_id, p_studio_id
      using errcode = 'P0002';
  end if;

  perform public.crm01_assert_actor_scope(
    p_studio_id,
    v_row.salon_customer_id,
    p_actor_id,
    p_actor_role,
    coalesce(p_location_id, v_row.location_id)
  );

  if v_row.status <> 'open' then
    raise exception 'data request % is already closed', p_request_id using errcode = '42501';
  end if;

  update public.salon_customer_data_requests
  set status = p_status,
      staff_note = trim(p_staff_note),
      completed_at = now(),
      completed_by = p_actor_id
  where id = v_row.id
  returning * into v_row;

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    v_row.salon_customer_id,
    p_actor_id,
    p_actor_role,
    'data_request_update',
    coalesce(p_location_id, v_row.location_id),
    null,
    jsonb_build_object('requestId', v_row.id, 'requestType', v_row.request_type, 'status', v_row.status)
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_data_request_closed',
    'salon_customer_data_requests',
    'user',
    coalesce(p_location_id, v_row.location_id),
    p_actor_id,
    p_actor_role,
    v_row.id,
    jsonb_build_object('status', 'open'),
    jsonb_build_object('status', v_row.status, 'requestType', v_row.request_type),
    null,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status);
end;
$$;

create or replace function public.anonymize_salon_customer(
  p_studio_id uuid,
  p_salon_customer_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer public.salon_customers;
  v_had_email boolean;
  v_had_phone boolean;
  v_had_user boolean;
begin
  perform public.cmp01_assert_privacy_publisher(p_studio_id, p_actor_id, p_actor_role);
  perform public.crm01_assert_actor_scope(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    p_location_id
  );

  select *
  into v_customer
  from public.salon_customers
  where id = p_salon_customer_id
    and studio_id = p_studio_id
  for update;

  if not found then
    raise exception 'customer % does not belong to studio %', p_salon_customer_id, p_studio_id
      using errcode = '23514';
  end if;

  if v_customer.anonymized_at is not null then
    raise exception 'customer % is already anonymized', p_salon_customer_id using errcode = '42501';
  end if;

  v_had_email := v_customer.email is not null;
  v_had_phone := v_customer.phone is not null;
  v_had_user := v_customer.user_id is not null;

  update public.salon_customers
  set full_name = 'Anonymized',
      email = null,
      phone = null,
      user_id = null,
      status = 'inactive',
      anonymized_at = now()
  where id = p_salon_customer_id
    and studio_id = p_studio_id;

  update public.salon_customer_preferences
  set preferred_services = null,
      preferred_employee_ids = '{}',
      preferred_location_ids = '{}',
      preferred_time_slots = '{}',
      communication_language = null,
      product_preferences = null,
      environment_preferences = null,
      contact_preference = null,
      notes = null,
      updated_by = p_actor_id
  where studio_id = p_studio_id
    and salon_customer_id = p_salon_customer_id;

  update public.salon_customer_health_profiles
  set allergies = null,
      reaction_ingredients = null,
      reaction_products = null,
      declared_health_conditions = null,
      service_affecting_conditions = null,
      contraindications = null,
      patch_test_required = false,
      patch_test_date = null,
      patch_test_result = null,
      last_confirmed_at = null,
      updated_by = p_actor_id
  where studio_id = p_studio_id
    and salon_customer_id = p_salon_customer_id;

  insert into public.salon_customer_consents (
    studio_id, salon_customer_id, consent_key, channel, status, source,
    text_version, evidence, actor_id, actor_role, location_id
  ) values
    (p_studio_id, p_salon_customer_id, 'email_marketing', 'email', 'withdrawn', 'system',
     'anonymize', jsonb_build_object('reason', 'anonymize'), p_actor_id, p_actor_role, p_location_id),
    (p_studio_id, p_salon_customer_id, 'privacy_notice', 'web', 'withdrawn', 'system',
     'anonymize', jsonb_build_object('reason', 'anonymize'), p_actor_id, p_actor_role, p_location_id);

  perform public.record_salon_customer_access_audit(
    p_studio_id,
    p_salon_customer_id,
    p_actor_id,
    p_actor_role,
    'data_request_update',
    p_location_id,
    'anonymize',
    jsonb_build_object('anonymized', true)
  );

  perform public.record_strong_audit(
    p_studio_id,
    'salon_customer_anonymized',
    'salon_customers',
    'user',
    p_location_id,
    p_actor_id,
    p_actor_role,
    p_salon_customer_id,
    jsonb_build_object('hadEmail', v_had_email, 'hadPhone', v_had_phone, 'hadUserId', v_had_user, 'status', v_customer.status),
    jsonb_build_object('anonymized', true, 'status', 'inactive'),
    null,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'id', p_salon_customer_id);
end;
$$;

create or replace function public.mark_salon_appointment_retention_reviewed(
  p_studio_id uuid,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_customer_id uuid;
  v_location_id uuid;
begin
  perform public.cmp01_assert_privacy_publisher(p_studio_id, p_actor_id, p_actor_role);

  if to_regclass('public.salon_appointments') is null then
    raise exception 'salon_appointments is not available' using errcode = '42P01';
  end if;

  execute
    'update public.salon_appointments
     set retention_reviewed_at = now()
     where id = $1
       and studio_id = $2
       and retention_reviewed_at is null
     returning salon_customer_id, location_id'
  into v_customer_id, v_location_id
  using p_appointment_id, p_studio_id;

  if v_customer_id is null then
    raise exception 'appointment % not found or already reviewed', p_appointment_id
      using errcode = 'P0002';
  end if;

  perform public.record_strong_audit(
    p_studio_id,
    'salon_appointment_retention_reviewed',
    'salon_appointments',
    'user',
    v_location_id,
    p_actor_id,
    p_actor_role,
    p_appointment_id,
    null,
    jsonb_build_object('reviewed', true),
    null,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'id', p_appointment_id);
end;
$$;

revoke all on function public.cmp01_assert_privacy_publisher(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cmp01_assert_privacy_publisher(uuid, uuid, text) to service_role;

revoke all on function public.publish_salon_privacy_notice(uuid, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.publish_salon_privacy_notice(uuid, uuid, text, text, text, jsonb) to service_role;

revoke all on function public.record_salon_customer_privacy_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_salon_customer_privacy_consent(uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz, uuid, text, uuid, uuid) to service_role;

revoke all on function public.create_salon_customer_data_request(uuid, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_salon_customer_data_request(uuid, uuid, uuid, text, text, text, uuid) to service_role;

revoke all on function public.complete_salon_customer_data_request(uuid, uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.complete_salon_customer_data_request(uuid, uuid, uuid, text, text, text, uuid) to service_role;

revoke all on function public.anonymize_salon_customer(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.anonymize_salon_customer(uuid, uuid, uuid, text, uuid) to service_role;

revoke all on function public.mark_salon_appointment_retention_reviewed(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_salon_appointment_retention_reviewed(uuid, uuid, uuid, text) to service_role;

revoke all on function public.prevent_mutate_salon_privacy_notice_versions() from public, anon, authenticated;
grant execute on function public.prevent_mutate_salon_privacy_notice_versions() to service_role;

revoke all on function public.cmp01_validate_data_request_scope() from public, anon, authenticated;
grant execute on function public.cmp01_validate_data_request_scope() to service_role;

revoke all on function public.prevent_closed_salon_customer_data_request_mutation() from public, anon, authenticated;
grant execute on function public.prevent_closed_salon_customer_data_request_mutation() to service_role;
