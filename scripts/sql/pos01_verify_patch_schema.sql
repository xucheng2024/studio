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

