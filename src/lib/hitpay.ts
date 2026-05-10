import crypto from "crypto";

const HITPAY_API_BASE = process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com";
const HITPAY_PLATFORM_KEY = process.env.HITPAY_PLATFORM_API_KEY?.trim() || null;

type HitpayPaymentRequest = {
  apiKey: string;
  amount: string;
  currency: string;
  email?: string | null;
  name?: string | null;
  reference_number: string;
  redirect_url: string;
  purpose?: string;
};

type HitpayPaymentResponse = {
  id?: string;
  status?: string;
  url?: string;
  payment_request_url?: string;
};

type HitpayRefundResponse = {
  id?: string;
  payment_id?: string;
  amount_refunded?: number;
  status?: string;
  payment_method?: string;
  message?: string;
};

type HitpayRecurringBillingRequest = {
  apiKey: string;
  customerEmail: string;
  customerName: string;
  startDate: string;
  name: string;
  amount: number;
  currency: string;
  cycle: "monthly" | "yearly";
  redirectUrl: string;
  reference: string;
  paymentMethods?: string[];
  sendEmail?: boolean;
};

/** HitPay POST /v1/recurring-billing `payment_methods` enum (see API docs). */
const HITPAY_RECURRING_METHODS_ALLOWED = new Set(["card", "giro", "shopee_recurring"]);

/**
 * Resolves recurring-billing payment methods. Merchant dashboards only enable a subset;
 * sending e.g. ["card"] when only GIRO is enabled yields 422 ("must be one of: giro").
 *
 * Product policy: memberships use card (and optional shopee_recurring via env), not GIRO.
 *
 * - `HITPAY_RECURRING_PAYMENT_METHODS`: comma-separated subset of `card`, `shopee_recurring` (`giro` is ignored).
 * - If unset or only invalid values: `["card"]`.
 */
export function getHitpayRecurringPaymentMethods(_currency: string): string[] {
  const raw = process.env.HITPAY_RECURRING_PAYMENT_METHODS?.trim();
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => HITPAY_RECURRING_METHODS_ALLOWED.has(s))
      .filter((s) => s !== "giro");
    if (list.length > 0) return list;
  }
  return ["card"];
}

type HitpayRecurringBillingResponse = {
  id?: string;
  status?: string;
  url?: string;
  customer_email?: string;
  customer_name?: string;
  name?: string;
  reference?: string;
  cycle?: string;
  expires_at?: string;
  updated_at?: string;
};

const REF_PREFIX = "STU";

function getHitpayPlatformHeaders(apiKey: string) {
  const merchantKey = apiKey.trim();
  if (!merchantKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");

  return {
    "X-BUSINESS-API-KEY": merchantKey,
    "X-PLATFORM-KEY": HITPAY_PLATFORM_KEY,
    "X-Requested-With": "XMLHttpRequest",
  };
}

export function generatePaymentReference() {
  const date = new Date();
  const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const buf = new Uint8Array(3);
  crypto.webcrypto.getRandomValues(buf);
  const rand = Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${REF_PREFIX}-${ymd}-${rand}`;
}

export async function createHitpayPaymentRequest(input: HitpayPaymentRequest) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");

  const body = new URLSearchParams();
  body.set("amount", input.amount);
  body.set("currency", input.currency);
  body.set("reference_number", input.reference_number);
  body.set("redirect_url", input.redirect_url);
  if (input.email) body.set("email", input.email);
  if (input.name) body.set("name", input.name);
  if (input.purpose) body.set("purpose", input.purpose);

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/payment-requests`, {
    method: "POST",
    headers: {
      ...getHitpayPlatformHeaders(apiKey),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as HitpayPaymentResponse & { message?: string };
  if (!res.ok) {
    throw new Error(payload?.message || "hitpay_create_failed");
  }

  const checkoutUrl = payload.url || payload.payment_request_url;
  if (!payload.id || !checkoutUrl) {
    throw new Error("hitpay_invalid_response");
  }

  return {
    providerPaymentId: payload.id,
    checkoutUrl,
    providerStatus: payload.status || "pending",
  };
}

export function verifyHitpayWebhookSignature(rawBody: string, signature: string | null, webhookSalt: string | null) {
  if (!webhookSalt || !signature) return false;
  const digest = crypto.createHmac("sha256", webhookSalt).update(rawBody, "utf8").digest("hex");
  return digest === signature;
}

export async function createHitpayRecurringBilling(input: HitpayRecurringBillingRequest) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/recurring-billing`, {
    method: "POST",
    headers: {
      ...getHitpayPlatformHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customer_email: input.customerEmail,
      customer_name: input.customerName,
      start_date: input.startDate,
      plan_id: null,
      save_card: "false",
      save_payment_method: "false",
      start_date_method: null,
      name: input.name,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency,
      cycle: input.cycle,
      redirect_url: input.redirectUrl,
      reference: input.reference,
      payment_methods:
        input.paymentMethods && input.paymentMethods.length > 0
          ? input.paymentMethods
          : getHitpayRecurringPaymentMethods(input.currency),
      send_email: input.sendEmail ? "true" : "false",
    }),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as HitpayRecurringBillingResponse & { message?: string };
  if (!res.ok) {
    throw new Error(String(payload?.message ?? "hitpay_recurring_create_failed"));
  }
  if (!payload.id || !payload.url) {
    throw new Error("hitpay_invalid_response");
  }

  return {
    recurringBillingId: payload.id,
    checkoutUrl: payload.url,
    status: payload.status || "scheduled",
  };
}

export async function cancelHitpayRecurringBilling(input: { apiKey: string; recurringBillingId: string }) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");
  if (!input.recurringBillingId) throw new Error("hitpay_recurring_id_missing");

  const res = await fetch(
    `${HITPAY_API_BASE.replace(/\/$/, "")}/v1/recurring-billing/${encodeURIComponent(input.recurringBillingId)}`,
    {
      method: "DELETE",
      headers: {
        ...getHitpayPlatformHeaders(apiKey),
      },
      cache: "no-store",
    },
  );

  const payload = (await res.json().catch(() => ({}))) as HitpayRecurringBillingResponse & { message?: string };
  if (!res.ok) {
    throw new Error(String(payload?.message ?? "hitpay_recurring_cancel_failed"));
  }

  return {
    recurringBillingId: payload.id ?? input.recurringBillingId,
    status: payload.status ?? "canceled",
    expiresAt: payload.expires_at ?? null,
  };
}

export async function refundHitpayPayment(input: {
  apiKey: string;
  paymentId: string;
  amount: number;
}): Promise<HitpayRefundResponse> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");
  if (!input.paymentId) throw new Error("hitpay_payment_id_missing");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("invalid_refund_amount");

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/refund`, {
    method: "POST",
    headers: {
      ...getHitpayPlatformHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      payment_id: input.paymentId,
      amount: Number(input.amount.toFixed(2)),
    }),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as HitpayRefundResponse;
  if (!res.ok) {
    const rawMessage = String(payload?.message ?? "hitpay_refund_failed");
    throw new Error(rawMessage);
  }

  return payload;
}

type HitpayGetPaymentRequestResponse = {
  id?: string;
  status?: string;
  message?: string;
  payments?: Array<{ id?: string; status?: string }>;
};

/**
 * GET /v1/payment-requests/{id} — used to reconcile status when webhooks are delayed or misconfigured.
 */
export async function getHitpayPaymentRequest(input: { apiKey: string; requestId: string }): Promise<{
  status: string;
  requestId: string;
  payload: HitpayGetPaymentRequestResponse;
}> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!HITPAY_PLATFORM_KEY) throw new Error("hitpay_platform_key_missing");
  const rid = input.requestId.trim();
  if (!rid) throw new Error("hitpay_request_id_missing");

  const res = await fetch(
    `${HITPAY_API_BASE.replace(/\/$/, "")}/v1/payment-requests/${encodeURIComponent(rid)}`,
    {
      method: "GET",
      headers: {
        ...getHitpayPlatformHeaders(apiKey),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const payload = (await res.json().catch(() => ({}))) as HitpayGetPaymentRequestResponse;
  if (!res.ok) {
    throw new Error(String(payload?.message ?? "hitpay_get_payment_failed"));
  }

  let status = String(payload.status ?? "").trim().toLowerCase();
  const firstPay = Array.isArray(payload.payments) ? payload.payments[0] : null;
  const paySt = String(firstPay?.status ?? "").trim().toLowerCase();
  if (paySt === "succeeded" || paySt === "completed") {
    status = "completed";
  }

  return {
    status,
    requestId: String(payload.id ?? rid),
    payload,
  };
}
