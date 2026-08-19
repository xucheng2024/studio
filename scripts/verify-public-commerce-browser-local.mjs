import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { PUBLIC_LOCAL_IDENTITIES } from "./fixtures/public-local-identities.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = ["PUBLIC_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "PUBLIC_UAT_DB_URL", "PUBLIC_UAT_STUDIO_ID", "PUBLIC_UAT_LOCATION_ID", "PUBLIC_UAT_SERVICE_ID", "PUBLIC_UAT_PACKAGE_ID", "PUBLIC_UAT_EVENT_ID", "PUBLIC_UAT_RUN_ID"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local public UAT environment: ${key}`);
const baseUrl = process.env.PUBLIC_UAT_BASE_URL;
assertLocalUatTargets({ baseUrl, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, databaseUrl: process.env.PUBLIC_UAT_DB_URL });
const studioId = process.env.PUBLIC_UAT_STUDIO_ID;
const locationId = process.env.PUBLIC_UAT_LOCATION_ID;
const serviceId = process.env.PUBLIC_UAT_SERVICE_ID;
const packageId = process.env.PUBLIC_UAT_PACKAGE_ID;
const runId = process.env.PUBLIC_UAT_RUN_ID;
const publicSlug = `public-local-${studioId.slice(0, 8)}`;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const evidenceDir = path.join(process.cwd(), "tmp", "public-commerce-uat", runId);
const browser = await chromium.launch({ headless: true });
try {
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ownerContext.addCookies(await createLocalSessionCookies({
    supabaseUrl,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey,
    identity: PUBLIC_LOCAL_IDENTITIES.owner,
    baseUrl,
  }));
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${baseUrl}/dashboard/events?studio_id=${studioId}&location_id=${locationId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await ownerPage.getByRole("link", { name: "Past events" }).first().click();
  await ownerPage.getByText("Public UAT past event", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await ownerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "events mobile overflow");
  await ownerContext.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${publicSlug}/services/public-uat-service`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const serviceForm = page.locator("form").filter({ has: page.getByRole("button", { name: /Confirm order/i }) });
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await page.getByRole("button", { name: "Increase quantity" }).click();
  await serviceForm.getByRole("textbox", { name: "Name", exact: true }).fill("Public UAT buyer");
  await serviceForm.getByRole("textbox", { name: "Email", exact: true }).fill("public-uat-buyer@example.test");
  await serviceForm.locator('input[type="tel"]').fill("81234567");
  await Promise.all([
    page.waitForURL(/\/checkout\//, { timeout: 30_000 }),
    page.getByRole("button", { name: /Confirm order/i }).click(),
  ]);
  const { data: serviceOrder, error: serviceOrderError } = await admin
    .from("service_orders")
    .select("qty, amount")
    .eq("service_id", serviceId)
    .eq("guest_email", "public-uat-buyer@example.test")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (serviceOrderError) throw serviceOrderError;
  assert.equal(serviceOrder.qty, 3, "service purchase persists selected quantity");
  assert.equal(Number(serviceOrder.amount), 0, "service purchase computes quantity total");

  await page.goto(`${baseUrl}/${publicSlug}/packages`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const packageLink = page.getByRole("link", { name: "Get package" });
  await packageLink.waitFor({ state: "visible", timeout: 30_000 });
  const packageHref = await packageLink.getAttribute("href");
  assert.ok(packageHref?.includes("/packages/"), "missing package slug is backfilled into Buy now link");
  const { data: packageRow, error: packageError } = await admin.from("packages").select("share_slug").eq("id", packageId).single();
  if (packageError) throw packageError;
  assert.ok(packageRow.share_slug, "public package list backfills missing share slug");

  await page.goto(`${baseUrl}${packageHref}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const packageForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Get package" }) });
  await page.route("**/api/package/buy", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ payment_id: "public-uat-fallback-payment" }) });
  });
  await packageForm.getByRole("textbox", { name: "Name", exact: true }).fill("Package UAT buyer");
  await packageForm.getByRole("textbox", { name: "Email", exact: true }).fill("package-uat-buyer@example.test");
  await packageForm.locator('input[type="tel"]').fill("81234568");
  await Promise.all([
    page.waitForURL(/\/checkout\/public-uat-fallback-payment$/, { timeout: 30_000 }),
    packageForm.getByRole("button", { name: "Get package" }).click(),
  ]);
  await page.unroute("**/api/package/buy");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "public commerce mobile overflow");
  await context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "dashboard past events shortcut", result: "passed" },
      { name: "public service quantity payment", result: "passed" },
      { name: "public package slug and checkout fallback", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("public_commerce_local_uat_ok");
} finally {
  await browser.close();
}
