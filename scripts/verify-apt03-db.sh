#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-apt03-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-apt03-db" >&2
  exit 1
fi

PORT="${APT03_VERIFY_DB_PORT:-55434}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/apt03_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=apt03_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d apt03_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/apt03_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/apt03_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql >/tmp/apt03_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql >/tmp/apt03_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql >/tmp/apt03_m4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/apt03_m5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql >/tmp/apt03_m6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_apt03_calendar_and_status.sql | tee /tmp/apt03_verify.log

echo "verify-apt03-db: ok"
