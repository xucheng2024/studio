#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabaseStartExcludeArgs } from "./lib/github-uat-optimization.mjs";
import { readLocalSupabaseStatus } from "./lib/local-supabase-uat.mjs";

const action = process.argv[2];
const scriptPath = fileURLToPath(import.meta.url);
const stateDirectory = path.join(process.cwd(), "tmp", "uat-browser");
const statePath = path.join(stateDirectory, "cloud-vm-environment.json");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
}

function localSupabaseIsReady() {
  try {
    readLocalSupabaseStatus();
    return true;
  } catch {
    return false;
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Cloud VM UAT environment state is invalid");
  }
}

function writeState(state, flag = "w") {
  fs.mkdirSync(stateDirectory, { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag, mode: 0o600 });
}

function start() {
  if (readState()) {
    throw new Error(`A retained Cloud VM UAT environment already exists; inspect or clean it first with: node ${path.relative(process.cwd(), scriptPath)} cleanup`);
  }

  const startedByRunner = !localSupabaseIsReady();
  writeState({ version: 1, started_by_runner: startedByRunner, state: startedByRunner ? "starting" : "ready" }, "wx");
  if (startedByRunner) {
    run("npx", ["--no-install", "supabase", "start", ...supabaseStartExcludeArgs(process.env.UAT_SUPABASE_EXCLUDE)]);
    if (!localSupabaseIsReady()) throw new Error("Local Supabase did not become ready after start");
    writeState({ version: 1, started_by_runner: true, state: "ready" });
  }
  console.log(JSON.stringify({ status: "ready", supabase_started_by_runner: startedByRunner }));
}

function ready() {
  if (!readState()) throw new Error("Cloud VM UAT environment has not been started");
  if (!localSupabaseIsReady()) throw new Error("Local Supabase is not ready");
  console.log(JSON.stringify({ status: "ready", target: "loopback" }));
}

function inspect() {
  const state = readState();
  console.log(JSON.stringify({
    status: state && localSupabaseIsReady() ? "ready" : "not_ready",
    state_present: Boolean(state),
    supabase_started_by_runner: Boolean(state?.started_by_runner),
  }));
}

function cleanup() {
  const state = readState();
  if (!state) {
    console.log(JSON.stringify({ status: "clean", action: "none" }));
    return;
  }
  if (state.started_by_runner) run("npx", ["--no-install", "supabase", "stop"]);
  fs.unlinkSync(statePath);
  console.log(JSON.stringify({ status: "clean", supabase_stopped: Boolean(state.started_by_runner) }));
}

switch (action) {
  case "start": start(); break;
  case "ready": ready(); break;
  case "inspect": inspect(); break;
  case "cleanup": cleanup(); break;
  default: throw new Error("Usage: node scripts/manage-cloud-vm-uat-environment.mjs <start|ready|inspect|cleanup>");
}
