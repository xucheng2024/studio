import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CMP01_LOCAL_IDENTITY_LIST } from "./fixtures/cmp01-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.CMP01_UAT_PORT || "3118");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CMP01_UAT_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const fixture = {
  CMP01_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || `local-${Date.now()}`,
  CMP01_UAT_STUDIO_ID: randomUUID(),
  CMP01_UAT_LOCATION_ID: randomUUID(),
  CMP01_UAT_CUSTOMER_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, {
  CMP01_UAT_BASE_URL: baseUrl,
  CMP01_UAT_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, CMP01_LOCAL_IDENTITY_LIST, "cmp01 local fixture");
const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/cmp01_privacy_uat_local_execute.sql"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/settings/privacy",
  command: ["node", "scripts/verify-cmp01-privacy-browser-local.mjs"],
});
