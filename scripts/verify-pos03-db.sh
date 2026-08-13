#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-pos03-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-pos03-db" >&2
  exit 1
fi

PORT="${POS03_VERIFY_DB_PORT:-55440}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/pos03_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pos03_verify -p "${PORT}:5432" postgres:15)"
cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d pos03_verify >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/pos03_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_verify_patch_schema.sql >/tmp/pos03_pos01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/pos03_pos01_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql >/tmp/pos03_pos01_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813023000_pos01_lock_hard_validation.sql >/tmp/pos03_pos01_batch5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_e2e_payments_stub.sql >/tmp/pos03_payments_stub.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813033000_pos01_payment_link_and_source.sql >/tmp/pos03_pos01_batch6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813050000_pos02_cash_receipt_number.sql >/tmp/pos03_pos02_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813103000_pos03_hitpay_complete_rpc.sql >/tmp/pos03_migration_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pos03_hitpay_webhook.sql | tee /tmp/pos03_verify.log

echo "verify-pos03-db: ok"

