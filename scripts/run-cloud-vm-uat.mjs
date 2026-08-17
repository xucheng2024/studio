#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const result = args[index + 1];
  if (!result || result.startsWith("--")) throw new Error(`${name} requires a value`);
  return result;
};
const has = (name) => args.includes(name);
const flowId = value("--flow");
const skillDirectory = path.resolve(value("--uat-browser-dir", process.env.UAT_BROWSER_DIR || "/opt/uat-browser/skills/uat-browser"));
const timeout = value("--timeout", "900");
const requestedReportDirectory = value("--report-dir");

if (!flowId || !/^[-a-z0-9]+$/.test(flowId)) {
  throw new Error("Usage: node scripts/run-cloud-vm-uat.mjs --flow <flow-id> [--uat-browser-dir <path>] [--timeout 900] [--report-dir tmp/<path>] [--keep-environment|--cleanup-on-failure]");
}
if (process.platform !== "linux") throw new Error("Cloud VM UAT runner requires Linux");
if (!/^\d+$/.test(timeout) || Number(timeout) < 1) throw new Error("--timeout must be a positive integer");

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "uat.flows.json"), "utf8"));
if (!manifest.flows?.some((flow) => flow.id === flowId)) throw new Error(`Unknown UAT flow: ${flowId}`);

const hostCheck = path.join(skillDirectory, "deploy", "cloud-vm", "check_host.py");
const flowRunner = path.join(skillDirectory, "scripts", "run_flow.py");
for (const requiredPath of [hostCheck, flowRunner]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`uat-browser installation is incomplete: missing ${path.relative(skillDirectory, requiredPath)}`);
}

const preflight = spawnSync("python3", [hostCheck], { cwd: process.cwd(), encoding: "utf8" });
if (preflight.error) throw new Error(`Cloud VM host check could not start: ${preflight.error.message}`);
let host;
try { host = JSON.parse(preflight.stdout); } catch { throw new Error("Cloud VM host check returned invalid output"); }
if (preflight.status !== 0 || host.status !== "ready") throw new Error(`Cloud VM host is not ready: ${JSON.stringify(host)}`);

const runId = `${flowId}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-${process.pid}`;
const reportDirectory = requestedReportDirectory || path.join("tmp", "uat-browser", runId);
const absoluteReportDirectory = path.resolve(reportDirectory);
const tmpDirectory = path.resolve("tmp");
if (absoluteReportDirectory === tmpDirectory || !absoluteReportDirectory.startsWith(`${tmpDirectory}${path.sep}`)) {
  throw new Error("--report-dir must be a child of the project tmp directory");
}
const runnerArgs = [flowRunner, "--cwd", process.cwd(), "--flow-id", flowId, "--timeout", timeout, "--report-dir", reportDirectory];
if (has("--keep-environment")) runnerArgs.push("--keep-environment");
if (has("--cleanup-on-failure")) runnerArgs.push("--cleanup-on-failure");

const childEnvironment = { ...process.env };
const sharedBrowserPath = "/opt/uat-browser/ms-playwright";
if (!childEnvironment.PLAYWRIGHT_BROWSERS_PATH && fs.existsSync(sharedBrowserPath)) {
  childEnvironment.PLAYWRIGHT_BROWSERS_PATH = sharedBrowserPath;
}
const result = spawnSync("python3", runnerArgs, { cwd: process.cwd(), env: childEnvironment, stdio: "inherit" });
if (result.error) throw new Error(`uat-browser runner could not start: ${result.error.message}`);
console.log(JSON.stringify({ status: result.status === 0 ? "passed" : "failed", flow: flowId, report_directory: reportDirectory }));
process.exitCode = result.status ?? 1;
