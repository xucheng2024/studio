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

const REF_PREFIX = "STU";

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
  if (!apiKey) {
    throw new Error("hitpay_not_configured");
  }

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
      "X-BUSINESS-API-KEY": apiKey,
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

export async function refundHitpayPayment(input: {
  apiKey: string;
  paymentId: string;
  amount: number;
}): Promise<HitpayRefundResponse> {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("hitpay_not_configured");
  if (!input.paymentId) throw new Error("hitpay_payment_id_missing");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("invalid_refund_amount");

  const res = await fetch(`${HITPAY_API_BASE.replace(/\/$/, "")}/v1/refund`, {
    method: "POST",
    headers: {
      "X-BUSINESS-API-KEY": apiKey,
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
