#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-apt05-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-apt05-db" >&2
  exit 1
fi

PORT="${APT05_VERIFY_DB_PORT:-55435}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/apt05_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=apt05_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d apt05_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/apt05_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/apt05_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql >/tmp/apt05_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql >/tmp/apt05_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql >/tmp/apt05_m4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/apt05_m5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql >/tmp/apt05_m6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812230000_apt05_appointment_email_notifications.sql >/tmp/apt05_m7.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812235000_apt05_manual_retry_rpc.sql >/tmp/apt05_m8.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_apt05_notification_queue.sql | tee /tmp/apt05_verify.log

echo "verify-apt05-db: ok"
