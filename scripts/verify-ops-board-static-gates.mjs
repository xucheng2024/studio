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

console.log("ops_board_static_gates_ok");
