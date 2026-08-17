import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { POS_LOCAL_IDENTITIES } from "./fixtures/pos-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "POS_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "POS_UAT_DB_URL",
  "POS_UAT_STUDIO_ID", "POS_UAT_LOCATION_ID", "POS_UAT_CLIENT_PACKAGE_ID", "POS_UAT_SALE_ID", "POS_UAT_SALE_ITEM_ID", "POS_UAT_PAYMENT_ID",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing local POS UAT environment: ${key}`);

const baseUrl = process.env.POS_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.POS_UAT_DB_URL;
const studioId = process.env.POS_UAT_STUDIO_ID;
const locationId = process.env.POS_UAT_LOCATION_ID;
const clientPackageId = process.env.POS_UAT_CLIENT_PACKAGE_ID;
const saleId = process.env.POS_UAT_SALE_ID;
const saleItemId = process.env.POS_UAT_SALE_ITEM_ID;
const paymentId = process.env.POS_UAT_PAYMENT_ID;
const runId = process.env.POS_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "pos-pkg-uat", runId);

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
}

async function waitForToast(page, message) {
  await page.getByText(message, { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
}

async function waitForRow(table, id, predicate, label) {
  return waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from(table).select("*").eq("id", id).single();
    if (error) throw error;
    return data;
  }, predicate, label);
}

try {
  const query = `?studio_id=${studioId}&location_id=${locationId}`;
  const owner = await login(POS_LOCAL_IDENTITIES.owner);

  await owner.page.goto(`${baseUrl}/dashboard/pos/cash-sessions${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "owner cash-session mobile overflow");
  await owner.page.getByLabel("Opening float (SGD)").fill("50.00");
  await owner.page.getByLabel("Notes").fill("POS local browser opening");
  await owner.page.getByRole("button", { name: "Open cash session" }).click();
  await waitForToast(owner.page, "Cash session opened.");

  const session = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("pos_cash_sessions").select("*").eq("studio_id", studioId).eq("location_id", locationId).eq("status", "open").single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "open", "opened cash session");

  await owner.page.goto(`${baseUrl}/dashboard/pos/${saleId}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByRole("button", { name: "Mark as paid (cash)" }).click();
  await waitForToast(owner.page, "Cash payment confirmed.");
  const paidSale = await waitForRow("pos_sales", saleId, (row) => row.status === "paid" && Boolean(row.receipt_number), "cash sale completion");
  const paidPayment = await waitForRow("payments", paymentId, (row) => row.status === "paid" && row.cash_session_id === session.id, "cash payment session binding");
  assert.ok(paidSale.receipt_number, "cash completion creates receipt number");
  assert.equal(paidPayment.cash_session_id, session.id);

  await owner.page.locator(`input[name="refund_item_id"][value="${saleItemId}"]`).check();
  await owner.page.locator(`input[name="refund_amount__${saleItemId}"]`).fill("40.00");
  await owner.page.getByLabel("Refund reason (optional)").fill("POS local partial refund");
  await owner.page.getByRole("button", { name: "Refund items" }).click();
  await waitForToast(owner.page, "Refund applied to 1 item(s).");
  await waitForRow("pos_sales", saleId, (row) => row.status === "partially_refunded" && Number(row.refunded_amount) === 40, "partial refund");

  await owner.page.goto(`${baseUrl}/dashboard/pos/cash-sessions/${session.id}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await owner.page.getByLabel("Counted cash (SGD)").fill("108.00");
  await owner.page.getByLabel("Close note").fill("POS local browser close");
  await owner.page.getByRole("button", { name: "Close cash session" }).click();
  await waitForToast(owner.page, "Cash session closed.");
  const closedSession = await waitForRow("pos_cash_sessions", session.id, (row) => row.status === "closed", "cash session close");
  assert.equal(Number(closedSession.expected_cash), 110);
  assert.equal(Number(closedSession.cash_over_short), -2);
  await owner.context.close();

  const frontdesk = await login(POS_LOCAL_IDENTITIES.frontdesk);
  const approvalsUrl = `${baseUrl}/dashboard/packages/approvals?studio_id=${studioId}&location_id=${locationId}&client_package_id=${clientPackageId}`;
  await frontdesk.page.goto(approvalsUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await frontdesk.page.getByLabel("Delta credits").fill("-2");
  await frontdesk.page.getByLabel("Value delta (SGD)").fill("-20.00");
  await frontdesk.page.getByLabel("Reason").fill("POS local concurrent approval");
  await frontdesk.page.getByRole("button", { name: "Create draft" }).click();
  await waitForToast(frontdesk.page, "Adjustment request draft created.");
  const requestOne = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("pkg02_adjustment_requests").select("*").eq("studio_id", studioId).eq("reason", "POS local concurrent approval").single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "draft", "package adjustment draft");
  await frontdesk.page.goto(`${approvalsUrl}&request_id=${requestOne.id}`, { waitUntil: "domcontentloaded" });
  await frontdesk.page.getByRole("button", { name: "Submit" }).click();
  await waitForToast(frontdesk.page, "Adjustment request submitted for checker approval.");
  await waitForRow("pkg02_adjustment_requests", requestOne.id, (row) => row.status === "submitted" && row.version === 2, "package request submit");

  const checkerA = await login(POS_LOCAL_IDENTITIES.manager);
  const checkerB = await login(POS_LOCAL_IDENTITIES.manager);
  const requestUrl = `${approvalsUrl}&request_id=${requestOne.id}`;
  await Promise.all([
    checkerA.page.goto(requestUrl, { waitUntil: "domcontentloaded" }),
    checkerB.page.goto(requestUrl, { waitUntil: "domcontentloaded" }),
  ]);
  await Promise.all([
    checkerA.page.getByRole("button", { name: "Approve" }).waitFor({ state: "visible", timeout: 30_000 }),
    checkerB.page.getByRole("button", { name: "Approve" }).waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  await Promise.all([
    checkerA.page.getByRole("button", { name: "Approve" }).click(),
    checkerB.page.getByRole("button", { name: "Approve" }).click(),
  ]);
  await waitForRow("pkg02_adjustment_requests", requestOne.id, (row) => row.status === "approved" && row.version === 3, "concurrent package approval");
  const { count: approvalCount, error: approvalCountError } = await admin.from("pkg02_approval_logs").select("id", { count: "exact", head: true }).eq("request_id", requestOne.id).eq("action", "approved");
  if (approvalCountError) throw approvalCountError;
  assert.equal(approvalCount, 1, "concurrent checker clicks create one approval transition");

  await checkerA.page.goto(requestUrl, { waitUntil: "domcontentloaded" });
  await checkerA.page.getByRole("button", { name: "Apply to ledger" }).click();
  await waitForToast(checkerA.page, "Adjustment applied to package ledger.");
  await waitForRow("pkg02_adjustment_requests", requestOne.id, (row) => row.status === "applied" && row.version === 4, "package adjustment apply");
  const { data: appliedPackage, error: packageError } = await admin.from("client_packages").select("credits_left").eq("id", clientPackageId).single();
  if (packageError) throw packageError;
  assert.equal(appliedPackage.credits_left, 8);
  const { count: ledgerCount, error: ledgerError } = await admin.from("client_package_ledger_entries").select("id", { count: "exact", head: true }).eq("source_type", "pkg02_adjustment_request").eq("source_id", requestOne.id);
  if (ledgerError) throw ledgerError;
  assert.equal(ledgerCount, 1, "approved request creates one ledger entry");

  await frontdesk.page.goto(approvalsUrl, { waitUntil: "domcontentloaded" });
  await frontdesk.page.getByLabel("Delta credits").fill("-1");
  await frontdesk.page.getByLabel("Value delta (SGD)").fill("-10.00");
  await frontdesk.page.getByLabel("Reason").fill("POS local rejection path");
  await frontdesk.page.getByRole("button", { name: "Create draft" }).click();
  await waitForToast(frontdesk.page, "Adjustment request draft created.");
  const requestTwo = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("pkg02_adjustment_requests").select("*").eq("studio_id", studioId).eq("reason", "POS local rejection path").single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "draft", "package rejection draft");
  await frontdesk.page.goto(`${approvalsUrl}&request_id=${requestTwo.id}`, { waitUntil: "domcontentloaded" });
  await frontdesk.page.getByRole("button", { name: "Submit" }).click();
  await waitForToast(frontdesk.page, "Adjustment request submitted for checker approval.");
  await checkerA.page.goto(`${approvalsUrl}&request_id=${requestTwo.id}`, { waitUntil: "domcontentloaded" });
  await checkerA.page.getByPlaceholder("Rejection reason", { exact: true }).fill("Insufficient local evidence");
  await checkerA.page.getByRole("button", { name: "Reject" }).click();
  await waitForToast(checkerA.page, "Adjustment request rejected.");
  await waitForRow("pkg02_adjustment_requests", requestTwo.id, (row) => row.status === "rejected" && row.version === 3, "package rejection");

  const instructor = await login(POS_LOCAL_IDENTITIES.instructor);
  await instructor.page.goto(`${baseUrl}/dashboard/pos${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await instructor.page.getByText("You do not have access to POS sales.", { exact: false }).waitFor({ state: "visible", timeout: 30_000 });

  await Promise.all([frontdesk.context.close(), checkerA.context.close(), checkerB.context.close(), instructor.context.close()]);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "cash sale refund and close", result: "passed" },
      { name: "package approval apply reject and access control", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("pos_pkg_local_uat_ok");
} finally {
  await browser.close();
}
