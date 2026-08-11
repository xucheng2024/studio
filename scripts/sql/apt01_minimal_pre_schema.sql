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

create table if not exists public.studios (
  id uuid primary key,
  contract_status text not null default 'active'
);

create table if not exists public.locations (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null default 'Location',
  is_active boolean not null default true
);

create table if not exists public.studio_services (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null default 'Service',
  price numeric(10,2) not null default 0,
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
