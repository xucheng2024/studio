#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { ensureCom01LocalAuthIdentities } from "./lib/com01-local-auth.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.COM01_UAT_PORT || "3101");
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("COM01_UAT_PORT must be an integer between 1024 and 65535");
}

const runId = process.env.COM01_UAT_RUN_ID || `local-${Date.now()}`;
const status = readLocalSupabaseStatus();
const env = localSupabaseEnvironment(status, {
  COM01_UAT_BASE_URL: `http://127.0.0.1:${port}`,
  COM01_UAT_RUN_ID: runId,
  COM01_DB_CLASSIFICATION: "uat",
  COM01_UAT_DB_URL: status.DB_URL,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

await ensureCom01LocalAuthIdentities(admin);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-v", `run_id=${runId}`, "-f", "scripts/sql/com01_uat_local_execute.sql"], {
  stdio: "inherit",
  env,
});

process.exitCode = await runLocalNextUat({ port, env, command: ["node", "scripts/verify-com01-uat-browser-local.mjs"] });
