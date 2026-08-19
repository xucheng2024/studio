import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { POS_LOCAL_IDENTITIES } from "./fixtures/pos-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "PKG01_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PKG01_UAT_DB_URL",
  "PKG01_UAT_STUDIO_ID", "PKG01_UAT_LOCATION_ID", "PKG01_UAT_CUSTOMER_ID", "PKG01_UAT_SALE_ID", "PKG01_UAT_SALE_ITEM_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing PKG-01 local UAT environment: ${key}`);

const baseUrl = process.env.PKG01_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.PKG01_UAT_DB_URL;
const studioId = process.env.PKG01_UAT_STUDIO_ID;
const locationId = process.env.PKG01_UAT_LOCATION_ID;
const customerId = process.env.PKG01_UAT_CUSTOMER_ID;
const saleId = process.env.PKG01_UAT_SALE_ID;
const saleItemId = process.env.PKG01_UAT_SALE_ITEM_ID;
const runId = process.env.PKG01_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "pkg01-uat", runId);

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

async function waitForToast(page, message) {
  await page.getByText(message, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

try {
  const query = `?studio_id=${studioId}&location_id=${locationId}`;
  const owner = await login(POS_LOCAL_IDENTITIES.owner);

  await owner.page.goto(`${baseUrl}/dashboard/pos/cash-sessions${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "cash-session mobile overflow");
  await owner.page.getByLabel("Opening float (SGD)").fill("50.00");
  await owner.page.getByLabel("Notes").fill("PKG-01 local package grant");
  await owner.page.getByRole("button", { name: "Open cash session" }).click();
  await waitForToast(owner.page, "Cash session opened.");

  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("pos_cash_sessions")
      .select("id, status")
      .eq("studio_id", studioId)
      .eq("location_id", locationId)
      .eq("status", "open")
      .single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "open", "opened cash session");

  await owner.page.goto(`${baseUrl}/dashboard/pos/${saleId}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByText("PKG-01 local package", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByRole("button", { name: "Mark as paid (cash)" }).click();
  await waitForToast(owner.page, "Cash payment confirmed.");

  const grant = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("client_package_ledger_entries")
      .select("id, event_type, delta_credits, client_package_id")
      .eq("studio_id", studioId)
      .eq("pos_sale_id", saleId)
      .eq("event_type", "purchase_grant")
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.event_type === "purchase_grant" && Number(row.delta_credits) === 6, "purchase grant ledger");
  console.log("pkg01_purchase_grant_ok", { saleId, deltaCredits: grant.delta_credits, clientPackageId: grant.client_package_id });
  const grantedPackage = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("client_packages").select("id, credits_left").eq("id", grant.client_package_id).single();
    if (error) throw error;
    return data;
  }, (row) => Number(row?.credits_left) === 6, "granted package credits");

  await owner.page.goto(`${baseUrl}/dashboard/clients/${customerId}${query}&section=purchases`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "ledger mobile overflow");
  await owner.page.getByRole("heading", { name: "Current packages" }).waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByText("PKG-01 local package", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByText("6 / 6", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });

  await owner.page.goto(`${baseUrl}/dashboard/pos/${saleId}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.locator(`input[name="refund_item_id"][value="${saleItemId}"]`).check();
  await owner.page.locator(`input[name="refund_amount__${saleItemId}"]`).fill("120.00");
  await owner.page.getByLabel("Refund reason (optional)").fill("PKG-01 local full package refund");
  owner.page.once("dialog", (dialog) => dialog.accept());
  await owner.page.getByRole("button", { name: "Refund items" }).click();
  await waitForToast(owner.page, "Sale fully refunded.");
  console.log("pkg01_refund_toast_ok", { saleId, saleItemId });

  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("client_package_ledger_entries")
      .select("id, event_type, delta_credits")
      .eq("studio_id", studioId)
      .eq("pos_sale_id", saleId)
      .eq("event_type", "refund_reversal")
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.event_type === "refund_reversal" && Number(row.delta_credits) === -6, "refund reversal ledger");
  const { data: reversedPackage, error: reversedError } = await admin.from("client_packages").select("credits_left").eq("id", grantedPackage.id).single();
  if (reversedError) throw reversedError;
  assert.equal(Number(reversedPackage.credits_left), 0, "full package refund returns credits to zero");

  await owner.page.goto(`${baseUrl}/dashboard/clients/${customerId}${query}&section=purchases`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByText("0 / 6", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
  await owner.context.close();

  const instructor = await login(POS_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/pos${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("You do not have access to POS sales.", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "paid package sale writes purchase_grant and visible credits", result: "passed" },
      { name: "full package refund writes refund_reversal and returns credits", result: "passed" },
      { name: "POS access control and mobile layout", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("pkg01_local_uat_ok");
} finally {
  await browser.close();
}
