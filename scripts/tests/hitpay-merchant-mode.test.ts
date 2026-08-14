import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  cancelHitpayRecurringBilling,
  createHitpayPaymentRequest,
  createHitpayRecurringBilling,
  getHitpayPaymentRequest,
  getHitpayRecurringBilling,
  refundHitpayPayment,
  verifyHitpayWebhookSignature,
} from "../../src/lib/hitpay.ts";
import { getHitpayConfigIssue } from "../../src/lib/paymentErrors.ts";

const merchantKey = "merchant-key-for-test";

test("HitPay configuration needs only the enabled studio and merchant key", async () => {
  assert.equal(getHitpayConfigIssue({ hitpayEnabled: true, merchantApiKey: merchantKey }), null);
  assert.deepEqual(getHitpayConfigIssue({ hitpayEnabled: true, merchantApiKey: "" }), {
    error: "hitpay_merchant_key_missing",
    error_detail: "Missing `studio_payment_secrets.hitpay_api_key` for this studio.",
    status: 409,
  });
  await assert.rejects(
    createHitpayPaymentRequest({
      apiKey: "",
      amount: "10.00",
      currency: "SGD",
      reference_number: "TEST-EMPTY-KEY",
      redirect_url: "https://example.test/return",
    }),
    { message: "hitpay_merchant_key_missing" },
  );
});

test("all HitPay payment and recurring requests use only the studio merchant header", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/payment-requests/") && init?.method === "GET") {
      return Response.json({ id: "request-1", status: "pending" });
    }
    if (url.endsWith("/payment-requests")) {
      return Response.json({ id: "request-1", status: "pending", url: "https://checkout.test/request-1" });
    }
    if (url.includes("/recurring-billing/") && init?.method === "DELETE") {
      return Response.json({ id: "recurring-1", status: "canceled" });
    }
    if (url.includes("/recurring-billing?") && init?.method === "GET") {
      return Response.json({ data: [{ id: "recurring-1", status: "scheduled" }] });
    }
    if (url.endsWith("/recurring-billing")) {
      return Response.json({ id: "recurring-1", status: "scheduled", url: "https://checkout.test/recurring-1" });
    }
    if (url.endsWith("/refund")) return Response.json({ id: "refund-1", status: "succeeded" });
    throw new Error(`Unexpected HitPay request: ${url}`);
  };

  try {
    await createHitpayPaymentRequest({
      apiKey: merchantKey,
      amount: "10.00",
      currency: "SGD",
      reference_number: "TEST-PAYMENT",
      redirect_url: "https://example.test/return",
    });
    await getHitpayPaymentRequest({ apiKey: merchantKey, requestId: "request-1" });
    await refundHitpayPayment({ apiKey: merchantKey, paymentId: "payment-1", amount: 10 });
    await createHitpayRecurringBilling({
      apiKey: merchantKey,
      customerEmail: "buyer@example.test",
      customerName: "Buyer",
      startDate: "2026-08-14",
      name: "Membership",
      amount: 10,
      currency: "SGD",
      cycle: "monthly",
      redirectUrl: "https://example.test/return",
      reference: "TEST-RECURRING",
    });
    await getHitpayRecurringBilling({ apiKey: merchantKey, reference: "TEST-RECURRING" });
    await cancelHitpayRecurringBilling({ apiKey: merchantKey, recurringBillingId: "recurring-1" });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 6);
  for (const call of calls) {
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get("X-BUSINESS-API-KEY"), merchantKey, call.url);
    assert.equal(headers.get("X-Requested-With"), "XMLHttpRequest", call.url);
    assert.equal(headers.has("X-PLATFORM-KEY"), false, call.url);
  }
});

test("webhook signatures accept the matching body and reject a bad signature", () => {
  const rawBody = JSON.stringify({ id: "payment-request-1", status: "completed" });
  const salt = "webhook-salt-for-test";
  const signature = crypto.createHmac("sha256", salt).update(rawBody, "utf8").digest("hex");
  assert.equal(verifyHitpayWebhookSignature(rawBody, signature, salt), true);
  assert.equal(verifyHitpayWebhookSignature(rawBody, "not-a-valid-signature", salt), false);
});

test("HitPay gateway errors remain actionable without returning HTML", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      {
        message:
          'Insufficient balance to refund. <a href="https://example.test/top-up">Top up your balance.</a>',
      },
      { status: 422 },
    );

  try {
    await assert.rejects(
      refundHitpayPayment({ apiKey: merchantKey, paymentId: "payment-1", amount: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /insufficient balance/i);
        assert.match(error.message, /top up your balance/i);
        assert.doesNotMatch(error.message, /<a|href=/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POS full refunds use item refunds and guard already-refunded payments before the gateway", () => {
  const route = readFileSync("src/app/api/payment/mark/route.ts", "utf8");
  const alreadyRefundedGuard = route.indexOf('if (payment.status === "refunded")');
  const gatewayRefund = route.indexOf("await refundHitpayPayment(");
  const posItemRefund = route.indexOf('admin.rpc("refund_pos_sale_items"');

  assert.ok(alreadyRefundedGuard >= 0, "missing already-refunded guard");
  assert.ok(gatewayRefund > alreadyRefundedGuard, "gateway refund must follow the already-refunded guard");
  assert.ok(posItemRefund > gatewayRefund, "POS item refund must finalize after the gateway accepts the refund");
  assert.doesNotMatch(route, /admin\.rpc\("sync_pos_sale_refund_status"/);
});

test("webhook route returns 401 after a failed signature verification and RLS has no direct secret policy", () => {
  const webhookRoute = readFileSync("src/app/api/payment/hitpay/webhook/route.ts", "utf8");
  assert.match(webhookRoute, /if \(!verified\) \{[\s\S]*?status: 401/);

  const schema = readFileSync("supabase/migrations/051_member_profile_notes.sql", "utf8");
  assert.match(schema, /ALTER TABLE "public"\."studio_payment_secrets" ENABLE ROW LEVEL SECURITY;/);
  assert.doesNotMatch(schema, /CREATE POLICY[^;]+ON "public"\."studio_payment_secrets"/);
});
