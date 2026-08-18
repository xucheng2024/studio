/**
 * Static verification gates for APT-01 (no behavior changes).
 * Run: node scripts/verify-apt01-static-gates.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function assertContains(text, pattern, message) {
  assert.equal(pattern.test(text), true, message);
}

function getExportedAsyncFunctions(source) {
  const matches = [...source.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)\s*\(/g)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    return {
      name: match[1],
      body: source.slice(start, end),
    };
  });
}

function assertPerActionAuthAndGuard(fileName, source, guardedCalls) {
  const actions = getExportedAsyncFunctions(source);
  assert.equal(actions.length > 0, true, `${fileName}: expected exported async actions`);

  for (const action of actions) {
    assertContains(
      action.body,
      /await\s+requireUser\(\)/,
      `${fileName}:${action.name} must call requireUser()`,
    );
    assert.equal(
      guardedCalls.some((callName) => new RegExp(`\\b${callName}\\s*\\(`).test(action.body)),
      true,
      `${fileName}:${action.name} must call a scope-guarded lib function`,
    );
  }
}

function assertNoNestedTags(source, tags, messagePrefix) {
  const tagRe = new RegExp(`<\\/?(?:${tags.join("|")})\\b[^>]*>`, "g");
  let depth = 0;
  let match;
  while ((match = tagRe.exec(source)) !== null) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      assert.equal(depth >= 0, true, `${messagePrefix}: unmatched closing tag`);
    } else {
      depth += 1;
      assert.equal(depth <= 1, true, `${messagePrefix}: nested tag detected`);
    }
  }
  assert.equal(depth, 0, `${messagePrefix}: unclosed tag`);
}

const serviceLib = read("src/lib/service-availability.ts");
const staffLib = read("src/lib/staff-availability.ts");
const resourcesLib = read("src/lib/salon-resources.ts");
const serviceActions = read("src/app/(app)/dashboard/_actions/service-availability.ts");
const staffActions = read("src/app/(app)/dashboard/_actions/staff-availability.ts");
const resourceActions = read("src/app/(app)/dashboard/_actions/salon-resources.ts");
const servicesPage = read("src/app/(app)/dashboard/services/page.tsx");
const serverActionToastFormComponent = read("src/components/dashboard/ServerActionToastForm.tsx");
const toastConfirmFormComponent = read("src/components/ToastConfirmForm.tsx");

// 1) Role matrix static gates: write operations are owner/manager only.
for (const [name, text] of [
  ["service lib", serviceLib],
  ["staff lib", staffLib],
  ["resources lib", resourcesLib],
]) {
  assertContains(text, /const\s+WRITE_GLOBAL_ROLES\s*=\s*\["owner",\s*"manager"\]/, `${name}: WRITE_GLOBAL_ROLES must be owner+manager`);
}

// 2) Read roles include frontdesk; instructor excluded from reads.
for (const [name, text] of [
  ["service lib", serviceLib],
  ["staff lib", staffLib],
  ["resources lib", resourcesLib],
]) {
  assertContains(text, /const\s+READ_ROLES\s*=\s*\["owner",\s*"manager",\s*"frontdesk"\]/, `${name}: READ_ROLES must include frontdesk`);
  assert.equal(/READ_ROLES[\s\S]*instructor/.test(text), false, `${name}: READ_ROLES must not include instructor`);
}

// 3) Per-action auth + scope-guarded call chain.
assertPerActionAuthAndGuard("service-availability actions", serviceActions, [
  "updateStudioServiceAvailabilityDefaults",
  "setServiceEmployeeEligibilities",
  "setServiceResourceRequirements",
  "setServicePublishScope",
]);
assertPerActionAuthAndGuard("staff-availability actions", staffActions, [
  "setEmployeeWorkingHoursForWeek",
  "createEmployeeAvailabilityException",
  "deleteEmployeeAvailabilityException",
]);
assertPerActionAuthAndGuard("salon-resources actions", resourceActions, [
  "upsertSalonResource",
  "setSalonResourceActive",
]);

// 4) Cross-scope parameter chain present (studio/location/service/employee ids from form data).
for (const [field, text] of [
  ["studio_id", serviceActions],
  ["service_id", serviceActions],
  ["location_id", staffActions],
  ["employee_id", staffActions],
  ["resource_id", resourceActions],
]) {
  assertContains(text, new RegExp(`formData\\.get\\("${field}"\\)`), `missing formData field: ${field}`);
}

// 5) Unified resolver wiring present in main flow.
assertContains(serviceLib, /resolveUnifiedAvailabilityFromSnapshot\(/, "main flow must call unified resolver");

// 6) Services page component-level form nesting guard.
assertNoNestedTags(
  servicesPage,
  ["ServerActionToastForm", "ToastConfirmForm"],
  "services page form-components",
);

// 7) Form components themselves should not render nested <form>.
assertNoNestedTags(serverActionToastFormComponent, ["form"], "ServerActionToastForm component");
assertNoNestedTags(toastConfirmFormComponent, ["form"], "ToastConfirmForm component");

console.log("verify-apt01-static-gates: ok");
