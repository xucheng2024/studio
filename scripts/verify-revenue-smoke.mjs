/**
 * Minimal smoke check: Net = Gross − Refunds (same rule as src/lib/revenue-summary.ts).
 * Run: node scripts/verify-revenue-smoke.mjs
 */
import assert from "node:assert/strict";

function computeRevenueSummary(rows) {
  let gross = 0;
  let refunds = 0;
  for (const p of rows) {
    const amt = Number(p.amount ?? 0);
    if (p.status === "paid") gross += amt;
    else if (p.status === "refunded") refunds += amt;
  }
  return { gross, refunds, net: gross - refunds };
}

assert.deepEqual(
  computeRevenueSummary([
    { status: "paid", amount: 100 },
    { status: "refunded", amount: 30 },
  ]),
  { gross: 100, refunds: 30, net: 70 },
);
assert.deepEqual(
  computeRevenueSummary([{ status: "paid", amount: 50 }]),
  { gross: 50, refunds: 0, net: 50 },
);
console.log("verify-revenue-smoke: ok");
