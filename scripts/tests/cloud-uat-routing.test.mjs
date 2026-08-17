import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_FAST_SCRIPT, CLOUD_UAT_FLOW_ORDER, routeCloudUatChanges } from "../lib/cloud-uat-routing.mjs";

const flows = [
  { id: "apt01-availability-local", paths: ["scripts/verify-apt01-browser-local.mjs"] },
  { id: "apt03-calendar-local", paths: ["scripts/verify-apt03-browser-local.mjs"] },
  { id: "apt04-appointments-local", paths: ["src/app/[studioSlug]/appointments/**"] },
  { id: "com01-commission-local", paths: ["scripts/verify-com01-uat-browser-local.mjs"] },
  { id: "crm02-clients-local", paths: ["src/app/(app)/dashboard/clients/**"] },
  { id: "mkt01-marketing-local", paths: ["src/lib/marketing.ts"] },
  { id: "pos02-cash-receipt-local", paths: ["scripts/verify-pos02-browser-local.mjs"] },
  { id: "pos03-hitpay-sandbox-local", paths: ["scripts/verify-pos03-browser-local.mjs"] },
  { id: "pkg01-package-ledger-local", paths: ["scripts/verify-pkg01-browser-local.mjs"] },
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
  assert.equal(result.fastMatrix.include.length, CLOUD_UAT_FLOW_ORDER.length);
});

test("routes catalog-only changes to the catalog sync check", () => {
  const result = routeCloudUatChanges([".github/workflows/free-cloud-uat.yml"], flows);
  assert.equal(result.dispatch, null);
  assert.equal(result.reason, "cloud_uat_catalog");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "cloud-uat-catalog", script: CATALOG_FAST_SCRIPT }]);
});

test("routes APT-01 availability changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-apt01-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["apt01-availability-local"]);
  assert.equal(result.dispatch, "apt01-availability-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "apt01-availability-local", script: "test:apt01-static-gates" }]);
});

test("routes APT-03 calendar changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-apt03-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["apt03-calendar-local"]);
  assert.equal(result.dispatch, "apt03-calendar-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "apt03-calendar-local", script: "test:apt03-app" }]);
});

test("routes POS-02 cash/receipt changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-pos02-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["pos02-cash-receipt-local"]);
  assert.equal(result.dispatch, "pos02-cash-receipt-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "pos02-cash-receipt-local", script: "test:local-uat-safety" }]);
});

test("routes POS-03 HitPay sandbox changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-pos03-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["pos03-hitpay-sandbox-local"]);
  assert.equal(result.dispatch, "pos03-hitpay-sandbox-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "pos03-hitpay-sandbox-local", script: "test:hitpay-merchant-mode" }]);
});

test("routes PKG-01 package ledger changes to the dedicated cloud UAT flow", () => {
  const result = routeCloudUatChanges(["scripts/verify-pkg01-browser-local.mjs"], flows);
  assert.deepEqual(result.flows, ["pkg01-package-ledger-local"]);
  assert.equal(result.dispatch, "pkg01-package-ledger-local");
  assert.deepEqual(result.fastMatrix.include, [{ flow: "pkg01-package-ledger-local", script: "test:local-uat-safety" }]);
});

test("prepends the catalog sync check when a feature and catalog file both change", () => {
  const result = routeCloudUatChanges(["src/app/(app)/dashboard/clients/page.tsx", "uat.flows.json"], flows);
  assert.equal(result.dispatch, "crm02-clients-local");
  assert.deepEqual(result.fastMatrix.include[0], { flow: "cloud-uat-catalog", script: CATALOG_FAST_SCRIPT });
  assert.deepEqual(result.fastMatrix.include[1], { flow: "crm02-clients-local", script: "test:crm02-app" });
});

test("does not spend a fast-check job on unrelated files", () => {
  const result = routeCloudUatChanges(["docs/notes.md"], flows);
  assert.equal(result.dispatch, null);
  assert.deepEqual(result.fastMatrix.include, []);
});
