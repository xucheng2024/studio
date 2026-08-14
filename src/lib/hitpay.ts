import crypto from "crypto";

const HITPAY_API_BASE = process.env.HITPAY_API_BASE_URL?.trim() || "https://api.hit-pay.com";

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
export function getHitpayRecurringPaymentMethods(): string[] {
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

function getHitpayErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || !("message" in payload)) return fallback;
  const raw = String((payload as { message?: unknown }).message ?? "").trim();
  if (!raw) return fallback;
  const sanitized = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, 500) : fallback;
}

function getHitpayMerchantHeaders(apiKey: string) {
  const merchantKey = apiKey.trim();
  if (!merchantKey) throw new Error("hitpay_merchant_key_missing");

  return {
    "X-BUSINESS-API-KEY": merchantKey,
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
      ...getHitpayMerchantHeaders(apiKey),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as HitpayPaymentResponse & { message?: string };
  if (!res.ok) {
    throw new Error(getHitpayErrorMessage(payload, "hitpay_create_failed"));
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
  const expected = Buffer.from(digest, "utf8");
  const received = Buffer.from(signature, "utf8");
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
}

export async function createHitpayRecurringBilling(input: HitpayRecurringBillingRequest) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/recurring-billing`, {
    method: "POST",
    headers: {
      ...getHitpayMerchantHeaders(apiKey),
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
          : getHitpayRecurringPaymentMethods(),
      send_email: input.sendEmail ? "true" : "false",
    }),
    cache: "no-store",
  });

  const payload = (await res.json().catch(() => ({}))) as HitpayRecurringBillingResponse & { message?: string };
  if (!res.ok) {
    throw new Error(getHitpayErrorMessage(payload, "hitpay_recurring_create_failed"));
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

/**
 * Official API: GET /v1/recurring-billing — list with optional `reference` and `status`.
 * Docs default `status` to `active`, so `scheduled` rows are omitted unless queried explicitly.
 * @see https://docs.hitpayapp.com/apis/recurring-billing/get-all-billing
 */
export async function getHitpayRecurringBilling(input: {
  apiKey: string;
  reference: string;
  recurringBillingId?: string | null;
}) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  const reference = input.reference.trim();
  if (!reference) throw new Error("hitpay_reference_missing");

  const base = `${HITPAY_API_BASE.replace(/\/$/, "")}/v1/recurring-billing`;
  /** HitPay filters by status; UK spelling `cancelled` may omit rows when only `canceled` is queried. */
  const statuses = ["scheduled", "active", "retrying", "inactive", "paused", "canceled", "cancelled"] as const;
  const rid = input.recurringBillingId?.trim() ?? null;
  let hadSuccessfulLookup = false;
  const failedLookups: Array<{ status: string; httpStatus: number; message: string }> = [];

  const normalizeListPayload = (payload: unknown): HitpayRecurringBillingResponse[] => {
    if (Array.isArray(payload)) return payload as HitpayRecurringBillingResponse[];
    if (payload && typeof payload === "object") {
      const p = payload as Record<string, unknown>;
      if (Array.isArray(p.data)) return p.data as HitpayRecurringBillingResponse[];
      if (Array.isArray(p.recurring_billings)) return p.recurring_billings as HitpayRecurringBillingResponse[];
    }
    return [];
  };

  for (const status of statuses) {
    const url = `${base}?reference=${encodeURIComponent(reference)}&status=${encodeURIComponent(status)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        ...getHitpayMerchantHeaders(apiKey),
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      failedLookups.push({
        status,
        httpStatus: res.status,
        message: getHitpayErrorMessage(payload, "hitpay_recurring_lookup_failed"),
      });
      continue;
    }
    hadSuccessfulLookup = true;

    const rows = normalizeListPayload(payload);
    const row =
      rid && rows.length > 0
        ? rows.find((r) => String((r as { id?: string }).id ?? "") === rid)
        : rows[0];
    if (row && typeof row === "object" && (row as { id?: string }).id) {
      return row as HitpayRecurringBillingResponse & { message?: string };
    }
  }

  const actionableFailure = failedLookups.find(
    (failure) =>
      !(failure.status === "cancelled" && (failure.httpStatus === 400 || failure.httpStatus === 422)),
  );
  if (actionableFailure || (!hadSuccessfulLookup && failedLookups.length > 0)) {
    throw new Error((actionableFailure ?? failedLookups[0])?.message ?? "hitpay_recurring_lookup_failed");
  }
  throw new Error("hitpay_recurring_not_found");
}

export async function cancelHitpayRecurringBilling(input: { apiKey: string; recurringBillingId: string }) {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_merchant_key_missing");
  if (!input.recurringBillingId) throw new Error("hitpay_recurring_id_missing");

  const res = await fetch(
    `${HITPAY_API_BASE.replace(/\/$/, "")}/v1/recurring-billing/${encodeURIComponent(input.recurringBillingId)}`,
    {
      method: "DELETE",
      headers: {
        ...getHitpayMerchantHeaders(apiKey),
      },
      cache: "no-store",
    },
  );

  const payload = (await res.json().catch(() => ({}))) as HitpayRecurringBillingResponse & { message?: string };
  if (!res.ok) {
    throw new Error(getHitpayErrorMessage(payload, "hitpay_recurring_cancel_failed"));
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
  if (!input.paymentId) throw new Error("hitpay_payment_id_missing");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("invalid_refund_amount");

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/refund`, {
    method: "POST",
    headers: {
      ...getHitpayMerchantHeaders(apiKey),
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
    throw new Error(getHitpayErrorMessage(payload, "hitpay_refund_failed"));
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
  const rid = input.requestId.trim();
  if (!rid) throw new Error("hitpay_request_id_missing");

  const res = await fetch(
    `${HITPAY_API_BASE.replace(/\/$/, "")}/v1/payment-requests/${encodeURIComponent(rid)}`,
    {
      method: "GET",
      headers: {
        ...getHitpayMerchantHeaders(apiKey),
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );

  const payload = (await res.json().catch(() => ({}))) as HitpayGetPaymentRequestResponse;
  if (!res.ok) {
    throw new Error(getHitpayErrorMessage(payload, "hitpay_get_payment_failed"));
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
