#!/usr/bin/env bash
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  echo "Usage: DATABASE_URL=... bash scripts/ops-pkg02-approval-checks.sh [studio_id]" >&2
  exit 1
fi

STUDIO_ID="${1:-}"

echo "Running PKG-02 approval read-only checks..."
if [[ -n "${STUDIO_ID}" ]]; then
  echo "Scope: studio_id=${STUDIO_ID}"
else
  echo "Scope: all studios"
fi

psql "${DATABASE_URL}" \
  -v ON_ERROR_STOP=1 \
  -v studio_id="${STUDIO_ID}" \
  -f scripts/sql/ops_pkg02_approval_readonly_checks.sql

echo "ops-pkg02-approval-checks: done"
