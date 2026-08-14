#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-pkg02-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-pkg02-db" >&2
  exit 1
fi

PORT="${PKG02_VERIFY_DB_PORT:-55442}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/pkg02_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pkg02_verify -p "${PORT}:5432" postgres:15)"
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
  echo "verify-pkg02-db: postgres did not become ready" >&2
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/pkg02_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_verify_patch_schema.sql >/tmp/pkg02_pos01_patch_schema.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/pkg02_pos01_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql >/tmp/pkg02_pos01_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813023000_pos01_lock_hard_validation.sql >/tmp/pkg02_pos01_batch5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_e2e_payments_stub.sql >/tmp/pkg02_payments_stub.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pkg01_verify_patch_schema.sql >/tmp/pkg02_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813033000_pos01_payment_link_and_source.sql >/tmp/pkg02_pos01_batch6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813043000_pos02_cash_complete_rpc.sql >/tmp/pkg02_pos02_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813050000_pos02_cash_receipt_number.sql >/tmp/pkg02_pos02_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813180000_pos04_refund_items_rpc.sql >/tmp/pkg02_pos04_batch2.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814001000_pkg01_package_ledger_foundation.sql >/tmp/pkg02_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814002000_pkg01_pos_package_grant_refund_linkage.sql >/tmp/pkg02_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814003000_pkg01_opening_balance_backfill.sql >/tmp/pkg02_batch3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814004000_pkg01_deferred_value_view_rpc.sql >/tmp/pkg02_batch4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814005000_pkg01_deferred_value_summary_rpc.sql >/tmp/pkg02_batch5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814006000_pkg02_partial_package_refund_reversal.sql >/tmp/pkg02_batch6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814007000_pkg02_guest_identity_grant_queue.sql >/tmp/pkg02_batch7.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814008000_pkg02_maker_checker_approval_foundation.sql >/tmp/pkg02_batch8.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814009000_pkg02_ops_check_runs.sql >/tmp/pkg02_batch9.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pkg01_pos_minimal.sql | tee /tmp/pkg02_verify.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pkg02_partial_refund_reversal.sql | tee -a /tmp/pkg02_verify.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pkg02_guest_identity_queue.sql | tee -a /tmp/pkg02_verify.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_pkg02_maker_checker_approval.sql | tee -a /tmp/pkg02_verify.log

echo "verify-pkg02-db: ok"
