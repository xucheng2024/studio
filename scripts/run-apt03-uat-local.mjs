import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { APT_LOCAL_IDENTITIES, APT_LOCAL_IDENTITY_LIST } from "./fixtures/apt-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.APT03_UAT_PORT || "3108");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("APT03_UAT_PORT must be a valid local port");

const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });

const fixture = {
  APT03_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || process.env.APT03_UAT_RUN_ID || `local-${Date.now()}`,
  APT03_UAT_STUDIO_ID: randomUUID(),
  APT03_UAT_LOCATION_L1_ID: randomUUID(),
  APT03_UAT_LOCATION_L2_ID: randomUUID(),
  APT03_UAT_EMPLOYEE_L1_ID: randomUUID(),
  APT03_UAT_EMPLOYEE_L2_ID: randomUUID(),
  APT03_UAT_SERVICE_ID: randomUUID(),
  APT03_UAT_CUSTOMER_L1_ID: randomUUID(),
  APT03_UAT_CUSTOMER_L2_ID: randomUUID(),
  APT03_UAT_CUSTOMER_USER_ID: APT_LOCAL_IDENTITIES.customer.id,
};
const env = localSupabaseEnvironment(status, {
  APT03_UAT_BASE_URL: baseUrl,
  APT03_UAT_DB_URL: status.DB_URL,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, APT_LOCAL_IDENTITY_LIST, "APT-03 local fixture");

const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync(
  "psql",
  [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/apt03_uat_local_execute.sql"],
  { stdio: "inherit", env },
);

process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/appointments",
  command: ["node", "scripts/verify-apt03-browser-local.mjs"],
});
