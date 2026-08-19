import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PUBLIC_LOCAL_IDENTITY_LIST } from "./fixtures/public-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.PUBLIC_UAT_PORT || "3150");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("PUBLIC_UAT_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const fixture = {
  PUBLIC_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || `local-${Date.now()}`,
  PUBLIC_UAT_STUDIO_ID: randomUUID(),
  PUBLIC_UAT_LOCATION_ID: randomUUID(),
  PUBLIC_UAT_SERVICE_ID: randomUUID(),
  PUBLIC_UAT_PACKAGE_ID: randomUUID(),
  PUBLIC_UAT_EVENT_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, {
  PUBLIC_UAT_BASE_URL: baseUrl,
  PUBLIC_UAT_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, PUBLIC_LOCAL_IDENTITY_LIST, "public local fixture");
const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/public_commerce_uat_local_execute.sql"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard",
  command: ["node", "scripts/verify-public-commerce-browser-local.mjs"],
});
