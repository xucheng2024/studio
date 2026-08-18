/**
 * Static verification gates for the ops / Front desk landing.
 * Run: node scripts/verify-ops-board-static-gates.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

const nav = read("src/components/DashboardNav.tsx");
const operations = read("src/app/(app)/dashboard/operations/page.tsx");
const dashboard = read("src/app/(app)/dashboard/page.tsx");
const collect = read("src/lib/pending-payment-collect.ts");
const settings = read("src/app/(app)/dashboard/settings/page.tsx");

assert.match(nav, /href: "\/dashboard\/operations", label: "Front desk"/, "operations nav must be labeled Front desk");
assert.match(nav, /href: "\/dashboard\/overview", label: "Overview"/, "owner/manager nav must include Overview");
assert.match(nav, /href: "\/dashboard\/appointments", label: "Appointments"/, "appointments must stay a distinct nav item");
assert.equal(/label: "Bookings"/.test(nav), false, "staff nav must not reuse Bookings for operations");
assert.match(nav, /for \(const key of \["studio_id", "location_id"\]\)/, "nav must keep only studio and location");
assert.match(nav, /const MOBILE_PRIMARY_HREFS/, "mobile nav must declare primary tabs");
assert.match(nav, /More pages/, "mobile nav must include a More sheet");
assert.match(operations, /<h1 className=\{ui\.h1\}>Front desk<\/h1>/, "operations page title must be Front desk");
assert.match(dashboard, /if \(sp\.location_id\) params\.set\("location_id", sp\.location_id\)/, "dashboard landing must keep location_id");
assert.equal(/payment_method/.test(dashboard), false, "dashboard landing must not leak payment filters");
assert.ok(
  collect.indexOf("if (input.posSaleId)") < collect.indexOf("if (input.paymentId)"),
  "Collect payment must prefer POS when a sale exists",
);
assert.match(collect, /if \(input\.posSaleId\)[\s\S]*return `\/dashboard\/pos/, "posSaleId routes to POS");
assert.match(collect, /if \(input\.paymentId\)[\s\S]*return `\/dashboard\/payments/, "paymentId-only routes to Payments");
assert.match(settings, /if \(selectedLocationId\) p\.set\("location_id", selectedLocationId\)/, "settings cards must keep location_id");
assert.match(settings, /locationId: sp\.location_id \?\? null/, "settings scope must read location_id");

console.log("ops_board_static_gates_ok");
