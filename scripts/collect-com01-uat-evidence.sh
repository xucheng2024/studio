#!/usr/bin/env bash
set -euo pipefail
umask 077

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 1
fi

if [[ -z "${COM01_UAT_DB_URL:-}" ]]; then
  echo "COM01_UAT_DB_URL is required" >&2
  echo "Example: COM01_UAT_DB_URL='postgresql://...' COM01_UAT_RUN_ID='COM01-UAT-20260814' bash scripts/collect-com01-uat-evidence.sh" >&2
  exit 1
fi

if [[ -z "${COM01_UAT_RUN_ID:-}" ]]; then
  echo "COM01_UAT_RUN_ID is required (example: COM01-UAT-20260814)" >&2
  exit 1
fi

case "${COM01_DB_CLASSIFICATION:-}" in
  uat)
    ;;
  production)
    if [[ "${COM01_ALLOW_PRODUCTION_READONLY:-}" != "YES" ]]; then
      echo "Production read-only evidence collection requires COM01_ALLOW_PRODUCTION_READONLY=YES" >&2
      exit 1
    fi
    ;;
  *)
    echo "COM01_DB_CLASSIFICATION must be 'uat' or 'production'" >&2
    exit 1
    ;;
esac

OUT_DIR="${COM01_UAT_OUT_DIR:-tmp/com01-uat/${COM01_UAT_RUN_ID}}"
mkdir -p "${OUT_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="${OUT_DIR}/db-evidence-${STAMP}.txt"

psql "${COM01_UAT_DB_URL}" \
  -v ON_ERROR_STOP=1 \
  -v run_id="${COM01_UAT_RUN_ID}" \
  -f scripts/sql/com01_uat_evidence_pack.sql \
  >"${REPORT_FILE}"

cat <<EOF
COM-01 UAT evidence exported:
- run_id: ${COM01_UAT_RUN_ID}
- database_classification: ${COM01_DB_CLASSIFICATION}
- file: ${REPORT_FILE}
EOF
