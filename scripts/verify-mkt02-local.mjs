import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { readLocalSupabaseStatus } from "./lib/local-supabase-uat.mjs";

const status = readLocalSupabaseStatus();
const port = Number(process.env.MKT01_UAT_PORT || "3104");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("MKT01_UAT_PORT must be a valid local port");
}
assertLocalUatTargets({
  baseUrl: `http://127.0.0.1:${port}`,
  supabaseUrl: status.API_URL,
  databaseUrl: status.DB_URL,
});

const runId = process.env.UAT_FLOW_RUN_ID || `mkt02-local-${Date.now()}`;
const env = { ...process.env, UAT_FLOW_RUN_ID: runId };
const completedStages = [];

function runStage(label, command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env, stdio: "inherit" });
  if (result.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  completedStages.push(label);
}

runStage("migration_preflight", "npm", ["run", "verify:local-migration-reset"]);
runStage("database_contract", "psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-f", "scripts/sql/verify_mkt02_dispatch.sql"]);
runStage("application_contract", "node", ["--experimental-strip-types", "--test", "scripts/tests/mkt02-marketing-contract.test.ts"]);
runStage("browser_uat", "npm", ["run", "test:mkt01-uat-local"]);

const evidencePath = path.join(process.cwd(), "tmp", "mkt01-uat", runId, "index.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
if (evidence.run_id !== runId || evidence.status !== "passed" || !Array.isArray(evidence.assertions)) {
  throw new Error("MKT-02 browser evidence is invalid");
}
evidence.assertions.push(
  { name: "MKT-02 migration and database contract", result: "passed" },
  { name: "MKT-02 application contract", result: "passed" },
);
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log(JSON.stringify({ status: "passed", flow: "mkt02-local", run_id: runId, stages: completedStages }));
