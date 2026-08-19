import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { OPS_LOCAL_IDENTITIES } from "./fixtures/ops-local-identities.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "OPS_UAT_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPS_UAT_DB_URL",
  "OPS_UAT_STUDIO_ID",
  "OPS_UAT_LOCATION_ID",
  "OPS_UAT_CLASS_PAYMENT_ID",
  "OPS_UAT_EVENT_PAYMENT_ID",
  "OPS_UAT_RUN_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local ops UAT environment: ${key}`);

const baseUrl = process.env.OPS_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const studioId = process.env.OPS_UAT_STUDIO_ID;
const locationId = process.env.OPS_UAT_LOCATION_ID;
const classPaymentId = process.env.OPS_UAT_CLASS_PAYMENT_ID;
const eventPaymentId = process.env.OPS_UAT_EVENT_PAYMENT_ID;
const runId = process.env.OPS_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl: process.env.OPS_UAT_DB_URL });

const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "ops-board-uat", runId);
const query = `?studio_id=${studioId}&location_id=${locationId}`;

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

try {
  const owner = await login(OPS_LOCAL_IDENTITIES.owner);
  await owner.page.goto(`${baseUrl}/dashboard${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.waitForURL((url) => url.pathname.includes("/dashboard/operations"), { timeout: 30_000 });
  await owner.page.getByRole("link", { name: "Front desk", exact: true }).first().waitFor({ state: "visible", timeout: 15_000 });
  await owner.page.getByRole("link", { name: "Appointments", exact: true }).first().waitFor({ state: "visible" });
  await owner.page.getByRole("heading", { name: "Ops UAT Class" }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "ops board mobile overflow");

  const headings = await owner.page.locator("h1, h2").allInnerTexts();
  const classIdx = headings.indexOf("Class sessions");
  assert.ok(classIdx >= 0, "class sessions heading");
  assert.equal(headings.includes("Package adjustment checks"), false, "package checks stay off the default Front desk tab");

  await owner.page.getByRole("link", { name: "Adjustment audit", exact: true }).click();
  await owner.page.getByRole("heading", { name: "Package adjustment checks" }).waitFor({ state: "visible", timeout: 15_000 });
  await owner.page.goBack({ waitUntil: "domcontentloaded" });
  await owner.page.getByRole("heading", { name: "Class sessions" }).waitFor({ state: "visible", timeout: 15_000 });

  const sessionCard = owner.page.getByRole("heading", { level: 3, name: "Ops UAT Class", exact: true }).locator("xpath=ancestor::section[1]");
  await sessionCard.getByText("Almost full", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  await sessionCard.getByText("1 unpaid", { exact: true }).waitFor({ state: "visible" });
  const sessionRows = sessionCard.locator("li");
  assert.equal((await sessionRows.first().innerText()).includes("Ops Unpaid Guest"), true, "unpaid class attendee is first");
  await sessionRows.first().getByText("Pending payment", { exact: true }).waitFor({ state: "visible" });
  const classCollect = sessionRows.first().getByRole("link", { name: "Collect payment" });
  await classCollect.waitFor({ state: "visible" });
  assert.match(await classCollect.getAttribute("href"), new RegExp(`payment_id=${classPaymentId}`));
  assert.match(await classCollect.getAttribute("href"), /\/dashboard\/payments/);

  const eventCard = owner.page.getByRole("heading", { level: 3, name: "Ops UAT Event", exact: true }).locator("xpath=ancestor::section[1]");
  await eventCard.getByText("1 unpaid", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
  const eventCollect = eventCard.getByRole("link", { name: "Collect payment" });
  await eventCollect.waitFor({ state: "visible" });
  assert.match(await eventCollect.getAttribute("href"), new RegExp(`payment_id=${eventPaymentId}`));
  await classCollect.click();
  await owner.page.waitForURL((url) => (
    url.pathname.includes("/dashboard/payments") && url.searchParams.get("payment_id") === classPaymentId
  ), { timeout: 30_000 });
  await owner.context.close();

  const instructor = await login(OPS_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/operations${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByRole("heading", { name: "Create your first studio" }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "dashboard landing keeps Front desk and Appointments distinct", result: "passed" },
      { name: "live queue and package checks are on separate Front desk tabs", result: "passed" },
      { name: "capacity and unpaid badges with unpaid rows first", result: "passed" },
      { name: "class collect-payment opens Payments for payment_id-only rows", result: "passed" },
      { name: "instructor cannot open operations board", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("ops_board_local_uat_ok");
} finally {
  await browser.close();
}
