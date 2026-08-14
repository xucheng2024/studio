import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Payments export route contract: uses shared export cap helper", () => {
  const source = fs.readFileSync("src/app/api/payments/export/route.ts", "utf8");

  assert.match(source, /resolveExportCap\("csv"\)/);
  assert.match(source, /limit\(exportCap \+ 1\)/);
  assert.match(source, /applyExportCap\(rows, exportCap\)/);
  assert.match(source, /buildExportCapHeaders\(\{/);
});

test("Payments export route contract: keeps warning row appended at end", () => {
  const source = fs.readFileSync("src/app/api/payments/export/route.ts", "utf8");

  assert.match(source, /const capWarningRow = capped\.wasCapped/);
  assert.match(source, /export capped at \$\{capped\.exportCap\} rows/);
  assert.match(source, /const csv = \[headers, \.\.\.csvRows, \.\.\.capWarningRow\]/);
});
