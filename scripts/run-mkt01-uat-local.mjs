import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MKT01_LOCAL_IDENTITY_LIST } from "./fixtures/mkt01-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.MKT01_UAT_PORT || "3104");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("MKT01_UAT_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const fixture = {
  MKT01_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || `local-${Date.now()}`,
  MKT01_UAT_STUDIO_ID: randomUUID(),
  MKT01_UAT_LOCATION_ID: randomUUID(),
  MKT01_UAT_ELIGIBLE_CUSTOMER_ID: randomUUID(),
  MKT01_UAT_SUPPRESSED_CUSTOMER_ID: randomUUID(),
  MKT01_UAT_NO_CONSENT_CUSTOMER_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, { MKT01_UAT_BASE_URL: baseUrl, MKT01_UAT_DB_URL: status.DB_URL, ...fixture });
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, MKT01_LOCAL_IDENTITY_LIST, "MKT-01 local fixture");
const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/mkt01_uat_local_execute.sql"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({ port, env, readyPath: "/dashboard/marketing", command: ["node", "scripts/verify-mkt01-browser-local.mjs"] });
