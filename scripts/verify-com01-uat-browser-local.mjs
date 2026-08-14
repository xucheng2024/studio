import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

const RUN_ID = process.env.COM01_UAT_RUN_ID;
if (!RUN_ID) throw new Error("COM01_UAT_RUN_ID is required");

const BASE_URL = (process.env.COM01_UAT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) throw new Error("Missing local Supabase env");
if (!SUPABASE_URL.includes("127.0.0.1") && !SUPABASE_URL.includes("localhost")) {
  throw new Error(`Refuse non-local Supabase URL: ${SUPABASE_URL}`);
}
if (!BASE_URL.includes("127.0.0.1") && !BASE_URL.includes("localhost")) {
  throw new Error(`Refuse non-local app URL: ${BASE_URL}`);
}

const studioId = "e1000000-0000-4000-8000-000000000001";
const l1 = "e1000000-0000-4000-8000-000000000011";
const users = {
  owner: "com01-v2-owner@example.com",
  manager: "com01-v2-manager@example.com",
  frontdeskL1: "com01-v2-frontdesk-l1@example.com",
  frontdeskL2: "com01-v2-frontdesk-l2@example.com",
  instructor: "com01-v2-instructor@example.com",
};
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
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkError) throw linkError;

  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) throw verifyError;
  if (!verified.session) throw new Error(`No local auth session for ${email}`);

  let encodedCookies = [];
  const server = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (values) => {
        encodedCookies = values;
      },
    },
  });
  const { error: sessionError } = await server.auth.setSession({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
  if (sessionError) throw sessionError;
  return encodedCookies.map(({ name, value }) => ({ name, value, url: BASE_URL }));
}

async function login(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies(await authCookies(email));
  return { context, page: await context.newPage() };
}

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
assert.equal(sales[scenarioNotes.walkinPaidFirst].status, "refunded");
assert.equal(Number(sales[scenarioNotes.walkinPaidFirst].refunded_amount), 100);

const saleIds = Object.values(sales).map((sale) => sale.id);
const { data: items, error: itemError } = await admin.from("pos_sale_items").select("id,sale_id").in("sale_id", saleIds);
if (itemError) throw itemError;
const itemIds = (items || []).map((item) => item.id);
const { data: entries, error: entryError } = await admin
  .from("service_commission_entries")
  .select("pos_sale_item_id,entry_type,amount")
  .in("pos_sale_item_id", itemIds);
if (entryError) throw entryError;
const itemBySale = new Map((items || []).map((item) => [item.sale_id, item.id]));
const commissionBySale = new Map();
for (const sale of Object.values(sales)) {
  const itemId = itemBySale.get(sale.id);
  const rows = (entries || []).filter((entry) => entry.pos_sale_item_id === itemId);
  commissionBySale.set(sale.id, {
    earned: rows.filter((entry) => entry.entry_type === "earned").length,
    reversals: rows.filter((entry) => entry.entry_type === "refund_reversal").length,
    net: rows.reduce((sum, entry) => sum + Number(entry.amount), 0),
  });
}
for (const note of [
  scenarioNotes.appointmentPaidFirst,
  scenarioNotes.appointmentCompleteFirst,
  scenarioNotes.walkinFulfillFirst,
]) {
  assert.equal(commissionBySale.get(sales[note].id)?.earned, 1, `${note} earned count`);
}
const refundedCommission = commissionBySale.get(sales[scenarioNotes.walkinPaidFirst].id);
assert.equal(refundedCommission?.earned, 1);
assert.ok((refundedCommission?.reversals ?? 0) >= 1);
assert.ok(Math.abs(refundedCommission?.net ?? 1) < 0.0001);

const saleUrl = (sale) =>
  `/dashboard/pos/${sale.id}?studio_id=${studioId}&location_id=${sale.location_id}`;
const browser = await chromium.launch({ headless: true });
try {
  for (const [role, email, file] of [
    ["owner", users.owner, "01-role-owner-pos.png"],
    ["manager", users.manager, "01-role-manager-pos.png"],
    ["frontdesk", users.frontdeskL1, "01-role-frontdesk-pos.png"],
  ]) {
    const session = await login(browser, email);
    await capture(session.page, {
      url: `/dashboard/pos?studio_id=${studioId}&location_id=${l1}`,
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
  for (const [note, file, statusText] of [
    [scenarioNotes.appointmentPaidFirst, "10-appointment-paid-first-final.png", "Paid"],
    [scenarioNotes.appointmentCompleteFirst, "20-appointment-complete-first-final.png", "Paid"],
    [scenarioNotes.walkinFulfillFirst, "40-walkin-fulfill-first-final.png", "Paid"],
    [scenarioNotes.walkinPaidFirst, "50-walkin-refund-final.png", "Refunded"],
  ]) {
    const sale = sales[note];
    await capture(owner.page, {
      url: saleUrl(sale),
      file,
      expectedHeading: "POS sale detail",
      expectedTexts: [note, statusText, `SGD ${Number(sale.total_amount).toFixed(2)}`],
    });
  }
  await capture(owner.page, {
    url: saleUrl(sales[scenarioNotes.walkinPaidFirst]),
    file: "60-refund-idempotency-final.png",
    expectedHeading: "POS sale detail",
    expectedTexts: [scenarioNotes.walkinPaidFirst, "Refunded", "SGD 100.00"],
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
      walkinRefund: { status: "refunded", ...refundedCommission },
    },
  },
  evidence,
};
fs.writeFileSync(path.join(outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, screenshotDir: outDir, screenshotCount: evidence.length }, null, 2));
