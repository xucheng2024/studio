import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyExportCap, buildExportCapHeaders, resolveExportCap } from "../../src/lib/export-cap.ts";
import { buildDeferredExportPayload } from "../../src/lib/reports-deferred-export.ts";

function asStringBody(body: string | Uint8Array): string {
  if (typeof body !== "string") {
    throw new TypeError("Expected textual payload body");
  }
  return body;
}

test("Deferred export payload: CSV uses comma delimiter + content-type", async () => {
  const payload = await buildDeferredExportPayload({
    format: "csv",
    headers: ["customer_name", "deferred_value"],
    rows: [["Alex", "12.30"]],
  });

  assert.equal(payload.contentType, "text/csv; charset=utf-8");
  assert.match(asStringBody(payload.body), /^customer_name,deferred_value\nAlex,12.30$/);
});

test("Deferred export payload: TSV uses tab delimiter + content-type", async () => {
  const payload = await buildDeferredExportPayload({
    format: "tsv",
    headers: ["customer_name", "deferred_value"],
    rows: [["Alex", "12.30"]],
  });

  assert.equal(payload.contentType, "text/tab-separated-values; charset=utf-8");
  assert.match(asStringBody(payload.body), /^customer_name\tdeferred_value\nAlex\t12.30$/);
});

test("Deferred export payload: delimiter-specific escaping stays valid", async () => {
  const csvPayload = await buildDeferredExportPayload({
    format: "csv",
    headers: ["name", "note"],
    rows: [["Alex", "contains,comma"]],
  });
  assert.match(asStringBody(csvPayload.body), /"contains,comma"/);

  const tsvPayload = await buildDeferredExportPayload({
    format: "tsv",
    headers: ["name", "note"],
    rows: [["Alex", "contains\ttab"]],
  });
  assert.match(asStringBody(tsvPayload.body), /"contains\ttab"/);
});

test("Deferred export payload: XML emits xml content-type + root nodes", async () => {
  const payload = await buildDeferredExportPayload({
    format: "xml",
    headers: ["customer_name", "deferred_value"],
    rows: [["Alex", "12.30"]],
  });

  assert.equal(payload.contentType, "application/xml; charset=utf-8");
  assert.match(asStringBody(payload.body), /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(asStringBody(payload.body), /<deferred_export>/);
  assert.match(asStringBody(payload.body), /<cell name="customer_name">Alex<\/cell>/);
});

test("Deferred export payload: XLSX emits binary content-type", async () => {
  const payload = await buildDeferredExportPayload({
    format: "xlsx",
    headers: ["customer_name", "deferred_value"],
    rows: [["Alex", "12.30"]],
  });

  assert.equal(payload.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok(payload.body instanceof Uint8Array);
  assert.equal(payload.body[0], 0x50);
  assert.equal(payload.body[1], 0x4b);
});

test("Deferred export route contract: keeps explicit auth/forbidden guards", () => {
  const source = fs.readFileSync("src/app/api/reports/deferred/export/route.ts", "utf8");

  assert.match(source, /if \(!user\) return NextResponse\.json\(\{ error: "unauthorized" \}, \{ status: 401 \}\)/);
  assert.match(source, /if \(dashboardScope\.studioIds\.length === 0\)[\s\S]*status: 403/);
  assert.match(source, /if \(studioId && activeStudioId !== studioId\)[\s\S]*status: 403/);
  assert.match(source, /if \(rawLocationId === "__unassigned" && !hasStudioGlobalLocationAccess\(dashboardScope\.ctx, activeStudioId\)\)[\s\S]*status: 403/);
  assert.match(source, /requestedFormat === "tsv" \|\| requestedFormat === "xlsx" \|\| requestedFormat === "xml"/);
  assert.match(source, /resolveExportCap\(format\)/);
  assert.match(source, /applyExportCap\(filteredRows, exportCap\)/);
  assert.match(source, /buildExportCapHeaders\(\{/);
  assert.match(source, /limit: exportCap \+ 1/);
});

test("Deferred export route contract: package export includes location_name column", () => {
  const source = fs.readFileSync("src/app/api/reports/deferred/export/route.ts", "utf8");

  assert.match(source, /"location_id",\s*"location_name",\s*"customer_count"/);
  assert.match(source, /row\.location_id \?\? "",\s*row\.location_name \?\? ""/);
});

test("Deferred reports page contract: package table displays location_name", () => {
  const source = fs.readFileSync("src/app/(app)/dashboard/reports/page.tsx", "utf8");

  assert.match(source, /row\.location_name \?\? "Studio-level \/ unassigned"/);
});

test("Export cap helper: resolves heavy format cap", () => {
  const heavy = resolveExportCap("xlsx");
  const standard = resolveExportCap("csv");

  assert.equal(heavy.isHeavyFormat, true);
  assert.equal(heavy.exportCap, 2000);
  assert.equal(standard.isHeavyFormat, false);
  assert.equal(standard.exportCap, 5000);
});

test("Export cap helper: applies cap and returns warning headers", () => {
  const capped = applyExportCap([1, 2, 3], 2);
  assert.equal(capped.wasCapped, true);
  assert.deepEqual(capped.rows, [1, 2]);

  const headers = buildExportCapHeaders({
    wasCapped: capped.wasCapped,
    exportCap: capped.exportCap,
    rowCount: capped.rows.length,
  });

  assert.equal(headers["x-export-capped"], "true");
  assert.equal(headers["x-export-cap"], "2");
  assert.equal(headers["x-export-row-count"], "2");
  assert.equal(headers["x-export-warning"], "export capped at 2 source rows");
});
