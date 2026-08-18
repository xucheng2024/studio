#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-cmp01-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-cmp01-db" >&2
  exit 1
fi

PORT="${CMP01_VERIFY_DB_PORT:-55436}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/cmp01_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cmp01_verify -p "${PORT}:5432" postgres:15)"
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
  echo "verify-cmp01-db: postgres did not become ready" >&2
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/cmp01_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/crm01_verify_patch_schema.sql >/tmp/cmp01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/cmp01_verify_pre_schema.sql >/tmp/cmp01_appointments.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql >/tmp/cmp01_fnd04.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812132000_crm01_sensitive_customer_data.sql >/tmp/cmp01_crm01.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812193000_crm01_actor_role_scope_alignment.sql >/tmp/cmp01_role.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818210000_cmp01_pdpa_privacy_controls.sql >/tmp/cmp01_migration.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260818210000_cmp01_pdpa_privacy_controls.sql >/tmp/cmp01_migration_rerun.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_cmp01_pdpa_controls.sql | tee /tmp/cmp01_verify.log

echo "verify-cmp01-db: ok"
