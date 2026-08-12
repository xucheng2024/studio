#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for verify-apt02-concurrency" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for verify-apt02-concurrency" >&2
  exit 1
fi

PORT="${APT02_CONCURRENCY_DB_PORT:-55434}"
DB_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/apt02_concurrency"
RUN_ID="$(date +%s%N)"
CID="$(docker run -d -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=apt02_concurrency -p "${PORT}:5432" postgres:15)"

cleanup() {
  docker rm -f "${CID}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..60}; do
  if docker exec "${CID}" pg_isready -U postgres -d apt02_concurrency >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/apt02_minimal_pre_schema.sql >/tmp/apt02_conc_pre_schema.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811145810_apt01_service_availability_resources.sql >/tmp/apt02_conc_m1.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811233000_apt01_atomic_batch_rpcs.sql >/tmp/apt02_conc_m2.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811234500_apt01_exception_assignment_guard.sql >/tmp/apt02_conc_m3.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260812003000_apt01_hardening_batch_and_rpc.sql >/tmp/apt02_conc_m4.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/apt02_conc_m5_first.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f supabase/migrations/20260811170339_apt02_salon_appointment_atomic_foundation.sql >/tmp/apt02_conc_m5_second.log
psql "${DB_URL}" -v ON_ERROR_STOP=1 -f scripts/sql/seed_apt02_concurrency.sql >/tmp/apt02_conc_seed.log

run_create() {
  local label="$1"
  local employee_id="$2"
  local starts_at="$3"
  local resource_a="$4"
  local resource_b="$5"
  local note="$6"
  local sql_file="/tmp/apt02_conc_${label}.sql"
  local log_file="/tmp/apt02_conc_${label}.log"

  cat >"${sql_file}" <<SQL
\\set ON_ERROR_STOP on
select public.create_salon_appointment(
  '91111111-1111-1111-1111-111111111111',
  'owner',
  '11111111-1111-1111-1111-111111111111',
  '21111111-1111-1111-1111-111111111111',
  '41111111-1111-1111-1111-111111111111',
  '31111111-1111-1111-1111-111111111111',
  '${employee_id}',
  '${starts_at}',
  array['${resource_a}'::uuid, '${resource_b}'::uuid],
  null,
  null,
  null,
  null,
  null,
  null,
  '${note}',
  null
) as result;
SQL

  psql "${DB_URL}" -f "${sql_file}" >"${log_file}" 2>&1
}

# ── Test 1: same slot + same resources in parallel => exactly one success ──
T1_SLOT="2026-08-17 02:00:00+00"
T1_NOTE_A="APT02-CONC-T1-A-${RUN_ID}"
T1_NOTE_B="APT02-CONC-T1-B-${RUN_ID}"

set +e
run_create "t1_a" "51111111-1111-1111-1111-111111111111" "${T1_SLOT}" "61111111-1111-1111-1111-111111111111" "61222222-2222-2222-2222-222222222222" "${T1_NOTE_A}" &
PID1=$!
run_create "t1_b" "52222222-2222-2222-2222-222222222222" "${T1_SLOT}" "61111111-1111-1111-1111-111111111111" "61222222-2222-2222-2222-222222222222" "${T1_NOTE_B}" &
PID2=$!
wait ${PID1}; RC1=$?
wait ${PID2}; RC2=$?
set -e

if ! { [ "${RC1}" -eq 0 ] && [ "${RC2}" -ne 0 ]; } && ! { [ "${RC2}" -eq 0 ] && [ "${RC1}" -ne 0 ]; }; then
  echo "test-1 expected exactly one success and one failure, got RC1=${RC1}, RC2=${RC2}" >&2
  echo "--- t1_a log ---" >&2
  cat /tmp/apt02_conc_t1_a.log >&2 || true
  echo "--- t1_b log ---" >&2
  cat /tmp/apt02_conc_t1_b.log >&2 || true
  exit 1
fi

if [ "${RC1}" -ne 0 ] && ! rg -q "23P01|exclusion constraint|conflict" /tmp/apt02_conc_t1_a.log; then
  echo "test-1 expected occupancy conflict in t1_a failure log" >&2
  cat /tmp/apt02_conc_t1_a.log >&2 || true
  exit 1
fi
if [ "${RC2}" -ne 0 ] && ! rg -q "23P01|exclusion constraint|conflict" /tmp/apt02_conc_t1_b.log; then
  echo "test-1 expected occupancy conflict in t1_b failure log" >&2
  cat /tmp/apt02_conc_t1_b.log >&2 || true
  exit 1
fi

# ── Test 2: same slot + different resources in parallel => both success ─────
T2_SLOT="2026-08-17 06:00:00+00"
T2_NOTE_A="APT02-CONC-T2-A-${RUN_ID}"
T2_NOTE_B="APT02-CONC-T2-B-${RUN_ID}"

set +e
run_create "t2_a" "51111111-1111-1111-1111-111111111111" "${T2_SLOT}" "61111111-1111-1111-1111-111111111111" "61222222-2222-2222-2222-222222222222" "${T2_NOTE_A}" &
PID3=$!
run_create "t2_b" "52222222-2222-2222-2222-222222222222" "${T2_SLOT}" "61333333-3333-3333-3333-333333333333" "61444444-4444-4444-4444-444444444444" "${T2_NOTE_B}" &
PID4=$!
wait ${PID3}; RC3=$?
wait ${PID4}; RC4=$?
set -e

if [ "${RC3}" -ne 0 ] || [ "${RC4}" -ne 0 ]; then
  echo "test-2 expected both successes, got RC3=${RC3}, RC4=${RC4}" >&2
  echo "--- t2_a log ---" >&2
  cat /tmp/apt02_conc_t2_a.log >&2 || true
  echo "--- t2_b log ---" >&2
  cat /tmp/apt02_conc_t2_b.log >&2 || true
  exit 1
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 -v run_id="${RUN_ID}" -f scripts/sql/verify_apt02_concurrency_assertions.sql | tee /tmp/apt02_concurrency_assertions.log

echo "verify-apt02-concurrency: ok"
