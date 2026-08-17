import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { APT_LOCAL_IDENTITIES } from "./fixtures/apt-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "APT03_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APT03_UAT_DB_URL",
  "APT03_UAT_STUDIO_ID", "APT03_UAT_LOCATION_L1_ID", "APT03_UAT_LOCATION_L2_ID", "APT03_UAT_CUSTOMER_L1_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing APT-03 local UAT environment: ${key}`);

const baseUrl = process.env.APT03_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.APT03_UAT_DB_URL;
const studioId = process.env.APT03_UAT_STUDIO_ID;
const locationL1Id = process.env.APT03_UAT_LOCATION_L1_ID;
const locationL2Id = process.env.APT03_UAT_LOCATION_L2_ID;
const customerL1Id = process.env.APT03_UAT_CUSTOMER_L1_ID;
const runId = process.env.APT03_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "apt03-uat", runId);
const slotDate = "2026-08-19";
const slotLocal = `${slotDate}T10:00`;

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

async function waitForToast(page, message) {
  await page.getByText(message, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

try {
  const owner = await login(APT_LOCAL_IDENTITIES.owner);
  const ownerQuery = `?studio_id=${studioId}&location_id=${locationL1Id}&date=${slotDate}&view=day`;
  await owner.page.goto(`${baseUrl}/dashboard/appointments${ownerQuery}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "appointments mobile overflow");

  const createForm = owner.page.locator("form").filter({ has: owner.page.getByRole("button", { name: "Create appointment" }) });
  await createForm.locator('select[name="salon_customer_id"]').selectOption({ label: "APT-03 L1 customer" });
  await createForm.locator('select[name="service_id"]').selectOption({ label: "APT-03 local service" });
  await createForm.locator('select[name="employee_id"]').selectOption({ label: "APT-03 instructor" });
  await createForm.locator('input[name="starts_at"]').fill(slotLocal);
  await createForm.getByRole("button", { name: "Create appointment" }).click();
  await waitForToast(owner.page, "Appointment created.");

  const created = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("salon_appointments")
      .select("id, status")
      .eq("salon_customer_id", customerL1Id)
      .eq("location_id", locationL1Id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "pending", "owner created pending appointment");

  await owner.page.reload({ waitUntil: "domcontentloaded" });
  const card = owner.page.locator("article").filter({ hasText: "APT-03 L1 customer" });
  await card.getByRole("button", { name: "Confirm" }).click();
  await waitForToast(owner.page, "Appointment moved to confirmed.");
  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("salon_appointments").select("status").eq("id", created.id).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "confirmed", "confirmed");

  await owner.page.reload({ waitUntil: "domcontentloaded" });
  await card.getByRole("button", { name: "Check-in" }).click();
  await waitForToast(owner.page, "Appointment moved to checked in.");
  await owner.page.reload({ waitUntil: "domcontentloaded" });
  await card.getByRole("button", { name: "Start" }).click();
  await waitForToast(owner.page, "Appointment moved to in progress.");
  await owner.page.reload({ waitUntil: "domcontentloaded" });
  await card.getByRole("button", { name: "Complete" }).click();
  await waitForToast(owner.page, "Appointment moved to completed.");
  await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("salon_appointments").select("status").eq("id", created.id).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "completed", "completed");
  await owner.context.close();

  const instructor = await login(APT_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/appointments${ownerQuery}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("APT-03 L1 customer", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await instructor.page.getByRole("heading", { name: "Create appointment" }).count(), 0, "instructor cannot create appointments");
  assert.equal(await instructor.page.getByText("APT-03 L2 customer").count(), 0, "instructor does not see other-employee L2 appointment");
  await instructor.context.close();

  const frontdesk = await login(APT_LOCAL_IDENTITIES.frontdesk);
  await frontdesk.page.goto(`${baseUrl}/dashboard/appointments?studio_id=${studioId}&location_id=${locationL2Id}&date=${slotDate}&view=day`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await frontdesk.page.getByText("APT-03 L2 customer").count(), 0, "frontdesk cannot read L2 appointment");
  await frontdesk.page.goto(`${baseUrl}/dashboard/appointments${ownerQuery}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await frontdesk.page.getByText("APT-03 L1 customer", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await frontdesk.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "owner create-confirm-checkin-start-complete", result: "passed" },
      { name: "instructor sees own appointment and cannot create", result: "passed" },
      { name: "frontdesk is denied cross-location L2 appointment", result: "passed" },
      { name: "390px layout has no horizontal overflow", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("apt03_local_uat_ok");
} finally {
  await browser.close();
}
