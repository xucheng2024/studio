#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flowIndex = args.indexOf("--flow");
const requestedFlow = flowIndex === -1 ? undefined : args[flowIndex + 1];
if (!requestedFlow || !/^[-a-z0-9]+$/.test(requestedFlow)) {
  throw new Error("Usage: node scripts/run-github-hosted-uat.mjs --flow <flow-id|all-batched>");
}
if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true") {
  throw new Error("GitHub-hosted UAT must run on a Linux GitHub Actions runner");
}

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "uat.flows.json"), "utf8"));
const batchedFlowIds = [
  "apt04-appointments-local",
  "com01-commission-local",
  "crm02-clients-local",
  "mkt01-marketing-local",
  "pos02-cash-receipt-local",
  "pos03-hitpay-sandbox-local",
  "pos-packages-local",
];
const flowIds = requestedFlow === "all-batched" ? batchedFlowIds : [requestedFlow];
const flows = flowIds.map((flowId) => {
  const flow = manifest.flows?.find((candidate) => candidate.id === flowId);
  if (!flow) throw new Error(`Unknown UAT flow: ${flowId}`);
  if (flow.target?.policy !== "command_local" || flow.data_access?.policy !== "local_only") {
    throw new Error(`Flow ${flowId} is not an isolated local-only browser flow`);
  }
  for (const stage of ["start", "ready", "inspect", "cleanup"]) {
    if (!Array.isArray(flow.environment?.[stage]) || flow.environment[stage].length === 0) {
      throw new Error(`Flow ${flowId} is missing environment.${stage}`);
    }
  }
  return flow;
});
const flow = flows[0];
if (flows.some((candidate) => JSON.stringify(candidate.environment) !== JSON.stringify(flow.environment))) {
  throw new Error("Batched UAT flows must share the same disposable environment lifecycle");
}

const run = (command, environment) => {
  const [executable, ...commandArgs] = command;
  const result = spawnSync(executable, commandArgs, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw new Error(`${executable} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${executable} failed with exit code ${result.status ?? "unknown"}`);
};

run(["docker", "info"], process.env);
const environment = {
  ...process.env,
  UAT_FLOW_RUN_ID: `github-${process.env.GITHUB_RUN_ID || "unknown"}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`,
};

function recordSupabaseImages() {
  const result = spawnSync("docker", ["ps", "--all", "--filter", "name=supabase_", "--format", "{{.Image}}"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) return;
  const images = [...new Set(result.stdout.split("\n").map((value) => value.trim()).filter(Boolean))];
  if (images.length === 0) return;
  const outputDirectory = path.join(process.cwd(), "tmp", "github-uat");
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "supabase-images.json"), `${JSON.stringify(images)}\n`, { mode: 0o600 });
}

let primaryError;
let started = false;
try {
  run(flow.environment.start, environment);
  started = true;
  run(flow.environment.ready, environment);
  for (const candidate of flows) run(candidate.command, environment);
  run(flow.environment.inspect, environment);
} catch (error) {
  primaryError = error;
  if (started) {
    try {
      run(flow.environment.inspect, environment);
    } catch (inspectionError) {
      console.error(`Environment inspection also failed: ${inspectionError.message}`);
    }
  }
} finally {
  recordSupabaseImages();
  try {
    run(flow.environment.cleanup, environment);
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else console.error(`Environment cleanup also failed: ${cleanupError.message}`);
  }
}

if (primaryError) throw primaryError;
console.log(JSON.stringify({ status: "passed", flows: flowIds, runner: "github-hosted" }));
