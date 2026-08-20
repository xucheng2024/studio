import assert from "node:assert/strict";
import { chromium } from "playwright";
import { CMP01_LOCAL_IDENTITIES } from "./fixtures/cmp01-local-identities.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "CMP01_UAT_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CMP01_UAT_DB_URL",
  "CMP01_UAT_STUDIO_ID",
  "CMP01_UAT_LOCATION_ID",
  "CMP01_UAT_CUSTOMER_ID",
  "CMP01_UAT_RUN_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local cmp01 UAT environment: ${key}`);
const baseUrl = process.env.CMP01_UAT_BASE_URL;
assertLocalUatTargets({ baseUrl, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, databaseUrl: process.env.CMP01_UAT_DB_URL });
const studioId = process.env.CMP01_UAT_STUDIO_ID;
const locationId = process.env.CMP01_UAT_LOCATION_ID;
const customerId = process.env.CMP01_UAT_CUSTOMER_ID;
const publicSlug = `cmp01-local-${studioId.slice(0, 8)}`;
const browser = await chromium.launch({ headless: true });
try {
  const instructorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await instructorContext.addCookies(await createLocalSessionCookies({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    identity: CMP01_LOCAL_IDENTITIES.instructor,
    baseUrl,
  }));
  const instructorPage = await instructorContext.newPage();
  await instructorPage.goto(`${baseUrl}/dashboard/settings/privacy?studio_id=${studioId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.match(await instructorPage.locator("body").innerText(), /do not have access/i, "instructor is denied privacy settings");
  await instructorContext.close();

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    identity: CMP01_LOCAL_IDENTITIES.owner,
    baseUrl,
  }));
  const page = await context.newPage();
  await page.goto(`${baseUrl}/dashboard/settings/privacy?studio_id=${studioId}&location_id=${locationId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "Privacy & data" }).waitFor({ state: "visible", timeout: 30000 });
  const settingsBody = await page.locator("body").innerText();
  assert.match(settingsBody, /Supabase/);
  assert.match(settingsBody, /HitPay/);
  assert.match(settingsBody, /Resend/);
  assert.match(settingsBody, /Retention/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "cmp01 mobile overflow");
  await page.getByRole("button", { name: /Save (consent version|privacy-v1\.0)/i }).click();
  await page.getByText(/Consent version saved/i).first().waitFor({ state: "visible", timeout: 30000 });
  assert.match(await page.locator("body").innerText(), /Not shown on the public studio page/i);

  const privacyResponse = await page.goto(`${baseUrl}/${publicSlug}/privacy`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(privacyResponse?.status(), 404, "generic public privacy page stays hidden");
  assert.doesNotMatch(await page.locator("body").innerText(), /What we collect/i);

  await page.goto(`${baseUrl}/${publicSlug}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.doesNotMatch(await page.locator("body").innerText(), /Privacy notice/);

  await page.goto(`${baseUrl}/dashboard/clients/${customerId}?studio_id=${studioId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "Access / correction requests" }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "Record request" }).click();
  await page.getByText(/Data request recorded/i).first().waitFor({ state: "visible", timeout: 30000 });
  await context.close();
} finally {
  await browser.close();
}
