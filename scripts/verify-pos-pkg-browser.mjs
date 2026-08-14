/** Read-only production browser UAT for POS/Package role and mobile gates. */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const BASE_URL = process.env.POS_PKG_BASE_URL || "https://www.sgmystudio.com";

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(".env.local"), ...process.env };
const fixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "crm02-playwright-accounts.json"), "utf8"),
);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase target environment values");

const configuredProjectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (configuredProjectRef !== fixture.projectRef) {
  throw new Error("POS/Package browser fixture does not belong to the configured Supabase project");
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function magicLink(email, nextPath) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${BASE_URL}/auth?next=${encodeURIComponent(nextPath)}`,
    },
  });
  if (error) throw error;
  return data.properties.action_link;
}

async function login(browser, email, nextPath, viewport) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  await page.goto(await magicLink(email, nextPath), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

async function pageContains(page, url, expectedText, { heading = false } = {}) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  const locator = heading
    ? page.getByRole("heading", { name: expectedText, exact: false }).first()
    : page.getByText(expectedText, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: 20000 });
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  const roleChecks = [
    { label: "owner", user: fixture.users.owner, locationId: null, allowed: true },
    { label: "manager-global", user: fixture.users.managerGlobal, locationId: null, allowed: true },
    { label: "manager-location", user: fixture.users.managerL1, locationId: fixture.locations.l1, allowed: true },
    { label: "frontdesk-location", user: fixture.users.frontdeskL1, locationId: fixture.locations.l1, allowed: true },
    { label: "instructor", user: fixture.users.instructorL1, locationId: fixture.locations.l1, allowed: false },
  ];

  for (const check of roleChecks) {
    const params = new URLSearchParams({ studio_id: fixture.studioId });
    if (check.locationId) params.set("location_id", check.locationId);
    const posPath = `/dashboard/pos?${params}`;
    const { context, page } = await login(browser, check.user.email, posPath);
    try {
      if (check.allowed) {
        await pageContains(page, `${BASE_URL}${posPath}`, "POS sales", { heading: true });
        await pageContains(page, `${BASE_URL}/dashboard/pos/cash-sessions?${params}`, "Cash sessions", { heading: true });
        await pageContains(page, `${BASE_URL}/dashboard/packages/approvals?${params}`, "Package approvals", { heading: true });
      } else {
        await pageContains(page, `${BASE_URL}${posPath}`, "You do not have access to POS sales");
        await pageContains(page, `${BASE_URL}/dashboard/pos/cash-sessions?${params}`, "You do not have access to cash sessions");
        await pageContains(page, `${BASE_URL}/dashboard/packages/approvals?${params}`, "You do not have access to this page");
      }
      results.push({ role: check.label, ok: true, expectedAccess: check.allowed });
    } catch (error) {
      results.push({ role: check.label, ok: false, expectedAccess: check.allowed, error: String(error.message || error) });
    } finally {
      await context.close();
    }
  }

  const mobileParams = new URLSearchParams({ studio_id: fixture.studioId });
  const mobilePath = `/dashboard/pos?${mobileParams}`;
  const { context: mobileContext, page: mobilePage } = await login(
    browser,
    fixture.users.owner.email,
    mobilePath,
    { width: 390, height: 844 },
  );
  try {
    for (const pathToCheck of [
      mobilePath,
      `/dashboard/pos/cash-sessions?${mobileParams}`,
      `/dashboard/packages/approvals?${mobileParams}`,
    ]) {
      await mobilePage.goto(`${BASE_URL}${pathToCheck}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await mobilePage.waitForTimeout(800);
      const overflow = await mobilePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) throw new Error(`390px horizontal overflow at ${pathToCheck.split("?")[0]}`);
    }
    results.push({ role: "owner-mobile-390", ok: true, expectedAccess: true });
  } catch (error) {
    results.push({ role: "owner-mobile-390", ok: false, expectedAccess: true, error: String(error.message || error) });
  } finally {
    await mobileContext.close();
  }
} finally {
  await browser.close();
}

const failures = results.filter((result) => !result.ok);
console.log(JSON.stringify({
  ok: failures.length === 0,
  baseUrl: BASE_URL,
  checks: results,
}, null, 2));
if (failures.length > 0) process.exit(1);
