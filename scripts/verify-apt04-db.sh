#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-apt04-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-apt04-db" >&2
  exit 1
fi

PORT="${APT04_VERIFY_DB_PORT:-55445}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/apt04_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=apt04_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

db_ready=false
for _ in {1..60}; do
  readiness_count="$(docker logs "${CID}" 2>&1 | awk '/database system is ready to accept connections/{count++} END{print count+0}')"
  if (( readiness_count >= 2 )) && psql "${DB_URL}" -Atqc 'select 1' >/dev/null 2>&1; then
    db_ready=true
    break
  fi
  sleep 1
done

if [[ "${db_ready}" != "true" ]]; then
  echo "verify-apt04-db: postgres did not become ready" >&2
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/apt04_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 <<'SQL' >/tmp/apt04_pos_pkg_pre.log
create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid
$$;

create table if not exists public.packages (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  name text not null,
  credits integer not null default 1,
  price numeric(12,2) not null default 0,
  expiry_days integer,
  location_id uuid references public.locations(id) on delete set null,
  type text not null default 'class_pack',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_packages (
  id uuid primary key,
  client_id uuid not null references public.users(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete cascade,
  credits_left integer not null default 0,
  expiry_date timestamptz,
  created_at timestamptz not null default now(),
  package_name_snapshot text,
  package_credits_snapshot integer,
  package_expiry_days_snapshot integer
);

create table if not exists public.shop_products (
  id uuid primary key,
  studio_id uuid not null references public.studios(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  name text not null default 'stub-product',
  stock integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid references public.studios(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  client_id uuid references public.users(id) on delete set null,
  amount numeric(12,2) not null default 0,
  type text not null default 'single',
  status text not null default 'pending',
  remaining_uses integer not null default 0,
  created_at timestamptz not null default now(),
  booking_id uuid,
  package_id uuid references public.packages(id) on delete set null,
  currency text not null default 'SGD',
  payment_method text not null default 'hitpay',
  reference_code text,
  expires_at timestamptz,
  paid_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  gateway_payment_id text,
  gateway_checkout_url text,
  gateway_status text,
  gateway_payload text,
  gateway_refund_payment_id text,
  source text not null default 'online_booking',
  sales_channel text not null default 'online',
  service_id uuid references public.studio_services(id) on delete set null,
  service_title_snapshot text
);
SQL
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql >/tmp/apt04_fnd04.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/apt04_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/apt04_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/apt04_pos01_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813033000_pos01_payment_link_and_source.sql >/tmp/apt04_pos01_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814001000_pkg01_package_ledger_foundation.sql >/tmp/apt04_pkg01_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814002000_pkg01_pos_package_grant_refund_linkage.sql >/tmp/apt04_pkg01_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814193000_apt04_customer_self_booking_actor.sql >/tmp/apt04_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814203000_apt04_align_studio_service_title.sql >/tmp/apt04_m4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814220000_apt04_phase2_self_booking_settlement.sql >/tmp/apt04_m5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_apt04_self_booking.sql | tee /tmp/apt04_verify.log

echo "verify-apt04-db: ok"
