#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-pos01-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-pos01-db" >&2
  exit 1
fi

PORT="${POS01_VERIFY_DB_PORT:-55437}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/pos01_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pos01_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d pos01_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/pos01_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_verify_patch_schema.sql >/tmp/pos01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/pos01_migration.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pos01_sale_fact_skeleton.sql | tee /tmp/pos01_verify.log

echo "verify-pos01-db: ok"

