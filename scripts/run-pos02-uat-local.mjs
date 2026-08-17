import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { POS_LOCAL_IDENTITIES, POS_LOCAL_IDENTITY_LIST } from "./fixtures/pos-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.POS02_UAT_PORT || "3105");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("POS02_UAT_PORT must be a valid local port");

const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });

const fixture = {
  POS02_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || process.env.POS02_UAT_RUN_ID || `local-${Date.now()}`,
  POS02_UAT_STUDIO_ID: randomUUID(),
  POS02_UAT_LOCATION_ID: randomUUID(),
  POS02_UAT_CUSTOMER_USER_ID: POS_LOCAL_IDENTITIES.customer.id,
  POS02_UAT_CUSTOMER_ID: randomUUID(),
  POS02_UAT_SERVICE_ID: randomUUID(),
  POS02_UAT_SALE_ID: randomUUID(),
  POS02_UAT_SALE_ITEM_ID: randomUUID(),
  POS02_UAT_PAYMENT_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, {
  POS02_UAT_BASE_URL: baseUrl,
  POS02_UAT_DB_URL: status.DB_URL,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, POS_LOCAL_IDENTITY_LIST, "POS-02 local fixture");

const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync(
  "psql",
  [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/pos02_uat_local_execute.sql"],
  { stdio: "inherit", env },
);

process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/pos",
  command: ["node", "scripts/verify-pos02-browser-local.mjs"],
});
