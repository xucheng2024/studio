import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { CRM02_LOCAL_IDENTITY_LIST } from "./fixtures/crm02-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

const port = Number(process.env.CRM02_UAT_PORT || "3102");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("CRM02_UAT_PORT must be a valid local port");
const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });
const env = localSupabaseEnvironment(status, { CRM02_UAT_BASE_URL: baseUrl, CRM02_UAT_DB_URL: status.DB_URL });
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, CRM02_LOCAL_IDENTITY_LIST, "CRM-02 local fixture");
execFileSync("psql", [status.DB_URL, "-v", "ON_ERROR_STOP=1", "-f", "scripts/sql/crm02_uat_local_execute.sql"], { stdio: "inherit", env });
process.exitCode = await runLocalNextUat({ port, env, command: ["node", "scripts/verify-crm02-browser-local.mjs"] });
