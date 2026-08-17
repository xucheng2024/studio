#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  assertReleaseStudioId,
  assertReleaseSupabaseUrl,
  requiredEnvironment,
} from "./lib/release-gate-safety.mjs";

const supabaseUrl = assertReleaseSupabaseUrl(requiredEnvironment("RELEASE_SUPABASE_URL"));
const serviceRoleKey = requiredEnvironment("RELEASE_SUPABASE_SERVICE_ROLE_KEY");
const crmStudioId = assertReleaseStudioId(requiredEnvironment("RELEASE_CRM01_STUDIO_ID"), "RELEASE_CRM01_STUDIO_ID");
const posStudioId = assertReleaseStudioId(requiredEnvironment("RELEASE_POS_PKG_STUDIO_ID"), "RELEASE_POS_PKG_STUDIO_ID");
const environment = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  CRM01_E2E_STUDIO_ID: crmStudioId,
  POS_PKG_TARGET_STUDIO_ID: posStudioId,
};

const stages = [
  ["crm01", "scripts/verify-crm01-production-preflight.mjs"],
  ["pos_packages", "scripts/verify-pos-pkg-target.mjs"],
];
const completed = [];
for (const [name, script] of stages) {
  const result = spawnSync("node", [script], { cwd: process.cwd(), env: environment, stdio: "inherit" });
  if (result.error) throw new Error(`${name} release preflight could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} release preflight failed with exit code ${result.status ?? "unknown"}`);
  completed.push(name);
}

console.log(JSON.stringify({ status: "passed", policy: "remote_readonly", stages: completed }));
