import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractCatalog, scaffoldIsolatedUatFlow } from "../scaffold-isolated-uat-flow.mjs";

const CATALOG_FILES = [
  "uat.flows.json",
  "package.json",
  "scripts/lib/cloud-uat-routing.mjs",
  "scripts/tests/cloud-uat-routing.test.mjs",
  ".github/workflows/free-cloud-uat.yml",
  ".github/workflows/release-gate.yml",
];

function copyCatalog(root) {
  for (const rel of CATALOG_FILES) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(rel, dest);
  }
}

test("existing isolated flows stay already wired", () => {
  const result = scaffoldIsolatedUatFlow({
    root: process.cwd(),
    id: "mkt02-studio-email-local",
    fastScript: "test:mkt02-marketing-contract",
    write: false,
    port: 3111,
    readyPath: "/dashboard/settings/email",
  });
  assert.equal(result.status, "already_wired");
});

test("scaffolds catalog lists and fixture stubs in a disposable root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-uat-scaffold-"));
  copyCatalog(root);
  const id = "demo-feature-local";
  const result = scaffoldIsolatedUatFlow({
    root,
    id,
    after: "mkt02-studio-email-local",
    fastScript: "test:local-uat-safety",
    write: true,
    port: 3112,
    readyPath: "/dashboard",
  });
  assert.equal(result.status, "wired");
  const catalog = extractCatalog(root);
  const index = catalog.order.indexOf("mkt02-studio-email-local");
  assert.equal(catalog.order[index + 1], id);
  assert.deepEqual(catalog.isolated, catalog.order);
  assert.deepEqual(catalog.options.slice(0, -2), catalog.order);
  assert.deepEqual(catalog.matrix, catalog.order);
  assert.deepEqual(catalog.release, catalog.order);
  assert.deepEqual(catalog.releaseMatrix, catalog.order);
  assert.equal(catalog.maxParallel, catalog.order.length);
  assert.equal(catalog.scripts[id], "test:local-uat-safety");
  for (const rel of result.files) assert.equal(fs.existsSync(path.join(root, rel)), true);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:demo-feature-uat-local"], "node scripts/run-demo-feature-uat-local.mjs");
  fs.rmSync(root, { recursive: true, force: true });
});
