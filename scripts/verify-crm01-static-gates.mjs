import assert from "node:assert/strict";
import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

const clientsListPage = read("src/app/(app)/dashboard/clients/page.tsx");
const clientDetailPage = read("src/app/(app)/dashboard/clients/[clientId]/page.tsx");
const sensitiveLib = read("src/lib/salon-customer-sensitive.ts");

assert.equal(
  sensitiveLib.includes('.eq("employment_status", "active")'),
  true,
  "CRM-01 instructor lookup must use employees.employment_status",
);
assert.equal(
  sensitiveLib.includes('.eq("is_active", true)'),
  false,
  "CRM-01 must not query the absent employees.is_active column",
);

assert.equal(
  clientsListPage.includes("listSalonCustomersForDashboard({"),
  true,
  "clients list must source rows from listSalonCustomersForDashboard",
);
assert.equal(
  clientsListPage.includes("href={`/dashboard/clients/${customer.id}?"),
  true,
  "clients list links must open by salon_customer id",
);

assert.equal(
  clientDetailPage.includes("listSalonCustomersForDashboard({"),
  true,
  "client detail must use listSalonCustomersForDashboard for access scope",
);
assert.equal(
  /resolvedSalonCustomer\s*=\s*listScope\.customers\.find\(/.test(clientDetailPage),
  true,
  "client detail must resolve customer from scoped list",
);
assert.equal(
  clientDetailPage.includes("row.id === clientId || (row.user_id && row.user_id === clientId)"),
  true,
  "client detail must support salon_customer id and legacy user_id route params",
);
assert.equal(
  clientDetailPage.includes("name=\"client_id\" value={ledgerUserId}"),
  true,
  "profile update form must write linked user id, not route clientId",
);

const guardIdx = clientDetailPage.indexOf("if (!listScope.ok)");
const resolvedIdx = clientDetailPage.indexOf("if (!resolvedSalonCustomer)");
const ledgerQueryIdx = clientDetailPage.indexOf('.from("customer_subscriptions")');
assert.equal(guardIdx !== -1 && resolvedIdx !== -1 && ledgerQueryIdx !== -1, true, "missing expected gate/query markers");
assert.equal(
  guardIdx < ledgerQueryIdx && resolvedIdx < ledgerQueryIdx,
  true,
  "authorization gate must run before ledger queries",
);

assert.equal(
  clientDetailPage.includes("Customer not found in your authorized scope."),
  true,
  "unauthorized or unrelated clientId should not expose ledger",
);

const detailFnStart = sensitiveLib.indexOf("export async function getSalonCustomerSensitiveDetail");
const detailFnEnd = sensitiveLib.indexOf("export async function updateSalonCustomerPreferences", detailFnStart);
const detailFnBody = sensitiveLib.slice(detailFnStart, detailFnEnd);
const detailDenyIdx = detailFnBody.indexOf("if (!access.ok) return access;");
const detailAuditIdx = detailFnBody.indexOf('action: "preference_view"');
assert.equal(detailDenyIdx !== -1 && detailAuditIdx !== -1, true, "missing detail access-guard or audit markers");
assert.equal(
  detailDenyIdx < detailAuditIdx,
  true,
  "denied sensitive detail path must return before writing read audits",
);

console.log("verify-crm01-static-gates: ok");
