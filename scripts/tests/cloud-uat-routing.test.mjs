import assert from "node:assert/strict";
import test from "node:test";
import { routeCloudUatChanges } from "../lib/cloud-uat-routing.mjs";

const flows = [
  { id: "apt04-appointments-local", paths: ["src/app/[studioSlug]/appointments/**"] },
  { id: "com01-commission-local", paths: ["scripts/verify-com01-uat-browser-local.mjs"] },
  { id: "crm02-clients-local", paths: ["src/app/(app)/dashboard/clients/**"] },
  { id: "mkt01-marketing-local", paths: ["src/lib/marketing.ts"] },
  { id: "pos02-cash-receipt-local", paths: ["scripts/verify-pos02-browser-local.mjs"] },
  { id: "pos-packages-local", paths: ["src/lib/pos-sales.ts"] },
];

test("routes a feature change to its smallest cloud UAT flow", () => {
  const result = routeCloudUatChanges(["src/app/(app)/dashboard/clients/page.tsx"], flows);
  assert.deepEqual(result.flows, ["crm02-clients-local"]);
  assert.equal(result.dispatch, "crm02-clients-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "crm02-clients-local", script: "test:crm02-app" }]);
});

test("routes shared local UAT infrastructure to every isolated flow", () => {
  const result = routeCloudUatChanges(["supabase/migrations/20260818000000_change.sql"], flows);
  assert.equal(result.dispatch, "all");
  assert.equal(result.fastMatrix.include.length, 6);
});

test("routes POS-02 cash/receipt changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-pos02-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["pos02-cash-receipt-local"]);
  assert.equal(result.dispatch, "pos02-cash-receipt-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "pos02-cash-receipt-local", script: "test:local-uat-safety" }]);
});

test("does not spend a fast-check job on unrelated files", () => {
  const result = routeCloudUatChanges(["docs/notes.md"], flows);
  assert.equal(result.dispatch, null);
  assert.deepEqual(result.fastMatrix.include, []);
});
