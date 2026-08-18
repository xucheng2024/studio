import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CUSTOMER_EXPORT_HEADERS,
  PACKAGE_EXPORT_HEADERS,
  SALES_EXPORT_HEADERS,
  customerExportTable,
  exportHeadersAreSafe,
  filterCustomerExportRows,
  parseBusinessExportKind,
  saleExportTable,
} from "../../src/lib/business-export-model.ts";
import { parseExportFormat } from "../../src/lib/export-cap.ts";
import { buildDeferredExportPayload } from "../../src/lib/reports-deferred-export.ts";

test("EXP-01 kinds and formats stay in the shared builder set", () => {
  assert.equal(parseBusinessExportKind("sales"), "sales");
  assert.equal(parseBusinessExportKind("customers"), "customers");
  assert.equal(parseBusinessExportKind("packages"), "packages");
  assert.equal(parseBusinessExportKind("payroll"), null);
  assert.equal(parseExportFormat("xlsx"), "xlsx");
  assert.equal(parseExportFormat("nope"), "csv");
});

test("EXP-01 export headers omit health, NRIC, and bank fields", () => {
  assert.equal(exportHeadersAreSafe(SALES_EXPORT_HEADERS), true);
  assert.equal(exportHeadersAreSafe(CUSTOMER_EXPORT_HEADERS), true);
  assert.equal(exportHeadersAreSafe(PACKAGE_EXPORT_HEADERS), true);
  assert.equal(exportHeadersAreSafe(["customer_id", "allergies"]), false);
  assert.equal(exportHeadersAreSafe(["nric", "full_name"]), false);
});

test("EXP-01 customer export keeps page search/status filters and drops safety fields", () => {
  const rows = filterCustomerExportRows([
    { id: "1", full_name: "Ada", email: "ada@example.com", phone: "1", status: "active", preferred_location_id: null, source: "pos", created_at: "2026-08-01" },
    { id: "2", full_name: "Ben", email: "ben@example.com", phone: "2", status: "inactive", preferred_location_id: null, source: "pos", created_at: "2026-08-01" },
  ], { q: "ada", status: "active" });
  const table = customerExportTable(rows);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][1], "Ada");
  assert.equal(table.headers.includes("allergies"), false);
  assert.equal(JSON.stringify(table.rows).includes("safety"), false);
});

test("EXP-01 four formats stay content-consistent for the same sales rows", async () => {
  const table = saleExportTable([{
    sale_item_id: "item-1",
    sale_number: "S-1",
    paid_at: "2026-08-01T00:00:00+08:00",
    item_type: "service",
    item_name: "Cut",
    location_id: "loc-1",
    employee_id: "emp-1",
    service_id: "svc-1",
    gross: 30,
    refunds: 5,
    payment_status: "paid",
    source: "pos_sale",
    sales_channel: "in_store",
  }]);
  const csv = await buildDeferredExportPayload({ format: "csv", headers: table.headers, rows: table.rows });
  const tsv = await buildDeferredExportPayload({ format: "tsv", headers: table.headers, rows: table.rows });
  const xml = await buildDeferredExportPayload({ format: "xml", headers: table.headers, rows: table.rows });
  const xlsx = await buildDeferredExportPayload({ format: "xlsx", headers: table.headers, rows: table.rows });
  assert.match(String(csv.body), /item-1,S-1/);
  assert.match(String(tsv.body), /item-1\tS-1/);
  assert.match(String(xml.body), /<cell name="sale_item_id">item-1<\/cell>/);
  assert.equal(xlsx.body instanceof Uint8Array, true);
  assert.match(String(csv.body), /25.00/);
});

test("EXP-01 business export route reuses auth, cap, and deferred builder", () => {
  const source = fs.readFileSync("src/app/api/reports/business/export/route.ts", "utf8");
  assert.match(source, /if \(!user\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(source, /if \(dashboardScope\.studioIds\.length === 0\)[\s\S]*status: 403/);
  assert.match(source, /kind === "customers"[\s\S]*frontdesk", "instructor"/);
  assert.match(source, /kind === "packages"[\s\S]*frontdesk"/);
  assert.match(source, /\["owner", "manager"\]/);
  assert.match(source, /buildDeferredExportPayload/);
  assert.match(source, /resolveExportCap\(format\)/);
  assert.match(source, /applyExportCap\(table\.rows, exportCap\)/);
  assert.match(source, /exportHeadersAreSafe\(table\.headers\)/);
  assert.match(source, /action: "business_export"/);
});

test("EXP-01 payroll export stays owner-only and reuses the same builder", () => {
  const source = fs.readFileSync("src/app/api/payroll/reports/export/route.ts", "utf8");
  assert.match(source, /\["owner"\]/);
  assert.match(source, /isOwnerPayrollRole/);
  assert.match(source, /buildDeferredExportPayload/);
  assert.match(source, /\["summary", "commission", "statutory"\]/);
});
