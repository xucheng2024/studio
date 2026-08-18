import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { PAY01_LOCAL_IDENTITIES } from "./fixtures/pay01-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "PAY01_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "PAY01_UAT_DB_URL", "PAY01_UAT_STUDIO_ID", "PAY01_UAT_LOCATION_ID", "PAY01_UAT_EMPLOYEE_ID", "PAY01_UAT_RUN_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local pay01 UAT environment: ${key}`);

const baseUrl = process.env.PAY01_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.PAY01_UAT_DB_URL;
const studioId = process.env.PAY01_UAT_STUDIO_ID;
const locationId = process.env.PAY01_UAT_LOCATION_ID;
const employeeId = process.env.PAY01_UAT_EMPLOYEE_ID;
const runId = process.env.PAY01_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "pay01-payroll-uat", runId);
const query = `?studio_id=${studioId}&location_id=${locationId}`;

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

async function waitToast(page, text) {
  await page.locator("[data-sonner-toast]").filter({ hasText: text }).first().waitFor({ state: "visible", timeout: 30_000 });
}

try {
  const owner = await login(PAY01_LOCAL_IDENTITIES.owner);
  await owner.page.goto(`${baseUrl}/dashboard/payroll${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByRole("heading", { name: "Payroll" }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "payroll list mobile overflow");
  assert.ok(await owner.page.getByRole("link", { name: "Payroll" }).count() > 0, "owner sees Payroll nav");
  await owner.page.getByRole("link", { name: "PAY local instructor" }).click();
  await owner.page.getByRole("heading", { name: "PAY local instructor" }).waitFor({ state: "visible", timeout: 30_000 });
  console.log("pay01_owner_profile_open");

  const profileForm = owner.page.locator("form").filter({ hasText: "New profile version" });
  await profileForm.getByLabel("Job title").fill("Stylist");
  await profileForm.getByLabel("Effective from").fill("2026-08-01");
  await profileForm.getByLabel("Date of birth").fill("1990-06-15");
  await profileForm.getByLabel("Residency").selectOption("citizen");
  await profileForm.getByLabel("Salary type").selectOption("monthly");
  await profileForm.getByLabel("Monthly basic pay (SGD)").fill("2000");
  await profileForm.getByLabel("SHG fund").selectOption("cdac");
  await profileForm.getByRole("button", { name: "Save new version" }).click();
  await owner.page.getByText("Profile has the fields required for Finalise.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  console.log("pay01_owner_profile_saved");

  const profile = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("employee_payroll_profile_versions")
      .select("id, residency_status, salary_type, basic_pay_sgd, shg_fund, effective_to")
      .eq("studio_id", studioId)
      .eq("employee_id", employeeId)
      .is("effective_to", null)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.residency_status === "citizen" && row?.salary_type === "monthly", "payroll profile version");
  assert.equal(Number(profile.basic_pay_sgd), 2000);
  assert.equal(profile.shg_fund, "cdac");

  await owner.page.getByRole("link", { name: "← Payroll" }).click();
  await owner.page.getByRole("heading", { name: "Payroll" }).waitFor({ state: "visible", timeout: 30_000 });
  const month = owner.page.getByLabel("New draft month");
  await month.fill("2026-08");
  if (await month.inputValue() !== "2026-08") {
    await month.evaluate((el) => {
      el.value = "2026-08";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  await owner.page.getByRole("button", { name: "Create draft" }).click();
  await owner.page.getByRole("link", { name: "2026-08" }).waitFor({ state: "visible", timeout: 30_000 });
  console.log("pay01_owner_draft_created");

  await owner.page.getByRole("link", { name: "2026-08" }).click();
  await owner.page.getByRole("heading", { name: "2026-08 payroll" }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "payroll run mobile overflow");
  await owner.page.getByText("2000.00", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByText("1599.50", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByText("Ready", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByRole("button", { name: "Finalise" }).waitFor({ state: "visible", timeout: 30_000 });
  await owner.page.getByRole("button", { name: "Recalculate" }).click();
  try {
    await waitToast(owner.page, "Draft recalculated from current profiles and commission entries.");
  } catch (error) {
    const toasts = await owner.page.locator("[data-sonner-toast]").allInnerTexts().catch(() => []);
    console.log("pay01_recalculate_toast_missing", { toasts, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  console.log("pay01_owner_recalculated");

  const payrollRun = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("payroll_runs")
      .select("id, status, period_start, company_sdl_sgd")
      .eq("studio_id", studioId)
      .eq("period_start", "2026-08-01")
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "draft", "draft payroll run");
  assert.equal(payrollRun.period_start, "2026-08-01");
  assert.equal(Number(payrollRun.company_sdl_sgd), 5);
  const { data: runEmployee, error: runEmployeeError } = await admin
    .from("payroll_run_employees")
    .select("gross_sgd, net_sgd, employee_cpf_sgd, shg_sgd, blocker_codes")
    .eq("payroll_run_id", payrollRun.id)
    .eq("employee_id", employeeId)
    .single();
  if (runEmployeeError) throw runEmployeeError;
  assert.equal(Number(runEmployee.gross_sgd), 2000);
  assert.equal(Number(runEmployee.net_sgd), 1599.5);
  assert.equal(Number(runEmployee.employee_cpf_sgd), 400);
  assert.equal(Number(runEmployee.shg_sgd), 0.5);
  assert.deepEqual(runEmployee.blocker_codes, []);
  await owner.context.close();

  const manager = await login(PAY01_LOCAL_IDENTITIES.manager);
  await manager.page.goto(`${baseUrl}/dashboard/payroll${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await manager.page.getByText("Only studio owners can open Payroll.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await manager.page.getByRole("link", { name: "Payroll" }).count(), 0, "manager has no Payroll nav");
  assert.equal(await manager.page.getByRole("link", { name: "My pay" }).count(), 0, "manager has no My pay nav");
  await manager.context.close();
  console.log("pay01_manager_denied");

  const instructor = await login(PAY01_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/payroll/me${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByRole("heading", { name: "My pay" }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.page.getByText("PAY local instructor", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  assert.ok(await instructor.page.getByRole("link", { name: "My pay" }).count() > 0, "instructor sees My pay nav");
  assert.equal(await instructor.page.getByRole("link", { name: "Payroll" }).count(), 0, "instructor has no Payroll nav");
  assert.equal(await instructor.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "my pay mobile overflow");
  await instructor.page.goto(`${baseUrl}/dashboard/payroll${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("Only studio owners can open Payroll.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  await instructor.context.close();
  console.log("pay01_instructor_my_pay");

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "owner-profile-and-draft-run", result: "passed" },
      { name: "manager-payroll-denied", result: "passed" },
      { name: "instructor-my-pay", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("pay01_local_uat_ok");
} finally {
  await browser.close();
}
