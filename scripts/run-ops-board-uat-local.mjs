import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { OPS_LOCAL_IDENTITY_LIST } from "./fixtures/ops-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.OPS_UAT_PORT || "3113");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("OPS_UAT_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const fixture = {
  OPS_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || `local-${Date.now()}`,
  OPS_UAT_STUDIO_ID: randomUUID(),
  OPS_UAT_LOCATION_ID: randomUUID(),
  OPS_UAT_CLASS_ID: randomUUID(),
  OPS_UAT_SESSION_ID: randomUUID(),
  OPS_UAT_EVENT_ID: randomUUID(),
  OPS_UAT_PENDING_BOOKING_ID: randomUUID(),
  OPS_UAT_BOOKED_BOOKING_ID: randomUUID(),
  OPS_UAT_ATTENDED_BOOKING_ID: randomUUID(),
  OPS_UAT_PENDING_EVENT_BOOKING_ID: randomUUID(),
  OPS_UAT_CLASS_PAYMENT_ID: randomUUID(),
  OPS_UAT_EVENT_PAYMENT_ID: randomUUID(),
};
const env = localSupabaseEnvironment(status, {
  OPS_UAT_BASE_URL: baseUrl,
  OPS_UAT_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  ...fixture,
});
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, OPS_LOCAL_IDENTITY_LIST, "ops local fixture");
const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/ops_board_uat_local_execute.sql"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/operations",
  command: ["node", "scripts/verify-ops-board-browser-local.mjs"],
});
