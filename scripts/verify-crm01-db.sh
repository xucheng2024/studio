#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-crm01-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-crm01-db" >&2
  exit 1
fi

PORT="${CRM01_VERIFY_DB_PORT:-55435}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/crm01_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=crm01_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d crm01_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/crm01_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/crm01_verify_patch_schema.sql >/tmp/crm01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql >/tmp/crm01_fnd04.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812132000_crm01_sensitive_customer_data.sql >/tmp/crm01_migration.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812193000_crm01_actor_role_scope_alignment.sql >/tmp/crm01_role_alignment.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_crm01_sensitive_customer_data.sql | tee /tmp/crm01_verify.log

echo "verify-crm01-db: ok"
