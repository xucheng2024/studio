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
  "POS03_UAT_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "POS03_UAT_DB_URL",
  "POS03_UAT_STUDIO_ID", "POS03_UAT_LOCATION_ID", "POS03_UAT_SALE_ID", "POS03_UAT_PAYMENT_ID",
  "POS03_HITPAY_API_KEY", "POS03_HITPAY_WEBHOOK_SALT",
];
for (const key of required) if (!process.env[key]) throw new Error(`Missing POS-03 local UAT environment: ${key}`);

const baseUrl = process.env.POS03_UAT_BASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.POS03_UAT_DB_URL;
const studioId = process.env.POS03_UAT_STUDIO_ID;
const locationId = process.env.POS03_UAT_LOCATION_ID;
const saleId = process.env.POS03_UAT_SALE_ID;
const paymentId = process.env.POS03_UAT_PAYMENT_ID;
const webhookSalt = process.env.POS03_HITPAY_WEBHOOK_SALT;
const runId = process.env.POS03_UAT_RUN_ID;
assertLocalUatTargets({ baseUrl, supabaseUrl, databaseUrl });

const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const browser = await chromium.launch({ headless: true });
const evidenceDir = path.join(process.cwd(), "tmp", "pos03-uat", runId);

function signWebhook(rawBody) {
  return crypto.createHmac("sha256", webhookSalt).update(rawBody, "utf8").digest("hex");
}

async function login(identity) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies(await createLocalSessionCookies({ supabaseUrl, anonKey, serviceRoleKey, identity, baseUrl }));
  return { context, page: await context.newPage() };
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

try {
  const query = `?studio_id=${studioId}&location_id=${locationId}`;
  const owner = await login(POS_LOCAL_IDENTITIES.owner);

  await owner.page.goto(`${baseUrl}/dashboard/pos/${saleId}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  assert.equal(await owner.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "POS detail mobile overflow");
  await owner.page.getByRole("button", { name: "Pay with HitPay" }).waitFor({ state: "visible", timeout: 30_000 });

  const createResult = await owner.page.evaluate(async ({ studioId: sid, saleId: sale }) => {
    const response = await fetch("/api/pos/payments/hitpay/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ studio_id: sid, sale_id: sale }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { studioId, saleId });
  assert.equal(createResult.status, 200, `HitPay create failed: ${JSON.stringify(createResult.body)}`);
  assert.ok(createResult.body.checkout_url, "HitPay create returns checkout URL");
  assert.ok(createResult.body.provider_payment_id, "HitPay create returns provider payment request id");

  const pendingPayment = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("payments")
      .select("id, status, payment_method, gateway_payment_id, gateway_checkout_url, reference_code")
      .eq("id", paymentId)
      .single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "pending" && Boolean(row.gateway_payment_id), "sandbox payment request stored");
  assert.equal(pendingPayment.payment_method, "hitpay");
  assert.equal(pendingPayment.gateway_payment_id, createResult.body.provider_payment_id);

  await owner.page.reload({ waitUntil: "domcontentloaded" });
  await owner.page.getByRole("button", { name: "Sync HitPay" }).click();
  await owner.page.getByText(/Synced: HitPay/i).waitFor({ state: "visible", timeout: 30_000 });
  const stillPending = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("payments").select("status").eq("id", paymentId).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "pending", "sync keeps unpaid sandbox request pending");
  assert.equal(stillPending.status, "pending");

  const { data: studio, error: studioError } = await admin.from("studios").select("public_slug").eq("id", studioId).single();
  if (studioError) throw studioError;

  const eventId = `pos03-uat-${runId}-complete`;
  const rawBody = JSON.stringify({
    id: pendingPayment.gateway_payment_id,
    payment_request_id: pendingPayment.gateway_payment_id,
    payment_id: `pay_${pendingPayment.gateway_payment_id}`,
    status: "completed",
    reference_number: pendingPayment.reference_code,
    amount: "88.00",
    currency: "SGD",
  });
  const goodSignature = signWebhook(rawBody);
  const completeResponse = await postWebhook(rawBody, goodSignature, eventId);
  assert.equal(completeResponse.status, 200, `webhook complete failed: ${await completeResponse.text()}`);

  const paidSale = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("pos_sales").select("status, receipt_number, paid_at").eq("id", saleId).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "paid" && Boolean(row.receipt_number), "HitPay webhook completes sale");
  const paidPayment = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin.from("payments").select("status, paid_at, verified_at").eq("id", paymentId).single();
    if (error) throw error;
    return data;
  }, (row) => row?.status === "paid", "HitPay webhook completes payment");
  assert.ok(paidSale.receipt_number);
  assert.ok(paidPayment.paid_at);

  const replayResponse = await postWebhook(rawBody, goodSignature, eventId);
  assert.equal(replayResponse.status, 200, `webhook replay failed: ${await replayResponse.text()}`);
  const replayPaid = await waitForLocalDatabaseState(async () => {
    const [{ data: sale, error: saleError }, { data: payment, error: paymentError }] = await Promise.all([
      admin.from("pos_sales").select("status, receipt_number").eq("id", saleId).single(),
      admin.from("payments").select("status").eq("id", paymentId).single(),
    ]);
    if (saleError) throw saleError;
    if (paymentError) throw paymentError;
    return { sale, payment };
  }, (row) => row?.sale?.status === "paid" && row?.payment?.status === "paid", "webhook replay keeps paid state");
  assert.equal(replayPaid.sale.receipt_number, paidSale.receipt_number, "webhook replay must not change receipt number");

  const badResponse = await postWebhook(rawBody, "not-a-valid-signature", `${eventId}-bad`);
  assert.equal(badResponse.status, 401);
  const failure = await waitForLocalDatabaseState(async () => {
    const { data, error } = await admin
      .from("hitpay_webhook_failures")
      .select("id, error_code, payment_id")
      .eq("studio_id", studioId)
      .eq("error_code", "invalid_signature")
      .eq("payment_id", paymentId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }, (row) => row?.error_code === "invalid_signature", "invalid signature failure recorded");
  assert.equal(failure.payment_id, paymentId);

  const syncAfterPaid = await owner.page.evaluate(async ({ paymentId: pid, studioSlug }) => {
    const response = await fetch("/api/payment/hitpay/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_id: pid, studio_slug: studioSlug }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { paymentId, studioSlug: studio.public_slug });
  assert.equal(syncAfterPaid.status, 200, `post-paid sync failed: ${JSON.stringify(syncAfterPaid.body)}`);
  assert.equal(syncAfterPaid.body.state === "paid" || syncAfterPaid.body.payment_status === "paid", true);

  await owner.context.close();

  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, "index.json"), `${JSON.stringify({
    schema_version: 1,
    run_id: runId,
    status: "passed",
    assertions: [
      { name: "sandbox create payment request", result: "passed" },
      { name: "active sync while pending", result: "passed" },
      { name: "signed webhook completes sale", result: "passed" },
      { name: "webhook replay is idempotent", result: "passed" },
      { name: "invalid signature records failure", result: "passed" },
      { name: "post-paid sync remains paid", result: "passed" },
    ],
  }, null, 2)}\n`);
  console.log("pos03_local_uat_ok");
} finally {
  await browser.close();
}
