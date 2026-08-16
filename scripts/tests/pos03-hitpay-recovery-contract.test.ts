import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("POS-03 recovery keeps webhook failure records server-only", () => {
  const migration = read("supabase/migrations/20260817120000_pos03_hitpay_recovery_hardening.sql");

  assert.match(migration, /alter table public\.hitpay_webhook_failures enable row level security/);
  assert.match(migration, /revoke all on table public\.hitpay_webhook_failures from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on table public\.hitpay_webhook_failures to service_role/);
});

test("POS-03 webhook and sync share atomic gateway evidence persistence", () => {
  const migration = read("supabase/migrations/20260817120000_pos03_hitpay_recovery_hardening.sql");
  const webhook = read("src/app/api/payment/hitpay/webhook/route.ts");
  const sync = read("src/app/api/payment/hitpay/sync/route.ts");

  assert.match(migration, /complete_pos_hitpay_sale_core/);
  assert.match(migration, /gateway_status = coalesce/);
  assert.match(migration, /gateway_payload = coalesce/);
  assert.match(migration, /gateway_refund_payment_id = coalesce/);
  assert.match(migration, /v_payment_status = 'pending'/);
  assert.doesNotMatch(webhook, /\.from\("payments"\)[\s\S]{0,100}\.update\(\{[\s\S]{0,100}gateway_status/);
  assert.match(webhook, /complete_provider_event_failed/);
  assert.match(sync, /completePosHitpaySale\(/);
});

test("POS-03 exceptions are exact rolling-24-hour counts, not a capped list", () => {
  const paymentsPage = read("src/app/(app)/dashboard/payments/page.tsx");

  assert.match(paymentsPage, /Date\.now\(\) - hours \* 60 \* 60 \* 1000/);
  assert.match(paymentsPage, /const webhookWindowStart = isoHoursAgo\(24\)/);
  assert.match(paymentsPage, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(paymentsPage, /for \(const code of HITPAY_WEBHOOK_FAILURE_CODES\)/);
});
