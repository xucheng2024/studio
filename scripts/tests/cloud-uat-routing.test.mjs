import assert from "node:assert/strict";
import test from "node:test";
import { routeCloudUatChanges } from "../lib/cloud-uat-routing.mjs";

const flows = [
  { id: "apt04-appointments-local", paths: ["src/app/[studioSlug]/appointments/**"] },
  { id: "com01-commission-local", paths: ["scripts/verify-com01-uat-browser-local.mjs"] },
  { id: "crm02-clients-local", paths: ["src/app/(app)/dashboard/clients/**"] },
  { id: "mkt01-marketing-local", paths: ["src/lib/marketing.ts"] },
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
  assert.equal(result.fastMatrix.include.length, 5);
});

test("does not spend a fast-check job on unrelated files", () => {
  const result = routeCloudUatChanges(["docs/notes.md"], flows);
  assert.equal(result.dispatch, null);
  assert.deepEqual(result.fastMatrix.include, []);
});
