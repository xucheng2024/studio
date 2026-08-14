#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-com01-db" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-com01-db" >&2
  exit 1
fi

PORT="${COM01_VERIFY_DB_PORT:-55446}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/com01_verify"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=com01_verify -p "${PORT}:5432" postgres:15)"
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
  echo "verify-com01-db: postgres did not become ready" >&2
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/com01_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/com01_verify_patch_schema.sql >/tmp/com01_patch_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811140130_fnd04_audit_idempotency_foundation.sql >/tmp/com01_fnd04.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/com01_apt01_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql >/tmp/com01_apt01_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql >/tmp/com01_apt01_batch3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql >/tmp/com01_apt01_batch4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/com01_apt02.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812102000_apt03_backoffice_calendar_status.sql >/tmp/com01_apt03.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813001000_pos01_sale_fact_skeleton.sql >/tmp/com01_pos01_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813013000_pos01_write_rpcs_idempotency_audit_rls.sql >/tmp/com01_pos01_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813023000_pos01_lock_hard_validation.sql >/tmp/com01_pos01_batch5.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/pos01_e2e_payments_stub.sql >/tmp/com01_payments_stub.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/com01_payments_refund_patch.sql >/tmp/com01_payments_refund_patch.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813033000_pos01_payment_link_and_source.sql >/tmp/com01_pos01_batch6.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813043000_pos02_cash_complete_rpc.sql >/tmp/com01_pos02_batch1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813050000_pos02_cash_receipt_number.sql >/tmp/com01_pos02_batch2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813103000_pos03_hitpay_complete_rpc.sql >/tmp/com01_pos03.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260813180000_pos04_refund_items_rpc.sql >/tmp/com01_pos04_batch2.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814100000_com01_commission_foundation.sql >/tmp/com01_migration.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814110000_com01_fixes_p1_p2.sql >/tmp/com01_fix_migration.log

# migration rerun safety (idempotent apply)
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814100000_com01_commission_foundation.sql >/tmp/com01_migration_rerun.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260814110000_com01_fixes_p1_p2.sql >/tmp/com01_fix_migration_rerun.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_com01_commission.sql | tee /tmp/com01_verify.log

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/verify_com01_concurrency_setup.sql >/tmp/com01_concurrency_setup.log

# Deterministic two-connection lock contention test (payment vs fulfill).
# Conn A: lock payment row first (real HitPay order), then execute payment completion.
# Conn B: start fulfill while A holds payment lock (must wait, not deadlock).
(
  psql "${DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
set statement_timeout = '20s';
begin;

select p.id
from public.payments p
where p.reference_code = 'COM01-CONC-REF'
limit 1
for update;

select pg_sleep(1);

select public.complete_pos_hitpay_sale(
  p_studio_id := 'e1000000-0000-0000-0000-000000000001'::uuid,
  p_payment_id := (
    select id
    from public.payments
    where reference_code = 'COM01-CONC-REF'
    limit 1
  ),
  p_sale_id := (
    select id
    from public.pos_sales
    where note = 'COM01 concurrency deadlock test'
    order by created_at desc
    limit 1
  ),
  p_provider_event_id := null,
  p_gateway_payment_id := 'hp-com01-conc',
  p_gateway_status := 'succeeded',
  p_gateway_payload := '{}',
  p_verified_by := 'e1000000-0000-0000-0000-000000000101'::uuid
);

commit;
SQL
) >/tmp/com01_concurrency_payment.log 2>&1 &
PID_A=$!

sleep 0.2

(
  psql "${DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
set statement_timeout = '20s';
select public.com01_mark_pos_service_item_fulfilled(
  p_actor_id := 'e1000000-0000-0000-0000-000000000101'::uuid,
  p_actor_role := 'owner',
  p_studio_id := 'e1000000-0000-0000-0000-000000000001'::uuid,
  p_sale_item_id := (
    select i.id
    from public.pos_sale_items i
    join public.pos_sales s on s.id = i.sale_id
    where s.note = 'COM01 concurrency deadlock test'
    order by i.created_at desc
    limit 1
  ),
  p_fulfilled_at := now(),
  p_fulfillment_note := 'concurrency test fulfill',
  p_idempotency_key := 'com01-concurrency-fulfill',
  p_request_hash := encode(digest('com01-concurrency-fulfill', 'sha256'), 'hex')
);
SQL
) >/tmp/com01_concurrency_fulfill.log 2>&1 &
PID_B=$!

wait "${PID_A}"
wait "${PID_B}"

psql "${DB_URL}" -v ON_ERROR_STOP=1 <<'SQL' >/tmp/com01_concurrency_assert.log
do $$
declare
  v_item_id uuid;
  v_earned_count integer;
begin
  select i.id
    into v_item_id
  from public.pos_sale_items i
  join public.pos_sales s on s.id = i.sale_id
  where s.note = 'COM01 concurrency deadlock test'
  order by i.created_at desc
  limit 1;

  select count(*)::integer
    into v_earned_count
  from public.service_commission_entries e
  where e.pos_sale_item_id = v_item_id
    and e.entry_type = 'earned';

  if v_earned_count <> 1 then
    raise exception 'concurrency test expected one earned entry, got %', v_earned_count;
  end if;
end;
$$;
SQL

echo "verify-com01-db: ok"
