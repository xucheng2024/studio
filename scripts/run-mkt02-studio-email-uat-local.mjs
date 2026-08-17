import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { MKT02_LOCAL_IDENTITY_LIST } from "./fixtures/mkt02-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.MKT02_UAT_PORT || "3111");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("MKT02_UAT_PORT must be a valid local port");

const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });

const fixture = {
  MKT02_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || `local-${Date.now()}`,
  MKT02_UAT_STUDIO_ID: randomUUID(),
  MKT02_UAT_LOCATION_ID: randomUUID(),
  MKT02_UAT_CUSTOMER_ID: randomUUID(),
  MKT02_UAT_CAMPAIGN_ID: randomUUID(),
  MKT02_UAT_RECIPIENT_ID: randomUUID(),
  MKT02_UAT_PROVIDER_EMAIL_ID: `mkt02-uat-${randomUUID()}`,
  MKT02_UAT_FROM_EMAIL: "MKT-02 UAT <noreply@example.test>",
  MKT02_UAT_API_KEY: `re_test_mkt02_${randomUUID().replace(/-/g, "")}`,
  MKT02_UAT_WEBHOOK_SECRET: `whsec_${randomBytes(32).toString("base64")}`,
};

const env = localSupabaseEnvironment(status, {
  MKT02_UAT_BASE_URL: baseUrl,
  MKT02_UAT_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, MKT02_LOCAL_IDENTITY_LIST, "MKT-02 studio email local fixture");
const fixtureArgs = Object.entries({
  MKT02_UAT_STUDIO_ID: fixture.MKT02_UAT_STUDIO_ID,
  MKT02_UAT_LOCATION_ID: fixture.MKT02_UAT_LOCATION_ID,
  MKT02_UAT_CUSTOMER_ID: fixture.MKT02_UAT_CUSTOMER_ID,
  MKT02_UAT_CAMPAIGN_ID: fixture.MKT02_UAT_CAMPAIGN_ID,
  MKT02_UAT_RECIPIENT_ID: fixture.MKT02_UAT_RECIPIENT_ID,
  MKT02_UAT_PROVIDER_EMAIL_ID: fixture.MKT02_UAT_PROVIDER_EMAIL_ID,
}).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/mkt02_studio_email_uat_local_execute.sql"], { stdio: "inherit", env });
console.log("[mkt02-studio-email-uat] seeded fixture", { studioId: fixture.MKT02_UAT_STUDIO_ID, port });
process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/settings/email",
  command: ["node", "scripts/verify-mkt02-studio-email-browser-local.mjs"],
});
