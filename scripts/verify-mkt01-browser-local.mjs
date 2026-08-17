import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { MKT01_LOCAL_IDENTITIES } from "./fixtures/mkt01-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = ["MKT01_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MKT01_UAT_DB_URL", "MKT01_UAT_STUDIO_ID", "MKT01_UAT_LOCATION_ID", "MKT01_UAT_ELIGIBLE_CUSTOMER_ID", "MKT01_UAT_SUPPRESSED_CUSTOMER_ID", "MKT01_UAT_NO_CONSENT_CUSTOMER_ID", "MKT01_UAT_RUN_ID"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local MKT-01 UAT environment: ${key}`);
const baseUrl = process.env.MKT01_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.MKT01_UAT_DB_URL;
const studioId = process.env.MKT01_UAT_STUDIO_ID;
const locationId = process.env.MKT01_UAT_LOCATION_ID;
const eligibleCustomerId = process.env.MKT01_UAT_ELIGIBLE_CUSTOMER_ID;
const suppressedCustomerId = process.env.MKT01_UAT_SUPPRESSED_CUSTOMER_ID;
const noConsentCustomerId = process.env.MKT01_UAT_NO_CONSENT_CUSTOMER_ID;
const runId = process.env.MKT01_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "mkt01-uat", runId);

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

try {
  const query = `?studio_id=${studioId}&location_id=${locationId}`;
  const owner = await login(MKT01_LOCAL_IDENTITIES.owner);
  await owner.page.goto(`${baseUrl}/dashboard/marketing${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByRole("heading", { name: "Marketing" }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "marketing mobile overflow");
  const campaignForm = owner.page.locator("form").filter({ hasText: "New audience and Email draft" });
  await campaignForm.getByLabel("Campaign name").fill("MKT local consent snapshot");
  await campaignForm.getByLabel("Subject").fill("MKT local subject");
  await campaignForm.getByLabel("Message").fill("MKT local body");
  await campaignForm.getByRole("button", { name: "Create draft and snapshot" }).click();
  await owner.page.getByText("Draft saved with 1 consented recipients (3 in snapshot).", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  const campaign = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("marketing_campaigns").select("id").eq("studio_id", studioId).eq("name", "MKT local consent snapshot").maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => Boolean(row?.id), "marketing snapshot");
  const { data: recipients, error: recipientsError } = await admin.from("marketing_campaign_recipients").select("salon_customer_id, eligibility, unsubscribe_token").eq("campaign_id", campaign.id);
  if (recipientsError) throw recipientsError;
  const eligibility = new Map(recipients.map((recipient) => [recipient.salon_customer_id, recipient.eligibility]));
  assert.equal(eligibility.get(eligibleCustomerId), "eligible");
  assert.equal(eligibility.get(suppressedCustomerId), "suppressed");
  assert.equal(eligibility.get(noConsentCustomerId), "no_consent");
  const eligibleRecipient = recipients.find((recipient) => recipient.salon_customer_id === eligibleCustomerId);
  assert.ok(eligibleRecipient?.unsubscribe_token, "eligible recipient has unsubscribe token");
  await owner.context.close();

  const anon = await browser.newContext();
  const unsubscribed = await anon.newPage();
  await unsubscribed.goto(`${baseUrl}/api/marketing/unsubscribe?token=${eligibleRecipient.unsubscribe_token}`, { waitUntil: "domcontentloaded" });
  await unsubscribed.getByText("Email preferences updated", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await anon.close();
  const { data: afterUnsubscribe, error: afterError } = await admin.from("marketing_campaign_recipients").select("eligibility").eq("campaign_id", campaign.id).eq("salon_customer_id", eligibleCustomerId).single();
  if (afterError) throw afterError;
  assert.equal(afterUnsubscribe.eligibility, "unsubscribed");
  const { count: suppressionCount, error: suppressionError } = await admin.from("marketing_suppressions").select("id", { count: "exact", head: true }).eq("studio_id", studioId).eq("salon_customer_id", eligibleCustomerId).eq("reason", "unsubscribed");
  if (suppressionError) throw suppressionError;
  assert.equal(suppressionCount, 1, "unsubscribe creates suppression");

  const instructor = await login(MKT01_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/marketing${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("You do not have access to marketing.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({ schema_version: 1, run_id: runId, status: "passed", assertions: [{ name: "consent-safe VIP snapshot", result: "passed" }, { name: "anonymous unsubscribe and role denial", result: "passed" }] }, null, 2)}\n`);
  console.log("mkt01_local_uat_ok");
} finally { await browser.close(); }
