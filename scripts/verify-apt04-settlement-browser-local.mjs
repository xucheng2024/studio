import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { POS_LOCAL_IDENTITIES } from "./fixtures/pos-local-identities.mjs";
import { waitForLocalDatabaseState } from "./lib/local-supabase-uat.mjs";
import { assertLocalUatTargets, createLocalSessionCookies } from "./lib/local-uat-safety.mjs";

const required = [
  "APT04_SETTLEMENT_UAT_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "APT04_SETTLEMENT_UAT_DB_URL",
  "APT04_SETTLEMENT_UAT_STUDIO_ID",
  "APT04_SETTLEMENT_UAT_LOCATION_ID",
  "APT04_SETTLEMENT_UAT_SERVICE_ID",
  "APT04_SETTLEMENT_UAT_CUSTOMER_ID",
  "POS03_HITPAY_WEBHOOK_SALT",
];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing APT-04 settlement local UAT environment: ${key}`);
}

const baseUrl = process.env.APT04_SETTLEMENT_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.APT04_SETTLEMENT_UAT_DB_URL;
const studioId = process.env.APT04_SETTLEMENT_UAT_STUDIO_ID;
const locationId = process.env.APT04_SETTLEMENT_UAT_LOCATION_ID;
const serviceId = process.env.APT04_SETTLEMENT_UAT_SERVICE_ID;
const customerId = process.env.APT04_SETTLEMENT_UAT_CUSTOMER_ID;
const webhookSalt = process.env.POS03_HITPAY_WEBHOOK_SALT;
const runId = process.env.APT04_SETTLEMENT_UAT_RUN_ID || process.env.UAT_FLOW_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "apt04-settlement-uat", runId);

function localYmd(offsetDays) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
}

function signWebhook(rawBody) {
  return crypto.createHmac("sha256", webhookSalt).update(rawBody, "utf8").digest("hex");
}

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    identity,
    baseUrl,
  }));
  return { context, page: await context.newPage() };
}

async function followStreamingRedirect(page) {
  await page.waitForTimeout(1_500);
  const refresh = await page.locator('meta[http-equiv="refresh"]').getAttribute("content").catch(() => null);
  if (refresh?.includes("url=")) {
    const target = refresh.slice(refresh.indexOf("url=") + 4);
    await page.goto(new URL(target, baseUrl).toString(), { waitUntil: "domcontentloaded" });
  }
}

async function postWebhook(rawBody, signature, eventId) {
  return fetch(`${baseUrl}/api/webhooks/hitpay`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "hitpay-signature": signature,
      "hitpay-event-id": eventId,
      "hitpay-event-type": "payment_request.completed",
      "hitpay-event-object": "payment_request",
    },
    body: rawBody,
  });
}

async function openBooking(page, studioSlug, offsetDays) {
  const date = localYmd(offsetDays);
  const query = new URLSearchParams({ location_id: locationId, service_id: serviceId, date });
  const url = `${baseUrl}/${studioSlug}/appointments?${query}`;
  console.log("[apt04-settlement-uat] open booking", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.getByRole("heading", { name: "Book appointment" }).waitFor({ state: "visible", timeout: 30_000 });
  return date;
}

async function bookFirstSlot(page, paymentOption) {
  const form = page.locator('form:has(input[name="slot_starts_at"])').first();
  await form.waitFor({ state: "visible", timeout: 30_000 });
  const paymentSelect = form.locator('select[name="payment_option"]');
  await paymentSelect.selectOption(paymentOption);
  await form.locator('input[name="terms_accepted"]').check();
  console.log("[apt04-settlement-uat] submitting slot", { paymentOption });
  await form.getByRole("button", { name: "Book this slot" }).click();
  await followStreamingRedirect(page);
  await page.waitForURL(
    (url) => url.searchParams.get("ok") === "booked"
      || url.pathname.includes("/checkout/")
      || Boolean(url.searchParams.get("error")),
    { timeout: 60_000 },
  );
  const current = new URL(page.url());
  const error = current.searchParams.get("error");
  if (error) throw new Error(`Booking failed with error=${error} at ${current.toString()}`);
  console.log("[apt04-settlement-uat] booking landed", current.toString());
  return current;
}

try {
  const { data: studio, error: studioError } = await admin
    .from("studios")
    .select("id, public_slug")
    .eq("id", studioId)
    .single();
  if (studioError) throw studioError;
  const studioSlug = studio.public_slug;
  assert.ok(studioSlug, "fixture studio slug missing");

  const customer = await login(POS_LOCAL_IDENTITIES.customer);
  await openBooking(customer.page, studioSlug, 3);
  assert.equal(
    await customer.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false,
    "booking page 390px overflow",
  );
  await customer.page.getByRole("option", { name: /^Use package credits$/ }).waitFor({ state: "attached", timeout: 15_000 });

  await bookFirstSlot(customer.page, "package_credit");
  assert.match(customer.page.url(), /ok=booked/);
  await customer.page.getByText("Appointment submitted successfully.").waitFor({ state: "visible", timeout: 15_000 });

  const packageAppointment = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("salon_appointments")
      .select("id, status, expires_at")
      .eq("studio_id", studioId)
      .eq("salon_customer_id", customerId)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "confirmed", "package appointment confirmed");
  console.log("[apt04-settlement-uat] package appointment", packageAppointment.id);

  const packageSettlement = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("salon_appointment_settlements")
      .select("id, status, consume_ledger_entry_id")
      .eq("studio_id", studioId)
      .eq("appointment_id", packageAppointment.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "package_consumed" && Boolean(row.consume_ledger_entry_id), "package settlement consumed");

  const consumeLedger = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("client_package_ledger_entries")
      .select("id, event_type, source_type, source_id, delta_credits")
      .eq("id", packageSettlement.consume_ledger_entry_id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.event_type === "consume" && row?.source_type === "salon_appointment", "package consume ledger");
  assert.equal(consumeLedger.source_id, packageAppointment.id);
  assert.equal(consumeLedger.delta_credits, -1);

  await customer.page.getByRole("button", { name: "Cancel" }).click();
  await followStreamingRedirect(customer.page);
  await customer.page.waitForURL((url) => url.searchParams.get("ok") === "cancelled" || Boolean(url.searchParams.get("error")), { timeout: 30_000 });
  if (new URL(customer.page.url()).searchParams.get("error")) {
    throw new Error(`Cancel failed: ${customer.page.url()}`);
  }
  await customer.page.getByText("Appointment cancelled.").waitFor({ state: "visible", timeout: 15_000 });

  const returned = await waitForLocalDatabaseState(async () => {
    const [{ data: settlement, error: settlementError }, { data: ledger, error: ledgerError }] = await Promise.all([
      admin
        .from("salon_appointment_settlements")
        .select("status, return_ledger_entry_id, is_returned")
        .eq("appointment_id", packageAppointment.id)
        .maybeSingle(),
      admin
        .from("client_package_ledger_entries")
        .select("id, event_type, source_type, source_id, studio_id")
        .eq("studio_id", studioId)
        .eq("event_type", "cancel_return")
        .eq("source_type", "salon_appointment_cancel")
        .eq("source_id", packageAppointment.id)
        .maybeSingle(),
    ]);
    if (settlementError) throw settlementError;
    if (ledgerError) throw ledgerError;
    return { settlement, ledger };
  }, (row) => Boolean(row?.settlement?.return_ledger_entry_id) && row?.ledger?.event_type === "cancel_return", "package cancel_return ledger");
  assert.equal(returned.ledger.studio_id, studioId);
  console.log("[apt04-settlement-uat] cancel_return", returned.ledger.id);

  await openBooking(customer.page, studioSlug, 4);
  await bookFirstSlot(customer.page, "online_deposit");
  assert.match(customer.page.url(), /\/checkout\//);
  const paymentId = customer.page.url().split("/checkout/")[1]?.split(/[/?#]/)[0];
  assert.ok(paymentId, `checkout payment id missing from ${customer.page.url()}`);
  console.log("[apt04-settlement-uat] deposit payment", paymentId);

  const pendingPayment = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("payments")
      .select("id, status, amount, currency, gateway_payment_id, reference_code, pos_sale_id, source")
      .eq("id", paymentId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "pending" && Boolean(row.gateway_payment_id), "sandbox deposit payment request stored");
  assert.equal(pendingPayment.source, "pos_sale");
  assert.equal(Number(pendingPayment.amount), 30);

  const pendingAppointment = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("salon_appointment_settlements")
      .select("appointment_id, status, settlement_mode, payment_id")
      .eq("studio_id", studioId)
      .eq("payment_id", paymentId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "pending_payment" && row?.settlement_mode === "online_deposit", "online deposit settlement pending");

  await customer.page.goto(`${baseUrl}/${studioSlug}/me/appointments`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await customer.page.getByRole("link", { name: "Continue payment" }).waitFor({ state: "visible", timeout: 15_000 });

  const eventId = `apt04-settlement-${runId}-complete`;
  const rawBody = JSON.stringify({
    id: pendingPayment.gateway_payment_id,
    payment_request_id: pendingPayment.gateway_payment_id,
    payment_id: `pay_${pendingPayment.gateway_payment_id}`,
    status: "completed",
    reference_number: pendingPayment.reference_code,
    amount: Number(pendingPayment.amount).toFixed(2),
    currency: pendingPayment.currency || "SGD",
  });
  const signature = signWebhook(rawBody);
  const completeResponse = await postWebhook(rawBody, signature, eventId);
  const completeText = await completeResponse.text();
  console.log("[apt04-settlement-uat] webhook complete", completeResponse.status, completeText);
  assert.equal(completeResponse.status, 200, `webhook complete failed: ${completeText}`);

  const paidSettlement = await waitForLocalDatabaseState(async () => {
    const [{ data: settlement, error: settlementError }, { data: appointment, error: appointmentError }, { data: payment, error: paymentError }] = await Promise.all([
      admin
        .from("salon_appointment_settlements")
        .select("status, paid_amount")
        .eq("appointment_id", pendingAppointment.appointment_id)
        .maybeSingle(),
      admin
        .from("salon_appointments")
        .select("status, expires_at")
        .eq("id", pendingAppointment.appointment_id)
        .maybeSingle(),
      admin
        .from("payments")
        .select("status")
        .eq("id", paymentId)
        .maybeSingle(),
    ]);
    if (settlementError) throw settlementError;
    if (appointmentError) throw appointmentError;
    if (paymentError) throw paymentError;
    return { settlement, appointment, payment };
  }, (row) => row?.settlement?.status === "deposit_paid" && row?.appointment?.status === "confirmed" && row?.payment?.status === "paid", "signed webhook marks deposit paid");
  assert.equal(paidSettlement.appointment.expires_at, null);
  assert.equal(Number(paidSettlement.settlement.paid_amount), 30);

  const replayResponse = await postWebhook(rawBody, signature, eventId);
  assert.equal(replayResponse.status, 200, `webhook replay failed: ${await replayResponse.text()}`);
  const replayed = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("salon_appointment_settlements")
      .select("status, paid_amount")
      .eq("appointment_id", pendingAppointment.appointment_id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "deposit_paid", "webhook replay keeps deposit_paid");
  assert.equal(Number(replayed.paid_amount), 30);

  await customer.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "390px booking has no overflow", result: "passed" },
      { name: "package credit consume confirms appointment", result: "passed" },
      { name: "cancel returns package credit", result: "passed" },
      { name: "online deposit creates sandbox checkout", result: "passed" },
      { name: "continue payment is visible while pending", result: "passed" },
      { name: "signed webhook marks deposit paid", result: "passed" },
      { name: "webhook replay is idempotent", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("apt04_settlement_local_uat_ok");
} finally {
  await browser.close();
}
