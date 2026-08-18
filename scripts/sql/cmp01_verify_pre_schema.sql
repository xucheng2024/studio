create table if not exists public.salon_appointments (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete restrict,
  location_id uuid references public.locations(id) on delete restrict,
  salon_customer_id uuid not null references public.salon_customers(id) on delete restrict,
  starts_at timestamptz not null default now(),
  status text not null default 'completed',
  service_title_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
