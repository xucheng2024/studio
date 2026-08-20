import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("walk-in cash can bind to a POS cash session without a POS sale", () => {
  const migration = read("supabase/migrations/20260820120000_walkin_cash_session_bind.sql");
  const walkin = read("src/app/api/frontdesk/walkin/route.ts");
  const sale = read("src/lib/bookingTransitions.ts");
  const exportRoute = read("src/app/api/payments/export/route.ts");
  const form = read("src/components/FrontdeskWalkinForm.tsx");

  assert.match(migration, /payment_is_cash_session_eligible/);
  assert.match(migration, /p_sales_channel, ''\) = 'frontdesk'/);
  assert.match(migration, /online_booking/);
  assert.match(migration, /event_booking/);
  assert.match(migration, /payment_is_cash_session_eligible\(p\.payment_method, p\.source, p\.sales_channel\)/);
  assert.match(walkin, /operationScope: "frontdesk_walkin"/);
  assert.match(walkin, /no_open_cash_session/);
  assert.match(walkin, /idempotency_key/);
  assert.match(sale, /cashSessionId/);
  assert.match(sale, /cash_session_id: cashSessionId/);
  assert.match(exportRoute, /eq\("cash_session_id", cashSessionId\)/);
  assert.doesNotMatch(
    exportRoute,
    /eq\("payment_method", "cash"\)\.eq\("source", "pos_sale"\)\.eq\("cash_session_id"/,
  );
  assert.match(form, /idempotency_key: idempotencyKeyRef\.current/);
});
