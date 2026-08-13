-- PKG-01 verification patch schema for legacy-minimal test harness.

alter table public.packages
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists credits integer not null default 1,
  add column if not exists expiry_days integer;

create table if not exists public.client_packages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.users(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete cascade,
  credits_left integer not null check (credits_left >= 0),
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  package_name_snapshot text,
  package_credits_snapshot integer,
  package_expiry_days_snapshot integer
);

create index if not exists idx_client_packages_client_created
  on public.client_packages (client_id, created_at desc);

create index if not exists idx_client_packages_package_created
  on public.client_packages (package_id, created_at desc);

alter table public.payments
  add column if not exists manual_refund_recorded_at timestamptz,
  add column if not exists manual_refund_recorded_by uuid references public.users(id) on delete set null,
  add column if not exists manual_refund_reference text,
  add column if not exists gateway_status text;
