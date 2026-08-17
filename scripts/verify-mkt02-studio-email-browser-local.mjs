import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { MKT02_LOCAL_IDENTITIES } from "./fixtures/mkt02-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "MKT02_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MKT02_UAT_DB_URL",
  "MKT02_UAT_STUDIO_ID", "MKT02_UAT_LOCATION_ID", "MKT02_UAT_RECIPIENT_ID", "MKT02_UAT_PROVIDER_EMAIL_ID",
  "MKT02_UAT_FROM_EMAIL", "MKT02_UAT_API_KEY", "MKT02_UAT_WEBHOOK_SECRET", "MKT02_UAT_RUN_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local MKT-02 studio email UAT environment: ${key}`);

const baseUrl = process.env.MKT02_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.MKT02_UAT_DB_URL;
const studioId = process.env.MKT02_UAT_STUDIO_ID;
const locationId = process.env.MKT02_UAT_LOCATION_ID;
const recipientId = process.env.MKT02_UAT_RECIPIENT_ID;
const providerEmailId = process.env.MKT02_UAT_PROVIDER_EMAIL_ID;
const fromEmail = process.env.MKT02_UAT_FROM_EMAIL;
const apiKey = process.env.MKT02_UAT_API_KEY;
const webhookSecret = process.env.MKT02_UAT_WEBHOOK_SECRET;
const runId = process.env.MKT02_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "mkt02-studio-email-uat", runId);
const query = `?studio_id=${studioId}&location_id=${locationId}`;

function signResendWebhook(id, timestamp, payload) {
  const key = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  return `v1,${signature}`;
}

async function postWebhook(studioPath, { body, headers = {}, id } = {}) {
  const payload = body ?? JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: providerEmailId, to: ["mkt02-webhook@example.test"] },
  });
  const svixId = id ?? `mkt02-svix-${runId}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(`${baseUrl}${studioPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": timestamp,
      "svix-signature": signResendWebhook(svixId, timestamp, payload),
      ...headers,
    },
    body: payload,
  });
  const text = await response.text();
  console.log("[mkt02-studio-email-uat] webhook", studioPath, response.status);
  return { status: response.status, text };
}

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

try {
  const instructor = await login(MKT02_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/settings/email${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("Only owners can update email settings.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.context.close();
  console.log("[mkt02-studio-email-uat] instructor denied");

  const unsigned = await fetch(`${baseUrl}/api/webhooks/resend/${studioId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "email.delivered", data: { email_id: providerEmailId } }),
  });
  assert.equal(unsigned.status, 401, "unconfigured studio webhook is rejected");
  const legacy = await fetch(`${baseUrl}/api/webhooks/resend`, { method: "POST", body: "{}" });
  assert.equal(legacy.status, 410, "legacy resend webhook is gone");
  console.log("[mkt02-studio-email-uat] fail-closed webhooks", unsigned.status, legacy.status);

  const owner = await login(MKT02_LOCAL_IDENTITIES.owner);
  await owner.page.goto(`${baseUrl}/dashboard/settings/email${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByRole("heading", { name: "Email settings" }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "email settings mobile overflow");
  const form = owner.page.locator("form").filter({ hasText: "Resend studio setup" });
  await form.locator('input[name="resend_enabled"]').check();
  await form.getByRole("button", { name: "Save settings" }).click();
  await owner.page.getByText("A verified From address is required before enabling Resend for this studio.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  console.log("[mkt02-studio-email-uat] enable without from address rejected");

  await form.locator('input[name="resend_from_email"]').fill(fromEmail);
  await form.locator('input[name="resend_api_key"]').fill(apiKey);
  await form.locator('input[name="resend_webhook_secret"]').fill(webhookSecret);
  await form.locator('input[name="resend_enabled"]').check();
  await form.getByRole("button", { name: "Save settings" }).click();
  await owner.page.getByText("Resend settings saved. This studio can send campaigns, appointment mail, and invoices.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  const pageText = await owner.page.locator("body").innerText();
  assert.equal(pageText.includes(apiKey), false, "API key must not render in the page");
  assert.equal(pageText.includes(webhookSecret), false, "webhook secret must not render in the page");
  await owner.context.close();
  console.log("[mkt02-studio-email-uat] owner saved studio Resend settings");

  const saved = await waitForLocalDatabaseState(async () => {
    const [{ data: studio, error: studioError }, { data: secrets, error: secretError }] = await Promise.all([
      admin.from("studios").select("resend_enabled").eq("id", studioId).maybeSingle(),
      admin.from("studio_email_secrets").select("resend_from_email, resend_api_key, resend_webhook_secret").eq("studio_id", studioId).maybeSingle(),
    ]);
    if (studioError) throw studioError;
    if (secretError) throw secretError;
    return { studio, secrets };
  }, (row) => row?.studio?.resend_enabled === true && Boolean(row?.secrets?.resend_api_key), "studio email secrets");
  assert.equal(saved.secrets.resend_from_email, fromEmail);
  assert.equal(saved.secrets.resend_api_key, apiKey);
  assert.equal(saved.secrets.resend_webhook_secret, webhookSecret);

  const delivered = await postWebhook(`/api/webhooks/resend/${studioId}`);
  assert.equal(delivered.status, 200, "signed studio webhook is accepted");
  const recipient = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("marketing_campaign_recipients").select("dispatch_status").eq("id", recipientId).maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.dispatch_status === "delivered", "webhook delivered status");
  assert.equal(recipient.dispatch_status, "delivered");

  const replay = await postWebhook(`/api/webhooks/resend/${studioId}`);
  assert.equal(replay.status, 200, "webhook replay is idempotent");
  const foreign = await postWebhook(`/api/webhooks/resend/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee`);
  assert.equal(foreign.status, 401, "unknown studio webhook is rejected");

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "owner can enable studio Resend without leaking secrets", result: "passed" },
      { name: "instructor is denied email settings", result: "passed" },
      { name: "studio webhook verifies, delivers, and rejects unknown studios", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("mkt02_studio_email_local_uat_ok");
} finally {
  await browser.close();
}
