#!/usr/bin/env bash
set -euo pipefail

node --experimental-strip-types --test scripts/tests/apt05-cron-dedup.test.ts

echo "verify-apt05-cron: ok"
