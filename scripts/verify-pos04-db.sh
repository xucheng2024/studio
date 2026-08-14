#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-pos04-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-pos04-db" >&2
  exit 1
fi

PORT="${POS04_VERIFY_DB_PORT:-55443}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/pos04_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pos04_verify -p "${PORT}:5432" postgres:15)"
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
  echo "verify-pos04-db: postgres did not become ready" >&2
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/pos04_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_verify_patch_schema.sql >/tmp/pos04_pos01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/pos04_pos01_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql >/tmp/pos04_pos01_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813023000_pos01_lock_hard_validation.sql >/tmp/pos04_pos01_batch5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_e2e_payments_stub.sql >/tmp/pos04_payments_stub.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813033000_pos01_payment_link_and_source.sql >/tmp/pos04_pos01_batch6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813043000_pos02_cash_complete_rpc.sql >/tmp/pos04_pos02_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813050000_pos02_cash_receipt_number.sql >/tmp/pos04_pos02_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813142000_pos04_void_sale_rpc.sql >/tmp/pos04_batch1_void.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813145500_pos04_sync_sale_refund_status.sql >/tmp/pos04_batch1_refund_sync.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813153000_pos04_operation_failures_observability.sql >/tmp/pos04_batch1_observability.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813180000_pos04_refund_items_rpc.sql >/tmp/pos04_batch2_refund_items.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pos04_partial_refund.sql | tee /tmp/pos04_verify.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813193000_pos04_cash_sessions_foundation.sql >/tmp/pos04_batch3_foundation.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813194500_pos04_cash_session_open_close_rpcs.sql >/tmp/pos04_batch3_open_close.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813200000_pos04_bind_cash_sale_to_session.sql >/tmp/pos04_batch3_cash_binding.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pos04_cash_sessions.sql | tee -a /tmp/pos04_verify.log

echo "verify-pos04-db: ok"
