import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { APT_LOCAL_IDENTITIES } from "./fixtures/apt-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "APT01_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APT01_UAT_DB_URL",
  "APT01_UAT_STUDIO_ID", "APT01_UAT_LOCATION_ID", "APT01_UAT_EMPLOYEE_ID", "APT01_UAT_SERVICE_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing APT-01 local UAT environment: ${key}`);

const baseUrl = process.env.APT01_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.APT01_UAT_DB_URL;
const studioId = process.env.APT01_UAT_STUDIO_ID;
const locationId = process.env.APT01_UAT_LOCATION_ID;
const employeeId = process.env.APT01_UAT_EMPLOYEE_ID;
const serviceId = process.env.APT01_UAT_SERVICE_ID;
const runId = process.env.APT01_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "apt01-uat", runId);
const query = `?studio_id=${studioId}&location_id=${locationId}`;

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

async function waitForToast(page, message) {
  await page.getByText(message, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function assertDenied(identity, pathSuffix) {
  const session = await login(identity);
  await session.page.goto(`${baseUrl}${pathSuffix}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await session.page.getByText("You do not have access to this page.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await session.context.close();
}

try {
  const owner = await login(APT_LOCAL_IDENTITIES.owner);

  await owner.page.goto(`${baseUrl}/dashboard/services${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "services mobile overflow");
  await owner.page.getByRole("heading", { name: "APT-01 local service" }).click();
  await owner.page.getByLabel("Duration (mins)").fill("45");
  await owner.page.getByRole("button", { name: "Save appointment defaults" }).click();
  await waitForToast(owner.page, "Availability defaults saved.");
  const service = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("studio_services").select("default_duration_minutes").eq("id", serviceId).single();
    if (error) throw error;
    return data;
  }, (row) => row?.default_duration_minutes === 45, "service duration saved");
  assert.equal(service.default_duration_minutes, 45);

  await owner.page.goto(`${baseUrl}/dashboard/settings/resources${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "resources mobile overflow");
  await owner.page.getByLabel("Name").fill("APT-01 Bed");
  await owner.page.getByRole("button", { name: "Add resource" }).click();
  await waitForToast(owner.page, "Resource created.");
  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("salon_resources").select("id, name").eq("studio_id", studioId).eq("location_id", locationId).eq("name", "APT-01 Bed").maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.name === "APT-01 Bed", "resource created");

  await owner.page.goto(`${baseUrl}/dashboard/settings/staff-availability${query}&employee_id=${employeeId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "staff availability mobile overflow");
  await owner.page.getByLabel("Monday start").fill("09:00");
  await owner.page.getByLabel("Monday end").fill("18:00");
  await owner.page.getByRole("button", { name: "Save working hours" }).click();
  await waitForToast(owner.page, "Working hours saved.");
  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("employee_working_hours")
      .select("starts_at, ends_at")
      .eq("employee_id", employeeId)
      .eq("location_id", locationId)
      .eq("weekday", 1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => String(row?.starts_at).startsWith("09:00") && String(row?.ends_at).startsWith("18:00"), "working hours saved");
  await owner.context.close();

  for (const identity of [APT_LOCAL_IDENTITIES.frontdesk, APT_LOCAL_IDENTITIES.instructor]) {
    await assertDenied(identity, "/dashboard/services");
    await assertDenied(identity, "/dashboard/settings/resources");
    await assertDenied(identity, "/dashboard/settings/staff-availability");
  }

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "owner writes availability defaults, resource, and working hours", result: "passed" },
      { name: "frontdesk and instructor are denied configuration pages", result: "passed" },
      { name: "390px layout has no horizontal overflow", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("apt01_local_uat_ok");
} finally {
  await browser.close();
}
