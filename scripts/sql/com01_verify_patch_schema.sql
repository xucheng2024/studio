create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

create table if not exists public.staff_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_staff_memberships_user_studio
  on public.staff_memberships (user_id, studio_id, is_active);

alter table public.studios
  add column if not exists owner_id uuid references public.users(id) on delete set null;

alter table public.employees
  add column if not exists user_id uuid references public.users(id) on delete set null;

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

