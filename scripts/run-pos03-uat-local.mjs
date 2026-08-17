import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { POS_LOCAL_IDENTITIES, POS_LOCAL_IDENTITY_LIST } from "./fixtures/pos-local-identities.mjs";
import { ensureLocalAuthIdentities } from "./lib/local-fixture-auth.mjs";
import { assertLocalUatTargets } from "./lib/local-uat-safety.mjs";
import { localSupabaseEnvironment, readLocalSupabaseStatus, runLocalNextUat } from "./lib/local-supabase-uat.mjs";

function loadOptionalEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
}

loadOptionalEnvFile(path.join(process.cwd(), ".env.uat.local"));

const merchantApiKey = (process.env.POS03_HITPAY_API_KEY || process.env.HITPAY_PLATFORM_API_KEY || "").trim();
const webhookSalt = (process.env.POS03_HITPAY_WEBHOOK_SALT || process.env.HITPAY_WEBHOOK_SALT || "").trim();
if (!merchantApiKey || !webhookSalt) {
  throw new Error("POS-03 UAT requires POS03_HITPAY_API_KEY and POS03_HITPAY_WEBHOOK_SALT (or HITPAY_PLATFORM_API_KEY + HITPAY_WEBHOOK_SALT)");
}
if (!merchantApiKey.startsWith("test_")) {
  throw new Error("POS-03 UAT refuses non-sandbox HitPay merchant keys (expected test_ prefix)");
}

const port = Number(process.env.POS03_UAT_PORT || "3106");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("POS03_UAT_PORT must be a valid local port");

const status = readLocalSupabaseStatus();
const baseUrl = `http://127.0.0.1:${port}`;
assertLocalUatTargets({ baseUrl, supabaseUrl: status.API_URL, databaseUrl: status.DB_URL });

const fixture = {
  POS03_UAT_RUN_ID: process.env.UAT_FLOW_RUN_ID || process.env.POS03_UAT_RUN_ID || `local-${Date.now()}`,
  POS03_UAT_STUDIO_ID: randomUUID(),
  POS03_UAT_LOCATION_ID: randomUUID(),
  POS03_UAT_CUSTOMER_USER_ID: POS_LOCAL_IDENTITIES.customer.id,
  POS03_UAT_CUSTOMER_ID: randomUUID(),
  POS03_UAT_SERVICE_ID: randomUUID(),
  POS03_UAT_SALE_ID: randomUUID(),
  POS03_UAT_SALE_ITEM_ID: randomUUID(),
  POS03_UAT_PAYMENT_ID: randomUUID(),
};

const env = localSupabaseEnvironment(status, {
  POS03_UAT_BASE_URL: baseUrl,
  POS03_UAT_DB_URL: status.DB_URL,
  NEXT_PUBLIC_APP_URL: baseUrl,
  HITPAY_API_BASE_URL: process.env.HITPAY_API_BASE_URL?.trim() || "https://api.sandbox.hit-pay.com",
  POS03_HITPAY_API_KEY: merchantApiKey,
  POS03_HITPAY_WEBHOOK_SALT: webhookSalt,
  ...fixture,
});

const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await ensureLocalAuthIdentities(admin, POS_LOCAL_IDENTITY_LIST, "POS-03 local fixture");

const fixtureArgs = Object.entries(fixture).flatMap(([key, value]) => ["-v", `${key.toLowerCase()}=${value}`]);
execFileSync(
  "psql",
  [status.DB_URL, "-v", "ON_ERROR_STOP=1", ...fixtureArgs, "-f", "scripts/sql/pos03_uat_local_execute.sql"],
  { stdio: "inherit", env },
);

const { error: secretsError } = await admin.from("studio_payment_secrets").upsert({
  studio_id: fixture.POS03_UAT_STUDIO_ID,
  hitpay_api_key: merchantApiKey,
  hitpay_webhook_salt: webhookSalt,
}, { onConflict: "studio_id" });
if (secretsError) throw new Error(`Failed to seed HitPay studio secrets: ${secretsError.message}`);

process.exitCode = await runLocalNextUat({
  port,
  env,
  readyPath: "/dashboard/pos",
  command: ["node", "scripts/verify-pos03-browser-local.mjs"],
});
