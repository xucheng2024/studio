import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { POS_LOCAL_IDENTITIES } from "./fixtures/pos-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "POS02_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "POS02_UAT_DB_URL",
  "POS02_UAT_STUDIO_ID", "POS02_UAT_LOCATION_ID", "POS02_UAT_SALE_ID", "POS02_UAT_PAYMENT_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing POS-02 local UAT environment: ${key}`);

const baseUrl = process.env.POS02_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.POS02_UAT_DB_URL;
const studioId = process.env.POS02_UAT_STUDIO_ID;
const locationId = process.env.POS02_UAT_LOCATION_ID;
const saleId = process.env.POS02_UAT_SALE_ID;
const paymentId = process.env.POS02_UAT_PAYMENT_ID;
const runId = process.env.POS02_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "pos02-uat", runId);

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
  await owner.page.getByLabel("Notes").fill("POS-02 local cash collection");
  await owner.page.getByRole("button", { name: "Open cash session" }).click();
  await waitForToast(owner.page, "Cash session opened.");

  const session = await waitForLocalDatabaseState(async () => {
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
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "POS detail mobile overflow");
  await owner.page.getByRole("button", { name: "Mark as paid (cash)" }).click();
  await waitForToast(owner.page, "Cash payment confirmed.");

  const paidSale = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("pos_sales").select("status, receipt_number, paid_at").eq("id", saleId).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "paid" && Boolean(row.receipt_number) && Boolean(row.paid_at), "cash sale completion");
  const { data: paidPayment, error: paymentError } = await admin
    .from("payments")
    .select("status, payment_method, paid_at, verified_at, cash_session_id")
    .eq("id", paymentId)
    .single();
  if (paymentError) throw paymentError;
  assert.equal(paidPayment.status, "paid");
  assert.equal(paidPayment.payment_method, "cash");
  assert.ok(paidPayment.paid_at, "cash payment has paid timestamp");
  assert.ok(paidPayment.verified_at, "cash payment has verification timestamp");
  assert.equal(paidPayment.cash_session_id, session.id, "cash payment belongs to the open session");

  await owner.page.reload({ waitUntil: "domcontentloaded" });
  await owner.page.getByText(paidSale.receipt_number, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
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
      { name: "cash collection atomically pays sale and payment", result: "passed" },
      { name: "receipt number renders after payment", result: "passed" },
      { name: "POS access control and mobile layout", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("pos02_local_uat_ok");
} finally {
  await browser.close();
}
