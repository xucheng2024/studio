import assert from "node:assert/strict";
import { chromium } from "playwright";
import { CRM02_LOCAL_IDENTITIES } from "./fixtures/crm02-local-identities.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const baseUrl = process.env.CRM02_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.CRM02_UAT_DB_URL;
if (!baseUrl || !supabaseUrl || !anonKey || !serviceRoleKey || !databaseUrl) throw new Error("Missing local CRM-02 UAT environment");
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });
const studioId = "c2000000-0000-4000-8000-000000000001";
const browser = await chromium.launch({ headless: true });
try {
  // This smoke uses the owner; all local role identities are seeded for
  // feature-specific authorization tests that need them.
  for (const [role, identity] of [["owner", CRM02_LOCAL_IDENTITIES.owner]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
    const page = await context.newPage();
    await page.goto(`${baseUrl}/dashboard/clients?studio_id=${studioId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByText("CRM local customer", { exact: false }).first().waitFor({ state: "visible", timeout: 30000 });
    const body = await page.locator("body").innerText();
    assert.match(body, /CRM local customer/, `${role} can read scoped client`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${role} mobile overflow`);
    const customerId = "c2000000-0000-4000-8000-000000000301";
    await page.goto(`${baseUrl}/dashboard/clients/${customerId}?studio_id=${studioId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("navigation", { name: "Customer profile sections" }).waitFor({ state: "visible", timeout: 30000 });
    const detailBody = await page.locator("body").innerText();
    for (const label of ["Overview", "Health", "Appointments", "Treatments", "Purchases", "Follow-up", "Consent", "Audit"]) {
      assert.match(detailBody, new RegExp(label), `${role} sees ${label} section`);
    }
    assert.match(detailBody, /Customer profile/, `${role} defaults to Overview`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${role} detail overflow`);
    await page.getByRole("link", { name: /^Health/ }).click();
    await page.getByRole("heading", { name: "Health & safety" }).waitFor({ state: "visible", timeout: 30000 });
    await page.getByRole("link", { name: /^Follow-up/ }).click();
    await page.getByRole("heading", { name: "Follow-up" }).waitFor({ state: "visible", timeout: 30000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${role} section overflow`);
    await page.goto(`${baseUrl}/dashboard/clients/follow-ups?studio_id=${studioId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByText("Follow-up queue", { exact: false }).first().waitFor({ state: "visible", timeout: 30000 });
    assert.match(await page.locator("body").innerText(), /Follow-up queue/);
    await context.close();
  }
} finally { await browser.close(); }
