#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-crm02-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-crm02-db" >&2
  exit 1
fi

PORT="${CRM02_VERIFY_DB_PORT:-55436}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/crm02_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=crm02_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d crm02_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/crm02_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/crm01_verify_patch_schema.sql >/tmp/crm02_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql >/tmp/crm02_fnd04.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/crm02_apt01_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql >/tmp/crm02_apt01_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql >/tmp/crm02_apt01_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql >/tmp/crm02_apt01_m4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/crm02_apt02.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql >/tmp/crm02_apt03.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812132000_crm01_sensitive_customer_data.sql >/tmp/crm02_crm01.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812193000_crm01_actor_role_scope_alignment.sql >/tmp/crm02_crm01_align.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812213000_crm02_treatment_follow_up.sql >/tmp/crm02_migration.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_crm02_treatment_follow_up.sql | tee /tmp/crm02_verify.log

echo "verify-crm02-db: ok"
