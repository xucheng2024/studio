create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

alter table public.studios
  add column if not exists owner_id uuid references public.users(id) on delete set null;

create table if not exists public.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null references public.studios(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  role text not null check (role = any (array['owner'::text, 'manager'::text, 'frontdesk'::text, 'instructor'::text])),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_products (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.packages (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.salon_appointments (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  salon_customer_id uuid references public.salon_customers(id) on delete set null,
  service_id uuid references public.studio_services(id) on delete set null,
  employee_id uuid references public.employees(id) on delete set null,
  status text not null default 'confirmed',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null default (now() + interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
