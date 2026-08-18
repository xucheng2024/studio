import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CATALOG_FAST_SCRIPT, CLOUD_UAT_FLOW_ORDER, FAST_SCRIPTS } from "../lib/cloud-uat-routing.mjs";

function isolatedFlowIds(manifest) {
  return (manifest.flows ?? [])
    .filter((flow) => flow.target?.policy === "command_local" && flow.data_access?.policy === "local_only")
    .map((flow) => flow.id);
}

function extractFreeCloudOptions(workflow) {
  const match = workflow.match(/\n {8}options:\n((?: {10}- .+\n)+)/);
  if (!match) throw new Error("free-cloud-uat options block missing");
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}- /, "").trim())
    .filter(Boolean);
}

function extractAllMatrix(workflow) {
  const match = workflow.match(/inputs\.flow == 'all' && '(\[[^\]]+\])'/);
  if (!match) throw new Error("free-cloud-uat all matrix missing");
  return JSON.parse(match[1]);
}

function extractReleaseGateFlows(workflow) {
  const match = workflow.match(/flows=\(\n((?:[ \t]+[a-z0-9-]+\n)+)[ \t]+\)/);
  if (!match) throw new Error("release-gate flows array missing");
  return match[1].trim().split(/\s+/);
}

function extractReleaseGateMatrix(workflow) {
  const match = workflow.match(/\n {6}matrix:\n {8}flow:\n((?: {10}- [a-z0-9-]+\n)+)/);
  if (!match) throw new Error("release-gate matrix flow list missing");
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^ *- /, "").trim());
}

test("isolated cloud UAT catalogs share one flow-id list", () => {
  const manifest = JSON.parse(fs.readFileSync("uat.flows.json", "utf8"));
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const freeCloud = fs.readFileSync(".github/workflows/free-cloud-uat.yml", "utf8");
  const releaseGate = fs.readFileSync(".github/workflows/release-gate.yml", "utf8");
  const expected = [...CLOUD_UAT_FLOW_ORDER];
  const options = extractFreeCloudOptions(freeCloud);

  assert.deepEqual(isolatedFlowIds(manifest), expected);
  assert.deepEqual(options.slice(0, -2), expected);
  assert.deepEqual(options.slice(-2), ["all", "all-batched"]);
  assert.deepEqual(extractAllMatrix(freeCloud), expected);
  assert.deepEqual(extractReleaseGateFlows(releaseGate), expected);
  assert.deepEqual(extractReleaseGateMatrix(releaseGate), expected);
  assert.match(releaseGate, new RegExp(`max-parallel:\\s*${expected.length}\\b`));
  assert.match(freeCloud, new RegExp(`max-parallel:\\s*${expected.length}\\b`));
  assert.match(packageJson.scripts?.[CATALOG_FAST_SCRIPT] ?? "", /cloud-uat-catalog\.test\.mjs/);
  for (const script of Object.values(FAST_SCRIPTS)) {
    assert.equal(typeof packageJson.scripts?.[script], "string", `missing npm script ${script}`);
  }
});
