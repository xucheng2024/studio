import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { COM01_LOCAL_IDENTITIES, COM01_LOCAL_IDENTITY_LIST, normalizeEmail } from "./fixtures/com01-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const RUN_ID = process.env.COM01_UAT_RUN_ID;
if (!RUN_ID) throw new Error("COM01_UAT_RUN_ID is required");

const BASE_URL = (process.env.COM01_UAT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Missing local Supabase env");
function assertLoopbackUrl(value, label) {
  const hostname = new URL(value).hostname;
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)) {
    throw new Error(`Refuse non-local ${label}: ${hostname}`);
  }
}
assertLoopbackUrl(SUPABASE_URL, "Supabase URL");
assertLoopbackUrl(BASE_URL, "app URL");

const studioId = "e1000000-0000-4000-8000-000000000001";
const l1 = "e1000000-0000-4000-8000-000000000011";
const users = COM01_LOCAL_IDENTITIES;
const scenarioNotes = {
  appointmentPaidFirst: `${RUN_ID}-APT-PAID-FIRST-HITPAY`,
  appointmentCompleteFirst: `${RUN_ID}-APT-COMPLETE-FIRST-CASH`,
  walkinPaidFirst: `${RUN_ID}-WALKIN-PAID-FIRST-CASH`,
  walkinFulfillFirst: `${RUN_ID}-WALKIN-FULFILL-FIRST-HITPAY`,
  crossLocation: `${RUN_ID}-CROSS-LOCATION-DENY`,
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const outDir = path.join(process.cwd(), "tmp", "com01-uat", RUN_ID, "screenshots");
fs.mkdirSync(outDir, { recursive: true });
const evidence = [];

async function authCookies(email) {
  return createLocalSessionCookies({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    serviceRoleKey: SERVICE_ROLE_KEY,
    identity: email,
    baseUrl: BASE_URL,
  });
}

async function login(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(await authCookies(email));
  return { context, page: await context.newPage() };
}

async function verifyFixtureIdentityBindings() {
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    const { data, error } = await admin.auth.admin.getUserById(identity.id);
    if (error) throw error;
    assert.equal(normalizeEmail(data.user?.email), normalizeEmail(identity.email), `Missing fixed Auth identity for ${identity.email}`);
  }

  const { data: publicUsers, error: publicUsersError } = await admin.from("users").select("id,email").in("id", COM01_LOCAL_IDENTITY_LIST.map((identity) => identity.id));
  if (publicUsersError) throw publicUsersError;
  assert.equal(publicUsers?.length, COM01_LOCAL_IDENTITY_LIST.length, "Missing COM-01 public users");
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    const user = publicUsers?.find((row) => row.id === identity.id);
    assert.equal(normalizeEmail(user?.email), normalizeEmail(identity.email), `Public user mismatch for ${identity.email}`);
  }

  const { data: profiles, error: profilesError } = await admin.from("user_profiles").select("id,email").in("id", COM01_LOCAL_IDENTITY_LIST.map((identity) => identity.id));
  if (profilesError) throw profilesError;
  assert.equal(profiles?.length, COM01_LOCAL_IDENTITY_LIST.length, "Missing COM-01 user profiles");
  for (const identity of COM01_LOCAL_IDENTITY_LIST) {
    const profile = profiles?.find((row) => row.id === identity.id);
    assert.equal(normalizeEmail(profile?.email), normalizeEmail(identity.email), `User profile mismatch for ${identity.email}`);
  }

  const { data: studio, error: studioError } = await admin.from("studios").select("owner_id").eq("id", studioId).single();
  if (studioError) throw studioError;
  assert.equal(studio.owner_id, users.owner.id, "COM-01 studio owner must use the fixed owner Auth UUID");

  const { data: memberships, error: membershipsError } = await admin
    .from("staff_memberships")
    .select("user_id,location_id,role,is_active")
    .eq("studio_id", studioId)
    .in("user_id", [users.manager.id, users.frontdeskL1.id, users.frontdeskL2.id, users.instructor.id]);
  if (membershipsError) throw membershipsError;
  const expectedMemberships = [
    [users.manager.id, null, "manager"],
    [users.frontdeskL1.id, l1, "frontdesk"],
    [users.frontdeskL2.id, "e1000000-0000-4000-8000-000000000012", "frontdesk"],
    [users.instructor.id, l1, "instructor"],
  ];
  assert.equal(memberships?.length, expectedMemberships.length, "Unexpected COM-01 membership binding count");
  for (const [userId, locationId, role] of expectedMemberships) {
    assert.deepEqual(memberships?.filter((row) => row.user_id === userId), [{ user_id: userId, location_id: locationId, role, is_active: true }], `Membership mismatch for ${userId}`);
  }
}

await verifyFixtureIdentityBindings();

async function capture(page, { url, file, expectedTexts, expectedHeading }) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  assert.doesNotMatch(page.url(), /\/(auth|login)(?:[/?]|$)/, `Unexpected auth redirect for ${file}`);
  try {
    if (expectedHeading) {
      const heading = page.getByRole("heading", { name: expectedHeading, exact: true });
      await heading.waitFor({ state: "visible", timeout: 30_000 });
    }
    const bodyText = await page.locator("body").innerText();
    for (const text of expectedTexts) {
      assert.ok(bodyText.includes(text), `Missing expected text ${JSON.stringify(text)} for ${file}`);
    }
  } catch (error) {
    console.error(JSON.stringify({ file, actualUrl: page.url(), body: (await page.locator("body").innerText()).slice(0, 2000) }, null, 2));
    throw error;
  }
  const bodyText = await page.locator("body").innerText();
  assert.doesNotMatch(bodyText, /^Loading[.…]*$/m, `Loading-only page captured for ${file}`);
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
  evidence.push({ file, url, expectedHeading: expectedHeading ?? null, expectedTexts });
}

const { data: saleRows, error: saleError } = await admin
  .from("pos_sales")
  .select("id,note,location_id,status,total_amount,refunded_amount")
  .in("note", Object.values(scenarioNotes));
if (saleError) throw saleError;
const sales = Object.fromEntries((saleRows || []).map((row) => [row.note, row]));
for (const note of Object.values(scenarioNotes)) assert.ok(sales[note], `Missing UAT sale: ${note}`);

assert.equal(sales[scenarioNotes.appointmentPaidFirst].status, "paid");
assert.equal(sales[scenarioNotes.appointmentCompleteFirst].status, "paid");
assert.equal(sales[scenarioNotes.walkinFulfillFirst].status, "paid");

const saleIds = Object.values(sales).map((sale) => sale.id);
const { data: cashSession, error: cashSessionError } = await admin
  .from("pos_cash_sessions")
  .select("id,status,opening_float,cash_in,cash_out,expected_cash")
  .eq("studio_id", studioId)
  .eq("location_id", l1)
  .eq("status", "open")
  .order("opened_at", { ascending: false })
  .limit(1)
  .maybeSingle();
if (cashSessionError) throw cashSessionError;
assert.ok(cashSession, "Missing open COM-01 local UAT cash session");
assert.equal(Number(cashSession.opening_float), 200);
const { data: items, error: itemError } = await admin.from("pos_sale_items").select("id,sale_id").in("sale_id", saleIds);
if (itemError) throw itemError;
const itemIds = (items || []).map((item) => item.id);
const { data: entries, error: entryError } = await admin
  .from("service_commission_entries")
  .select("pos_sale_item_id,entry_type,amount")
  .in("pos_sale_item_id", itemIds);
if (entryError) throw entryError;
const itemBySale = new Map((items || []).map((item) => [item.sale_id, item.id]));
function commissionSummary(rows, itemId) {
  const itemEntries = rows.filter((entry) => entry.pos_sale_item_id === itemId);
  return {
    earned: itemEntries.filter((entry) => entry.entry_type === "earned").length,
    reversals: itemEntries.filter((entry) => entry.entry_type === "refund_reversal").length,
    net: itemEntries.reduce((sum, entry) => sum + Number(entry.amount), 0),
  };
}
const commissionBySale = new Map(
  Object.values(sales).map((sale) => [sale.id, commissionSummary(entries || [], itemBySale.get(sale.id))]),
);
for (const note of [
  scenarioNotes.appointmentPaidFirst,
  scenarioNotes.appointmentCompleteFirst,
  scenarioNotes.walkinFulfillFirst,
]) {
  assert.equal(commissionBySale.get(sales[note].id)?.earned, 1, `${note} earned count`);
}
const refundSale = sales[scenarioNotes.walkinPaidFirst];
const refundItemId = itemBySale.get(refundSale.id);
const refundCommissionBefore = commissionBySale.get(refundSale.id);
assert.equal(refundSale.status, "paid");
assert.equal(Number(refundSale.refunded_amount), 0);
assert.ok(refundItemId, "Missing refund UAT sale item");
assert.equal(refundCommissionBefore?.earned, 1);
assert.equal(refundCommissionBefore?.reversals, 0);
assert.ok((refundCommissionBefore?.net ?? 0) > 0, "Earned commission must be positive before refund");

const saleUrl = (sale) =>
  `/dashboard/pos/${sale.id}?studio_id=${studioId}&location_id=${sale.location_id}`;
const browser = await chromium.launch({ headless: true });
let refundSaleAfter;
let refundCommissionAfter;
let refundAudits;
let refundAuditError;
let cashSessionAfter;
let closeAudits;
let closeAuditError;
try {
  for (const [role, email, file] of [
    ["owner", users.owner, "01-role-owner-pos.png"],
    ["manager", users.manager, "01-role-manager-pos.png"],
    ["frontdesk", users.frontdeskL1, "01-role-frontdesk-pos.png"],
  ]) {
    const session = await login(browser, email);
    await capture(session.page, {
      url: `/dashboard/pos?studio_id=${studioId}&location_id=${l1}${role === "owner" ? "" : "&tab=history"}`,
      file,
      expectedHeading: "POS sales",
      expectedTexts: ["COM01-L1", role === "owner" ? "Cash sessions" : "Status"],
    });
    await session.context.close();
  }

  {
    const session = await login(browser, users.instructor);
    await capture(session.page, {
      url: `/dashboard/pos?studio_id=${studioId}&location_id=${l1}`,
      file: "02-role-instructor-denied.png",
      expectedTexts: ["You do not have access to POS sales."],
    });
    await session.context.close();
  }

  const owner = await login(browser, users.owner);
  await capture(owner.page, {
    url: `/dashboard/pos/cash-sessions?studio_id=${studioId}&location_id=${l1}`,
    file: "05-cash-session-list.png",
    expectedHeading: "Cash sessions",
    expectedTexts: ["Open a cash session", "Open"],
  });
  await capture(owner.page, {
    url: `/dashboard/pos/cash-sessions/${cashSession.id}?studio_id=${studioId}&location_id=${l1}`,
    file: "06-cash-session-detail.png",
    expectedHeading: "Cash session detail",
    expectedTexts: ["Opening float", "Cash in", "Cash out (refund)", "Expected cash"],
  });
  for (const [note, file, statusText] of [
    [scenarioNotes.appointmentPaidFirst, "10-appointment-paid-first-final.png", "Paid"],
    [scenarioNotes.appointmentCompleteFirst, "20-appointment-complete-first-final.png", "Paid"],
    [scenarioNotes.walkinFulfillFirst, "40-walkin-fulfill-first-final.png", "Paid"],
  ]) {
    const sale = sales[note];
    await capture(owner.page, {
      url: saleUrl(sale),
      file,
      expectedHeading: "POS sale detail",
      expectedTexts: [note, statusText, `SGD ${Number(sale.total_amount).toFixed(2)}`],
    });
  }
  await owner.page.goto(`${BASE_URL}${saleUrl(refundSale)}`, { waitUntil: "networkidle", timeout: 120_000 });
  await owner.page.locator('input[name="refund_item_id"]').check();
  await owner.page.locator(`input[name="refund_amount__${refundItemId}"]`).fill("100.00");
  await owner.page.locator('input[name="reason"]').fill(`${RUN_ID} browser refund`);
  owner.page.once("dialog", (dialog) => dialog.accept());
  await owner.page.getByRole("button", { name: "Refund items", exact: true }).click();
  refundSaleAfter = await waitForLocalDatabaseState(
    async () => {
      const { data, error } = await admin
        .from("pos_sales")
        .select("id,status,refunded_amount")
        .eq("id", refundSale.id)
        .single();
      if (error) throw error;
      return data;
    },
    (sale) => sale.status === "refunded",
    "browser refund database state",
  );
  assert.equal(refundSaleAfter.status, "refunded");
  assert.equal(Number(refundSaleAfter.refunded_amount), 100);
  const { data: refundItemAfter, error: refundItemAfterError } = await admin
    .from("pos_sale_items")
    .select("refunded_amount,refunded_quantity")
    .eq("id", refundItemId)
    .single();
  if (refundItemAfterError) throw refundItemAfterError;
  assert.equal(Number(refundItemAfter.refunded_amount), 100);
  assert.equal(Number(refundItemAfter.refunded_quantity), 1);
  const { data: refundPayment, error: refundPaymentError } = await admin
    .from("payments")
    .select("status,cash_session_id")
    .eq("pos_sale_id", refundSale.id)
    .single();
  if (refundPaymentError) throw refundPaymentError;
  assert.equal(refundPayment.status, "refunded");
  assert.equal(refundPayment.cash_session_id, cashSession.id);
  const { data: refundEntries, error: refundEntriesError } = await admin
    .from("service_commission_entries")
    .select("pos_sale_item_id,entry_type,amount")
    .eq("pos_sale_item_id", refundItemId);
  if (refundEntriesError) throw refundEntriesError;
  refundCommissionAfter = commissionSummary(refundEntries || [], refundItemId);
  assert.equal(refundCommissionAfter.earned, 1);
  assert.ok(refundCommissionAfter.reversals >= 1);
  assert.ok(Math.abs(refundCommissionAfter.net) < 0.0001);
  ({ data: refundAudits, error: refundAuditError } = await admin
    .from("strong_audit_logs")
    .select("actor_id")
    .eq("studio_id", studioId)
    .eq("action", "pos_sale_items_refunded")
    .eq("target_id", refundSale.id));
  if (refundAuditError) throw refundAuditError;
  assert.deepEqual(refundAudits, [{ actor_id: users.owner.id }]);
  await capture(owner.page, {
    url: saleUrl(refundSale),
    file: "50-browser-refund-final.png",
    expectedHeading: "POS sale detail",
    expectedTexts: [scenarioNotes.walkinPaidFirst, "Refunded", "SGD 100.00"],
  });

  await owner.page.goto(`${BASE_URL}/dashboard/pos/cash-sessions/${cashSession.id}?studio_id=${studioId}&location_id=${l1}`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await owner.page.getByLabel("Counted cash (SGD)").fill("305.00");
  await owner.page.getByLabel("Close note").fill(`${RUN_ID} browser cash close`);
  await owner.page.getByRole("button", { name: "Close cash session", exact: true }).click();
  cashSessionAfter = await waitForLocalDatabaseState(
    async () => {
      const { data, error } = await admin
        .from("pos_cash_sessions")
        .select("status,opening_float,cash_in,cash_out,expected_cash,counted_cash,cash_over_short,closed_by,closed_at")
        .eq("id", cashSession.id)
        .single();
      if (error) throw error;
      return data;
    },
    (session) => session.status === "closed",
    "browser cash-session close database state",
  );
  assert.equal(cashSessionAfter.status, "closed");
  assert.equal(Number(cashSessionAfter.opening_float), 200);
  assert.equal(Number(cashSessionAfter.cash_in), 200);
  assert.equal(Number(cashSessionAfter.cash_out), 100);
  assert.equal(Number(cashSessionAfter.expected_cash), 300);
  assert.equal(Number(cashSessionAfter.counted_cash), 305);
  assert.equal(Number(cashSessionAfter.cash_over_short), 5);
  assert.equal(cashSessionAfter.closed_by, users.owner.id);
  assert.ok(cashSessionAfter.closed_at);
  ({ data: closeAudits, error: closeAuditError } = await admin
    .from("strong_audit_logs")
    .select("actor_id")
    .eq("studio_id", studioId)
    .eq("action", "pos_cash_session_closed")
    .eq("target_id", cashSession.id));
  if (closeAuditError) throw closeAuditError;
  assert.deepEqual(closeAudits, [{ actor_id: users.owner.id }]);
  await capture(owner.page, {
    url: `/dashboard/pos/cash-sessions/${cashSession.id}?studio_id=${studioId}&location_id=${l1}`,
    file: "60-browser-cash-close-final.png",
    expectedHeading: "Cash session detail",
    expectedTexts: ["Closed", "SGD 300.00", "SGD 305.00", "SGD 5.00"],
  });
  await owner.context.close();

  {
    const session = await login(browser, users.frontdeskL2);
    await capture(session.page, {
      url: saleUrl(sales[scenarioNotes.crossLocation]),
      file: "70-cross-location-denied.png",
      expectedTexts: ["Could not load sale detail: location_out_of_scope"],
    });
    await session.context.close();
  }
} finally {
  await browser.close();
}

const index = {
  runId: RUN_ID,
  baseUrl: BASE_URL,
  generatedAt: new Date().toISOString(),
  assertions: {
    roles: ["owner_allowed", "manager_allowed", "frontdesk_l1_allowed", "instructor_denied", "frontdesk_l2_cross_location_denied"],
    scenarios: {
      appointmentPaidFirst: { status: "paid", ...commissionBySale.get(sales[scenarioNotes.appointmentPaidFirst].id) },
      appointmentCompleteFirst: { status: "paid", ...commissionBySale.get(sales[scenarioNotes.appointmentCompleteFirst].id) },
      walkinFulfillFirst: { status: "paid", ...commissionBySale.get(sales[scenarioNotes.walkinFulfillFirst].id) },
      walkinRefund: {
        browserSubmitted: true,
        before: { status: "paid", ...refundCommissionBefore },
        after: { status: refundSaleAfter.status, ...refundCommissionAfter },
        auditActorId: refundAudits[0]?.actor_id ?? null,
      },
    },
    cashSession: {
      browserSubmitted: true,
      status: cashSessionAfter.status,
      openingFloat: Number(cashSessionAfter.opening_float),
      cashIn: Number(cashSessionAfter.cash_in),
      cashOut: Number(cashSessionAfter.cash_out),
      expectedCash: Number(cashSessionAfter.expected_cash),
      countedCash: Number(cashSessionAfter.counted_cash),
      cashOverShort: Number(cashSessionAfter.cash_over_short),
      closedBy: cashSessionAfter.closed_by,
      auditActorId: closeAudits[0]?.actor_id ?? null,
    },
  },
  evidence,
};
fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, screenshotDir: outDir, screenshotCount: evidence.length }, null, 2));
