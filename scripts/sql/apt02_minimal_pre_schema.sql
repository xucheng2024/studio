create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

create table if not exists public.users (
  id uuid primary key,
  email text
);

create table if not exists public.studios (
  id uuid primary key,
  contract_status text not null default 'active'
);

create table if not exists public.locations (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null default 'Location',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_services (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null default 'Service',
  price numeric(12,2) not null default 0,
  currency text not null default 'SGD',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  display_name text not null default 'Employee',
  employment_status text not null default 'active',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_locations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_locations (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  service_id uuid not null references public.studio_services(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  is_enabled boolean not null default true,
  uses_default_values boolean not null default true,
  duration_override_minutes integer,
  buffer_override_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, location_id)
);

create table if not exists public.salon_customers (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  status text not null default 'active',
  source text not null default 'frontdesk',
  preferred_location_id uuid references public.locations(id) on delete set null,
  merged_into_id uuid references public.salon_customers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.strong_audit_logs (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid,
  location_id uuid,
  actor_type text,
  actor_id uuid,
  actor_role text,
  action text,
  target_type text,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  correlation_id text,
  idempotency_key_id uuid,
  provider_event_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.business_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  operation_scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'processing',
  claim_token uuid not null default gen_random_uuid(),
  attempt_count integer not null default 1,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  retryable boolean not null default true,
  error_summary text,
  result_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (studio_id, operation_scope, idempotency_key)
);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.record_strong_audit(
  p_studio_id uuid,
  p_action text,
  p_target_type text,
  p_actor_type text default 'system',
  p_location_id uuid default null,
  p_actor_id uuid default null,
  p_actor_role text default null,
  p_target_id uuid default null,
  p_before_state jsonb default null,
  p_after_state jsonb default null,
  p_correlation_id text default null,
  p_idempotency_key_id uuid default null,
  p_provider_event_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into public.strong_audit_logs (
    id, studio_id, location_id, actor_type, actor_id, actor_role, action, target_type, target_id,
    before_state, after_state, correlation_id, idempotency_key_id, provider_event_id
  )
  values (
    v_id, p_studio_id, p_location_id, p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id,
    p_before_state, p_after_state, p_correlation_id, p_idempotency_key_id, p_provider_event_id
  );

  return v_id;
end;
$$;

create or replace function public.claim_business_idempotency_key(
  p_studio_id uuid,
  p_operation_scope text,
  p_idempotency_key text,
  p_request_hash text,
  p_stale_after_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inserted_id uuid;
  v_row public.business_idempotency_keys%rowtype;
begin
  insert into public.business_idempotency_keys (
    studio_id,
    operation_scope,
    idempotency_key,
    request_hash,
    status,
    attempt_count,
    claimed_at,
    claim_token
  )
  values (
    p_studio_id,
    p_operation_scope,
    p_idempotency_key,
    p_request_hash,
    'processing',
    1,
    now(),
    gen_random_uuid()
  )
  on conflict (studio_id, operation_scope, idempotency_key) do nothing
  returning id into v_inserted_id;

  if v_inserted_id is not null then
    select * into v_row from public.business_idempotency_keys where id = v_inserted_id;
    return jsonb_build_object(
      'ok', true,
      'outcome', 'claimed',
      'id', v_row.id,
      'claimToken', v_row.claim_token,
      'attemptCount', v_row.attempt_count
    );
  end if;

  select * into v_row
  from public.business_idempotency_keys
  where studio_id = p_studio_id
    and operation_scope = p_operation_scope
    and idempotency_key = p_idempotency_key
  for update;

  if v_row.request_hash <> p_request_hash then
    return jsonb_build_object('ok', false, 'outcome', 'hash_conflict', 'id', v_row.id);
  end if;

  if v_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'outcome', 'already_completed', 'id', v_row.id, 'result', v_row.result_snapshot);
  end if;

  if v_row.status = 'processing' and v_row.claimed_at >= now() - make_interval(secs => greatest(1, p_stale_after_seconds)) then
    return jsonb_build_object('ok', true, 'outcome', 'in_progress', 'id', v_row.id);
  end if;

  update public.business_idempotency_keys
  set status = 'processing',
      claim_token = gen_random_uuid(),
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      failed_at = null,
      error_summary = null
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'id', v_row.id,
    'claimToken', v_row.claim_token,
    'attemptCount', v_row.attempt_count
  );
end;
$$;

create or replace function public.complete_business_idempotency_key(
  p_id uuid,
  p_claim_token uuid,
  p_result_snapshot jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.business_idempotency_keys
  set status = 'completed',
      result_snapshot = p_result_snapshot,
      completed_at = now()
  where id = p_id
    and status = 'processing'
    and claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fail_business_idempotency_key(
  p_id uuid,
  p_claim_token uuid,
  p_error_summary text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.business_idempotency_keys
  set status = 'failed',
      retryable = p_retryable,
      error_summary = p_error_summary,
      failed_at = now()
  where id = p_id
    and status = 'processing'
    and claim_token = p_claim_token;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_current_claim');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;
