import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHitpayWebhookSignature } from "@/lib/hitpay";
import { applyHitpayPaymentRequestStatus } from "@/lib/hitpayApplyPaymentRequestStatus";
import {
  applyRecurringSubscriptionStatus,
  recordRecurringSubscriptionCharge,
} from "@/lib/subscriptionTransitions";

type HitpayWebhookPayload = {
  id?: string;
  payment_request_id?: string;
  payment_id?: string;
  charge_id?: string;
  status?: string;
  reference?: string;
  reference_number?: string;
  currency?: string;
  amount?: string | number;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  channel?: string;
  payments?: Array<{
    id?: string;
    status?: string;
    amount?: string;
    refunded_amount?: string;
  }>;
  customer?: {
    name?: string;
    email?: string;
    phone_number?: string | null;
  };
  payment_provider?: {
    charge?: {
      id?: string;
      method?: string;
    };
  };
};

/** HitPay docs use dotted event types (e.g. `recurring_billing.method_attached`); some payloads send the short name only. */
function hitpayEventTypeMatches(headerValue: string | null | undefined, shortName: string): boolean {
  const h = String(headerValue ?? "").trim().toLowerCase();
  const n = shortName.trim().toLowerCase();
  return h === n || h.endsWith(`.${n}`);
}

function parseWebhookPayload(rawBody: string): HitpayWebhookPayload {
  try {
    return JSON.parse(rawBody) as HitpayWebhookPayload;
  } catch {
    const form = new URLSearchParams(rawBody);
    return {
      id: form.get("id") ?? undefined,
      payment_request_id: form.get("payment_request_id") ?? undefined,
      payment_id: form.get("payment_id") ?? undefined,
      charge_id: form.get("charge_id") ?? undefined,
      status: form.get("status") ?? undefined,
      reference: form.get("reference") ?? undefined,
      reference_number: form.get("reference_number") ?? undefined,
      currency: form.get("currency") ?? undefined,
      amount: form.get("amount") ?? undefined,
      created_at: form.get("created_at") ?? undefined,
      updated_at: form.get("updated_at") ?? undefined,
      closed_at: form.get("closed_at") ?? undefined,
      channel: form.get("channel") ?? undefined,
    };
  }
}

function normalizeRecurringPaymentStatus(raw: string | null | undefined) {
  const status = String(raw ?? "").trim().toLowerCase();
  if (status === "succeeded" || status === "completed") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "failed" || status === "canceled" || status === "cancelled" || status === "expired") return "failed";
  return null;
}

/** Docs say `Hitpay-Signature`; some payloads use `X-Hitpay-Signature`. */
function getHitpaySignatureHeader(req: Request): string | null {
  return (
    req.headers.get("x-hitpay-signature") ??
    req.headers.get("hitpay-signature") ??
    req.headers.get("Hitpay-Signature")
  );
}

type WebhookPaymentLookupRow = {
  id: string;
  status: string;
  reference_code?: string | null;
  gateway_payment_id?: string | null;
  studio_id: string;
  booking_id?: string | null;
  event_booking_id?: string | null;
  studios?: { owner_id?: string | null } | { owner_id?: string | null }[] | null;
};

type RecurringSubscriptionContext = {
  id: string;
  studio_id: string;
  client_id: string;
  membership_product_id: string;
  reference_code: string;
  recurring_billing_id: string | null;
  membership_name_snapshot: string | null;
  status: string | null;
  billing_interval_snapshot?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

async function resolveRecurringWebhookContext(args: {
  rawBody: string;
  signature: string | null;
  referenceCode: string | null;
  recurringBillingId: string | null;
  chargeId: string | null;
}) {
  const admin = createAdminClient();
  let subscription: RecurringSubscriptionContext | null = null;

  if (args.referenceCode) {
    const { data } = await admin
      .from("customer_subscriptions")
      .select("id, studio_id, client_id, membership_product_id, reference_code, recurring_billing_id, membership_name_snapshot, status, billing_interval_snapshot, current_period_end, cancel_at_period_end")
      .eq("reference_code", args.referenceCode)
      .maybeSingle();
    subscription = (data as RecurringSubscriptionContext | null) ?? null;
  }

  if (!subscription && args.recurringBillingId) {
    const { data } = await admin
      .from("customer_subscriptions")
      .select("id, studio_id, client_id, membership_product_id, reference_code, recurring_billing_id, membership_name_snapshot, status, billing_interval_snapshot, current_period_end, cancel_at_period_end")
      .eq("recurring_billing_id", args.recurringBillingId)
      .maybeSingle();
    subscription = (data as RecurringSubscriptionContext | null) ?? null;
  }

  if (!subscription && args.chargeId) {
    const { data: existingPayment } = await admin
      .from("payments")
      .select("customer_subscription_id")
      .eq("source", "membership_subscription")
      .eq("gateway_payment_id", args.chargeId)
      .maybeSingle();
    if (existingPayment?.customer_subscription_id) {
      const { data } = await admin
        .from("customer_subscriptions")
        .select("id, studio_id, client_id, membership_product_id, reference_code, recurring_billing_id, membership_name_snapshot, status, billing_interval_snapshot, current_period_end, cancel_at_period_end")
        .eq("id", existingPayment.customer_subscription_id)
        .maybeSingle();
      subscription = (data as RecurringSubscriptionContext | null) ?? null;
    }
  }

  if (!subscription) return { admin, subscription: null, signatureValid: null as boolean | null };

  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_webhook_salt")
    .eq("studio_id", subscription.studio_id)
    .maybeSingle();
  const verified = verifyHitpayWebhookSignature(args.rawBody, args.signature, secrets?.hitpay_webhook_salt ?? null);
  if (!verified) return { admin, subscription, signatureValid: false as boolean | null };

  return { admin, subscription, signatureValid: true as boolean | null };
}

async function handleRecurringWebhook(req: Request, rawBody: string, payload: HitpayWebhookPayload) {
  const signature = getHitpaySignatureHeader(req);
  const eventType = (req.headers.get("hitpay-event-type") ?? "").trim().toLowerCase();
  const eventObject = (req.headers.get("hitpay-event-object") ?? "").trim().toLowerCase();
  const referenceCode = payload.reference_number?.trim() || payload.reference?.trim() || null;
  /** HitPay sends recurring billing UUID on recurring_billing object and on method_attached / subscription_updated (reference alone may be missing). */
  let recurringBillingId: string | null = null;
  if (eventObject === "recurring_billing") {
    recurringBillingId = payload.id?.trim() || null;
  } else if (
    hitpayEventTypeMatches(eventType, "method_attached") ||
    hitpayEventTypeMatches(eventType, "method_detached") ||
    hitpayEventTypeMatches(eventType, "subscription_updated")
  ) {
    recurringBillingId = payload.id?.trim() || null;
  }
  const chargeId =
    payload.payment_provider?.charge?.id?.trim() ||
    payload.payment_id?.trim() ||
    payload.charge_id?.trim() ||
    (eventObject === "charge" ? payload.id?.trim() || null : null);

  const { admin, subscription, signatureValid } = await resolveRecurringWebhookContext({
    rawBody,
    signature,
    referenceCode,
    recurringBillingId,
    chargeId,
  });
  if (signatureValid === false) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (!subscription?.id) {
    return NextResponse.json({ ok: true });
  }

  if (
    eventObject === "recurring_billing" ||
    hitpayEventTypeMatches(eventType, "method_attached") ||
    hitpayEventTypeMatches(eventType, "method_detached") ||
    hitpayEventTypeMatches(eventType, "subscription_updated")
  ) {
    await applyRecurringSubscriptionStatus(admin, subscription, {
      recurringStatusRaw: payload.status,
      gatewayPayload: rawBody,
      eventKind: hitpayEventTypeMatches(eventType, "method_attached") ? "method_attached" : "provider_status",
      occurredAt: payload.updated_at ?? payload.created_at ?? null,
    });
    return NextResponse.json({ ok: true });
  }

  if (!chargeId) {
    return NextResponse.json({ ok: true });
  }

  const paymentStatus = normalizeRecurringPaymentStatus(payload.status);
  if (!paymentStatus) {
    return NextResponse.json({ ok: true });
  }

  const amount = Number(payload.amount ?? 0);
  const currency = String(payload.currency ?? "SGD").toUpperCase();
  const effectiveAt = payload.closed_at ?? payload.created_at ?? new Date().toISOString();
  const gatewayStatus = String(payload.status ?? "").trim().toLowerCase() || null;
  await recordRecurringSubscriptionCharge(admin, subscription, {
    chargeId,
    paymentStatus,
    amount,
    currency,
    gatewayStatus,
    gatewayPayload: rawBody,
    effectiveAt,
  });

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = getHitpaySignatureHeader(req);
  const payload = parseWebhookPayload(rawBody);
  const eventObject = (req.headers.get("hitpay-event-object") ?? "").trim().toLowerCase();
  const eventType = (req.headers.get("hitpay-event-type") ?? "").trim().toLowerCase();

  if (
    payload.channel === "recurrent" ||
    eventObject === "recurring_billing" ||
    hitpayEventTypeMatches(eventType, "method_attached") ||
    hitpayEventTypeMatches(eventType, "method_detached") ||
    hitpayEventTypeMatches(eventType, "subscription_updated")
  ) {
    return handleRecurringWebhook(req, rawBody, payload);
  }

  const providerRequestId = payload.payment_request_id?.trim() || null;
  const providerId = providerRequestId || payload.id?.trim() || null;
  const firstSettledPayment = Array.isArray(payload.payments) ? payload.payments[0] : null;
  const providerPaymentId =
    firstSettledPayment?.id?.trim() || payload.payment_id?.trim() || payload.charge_id?.trim() || null;
  const referenceCode = payload.reference_number?.trim() || payload.reference?.trim() || null;
  const providerStatus = (payload.status ?? "").trim().toLowerCase();
  if (!providerId && !referenceCode) {
    return NextResponse.json({ error: "missing_payment_reference" }, { status: 400 });
  }

  const admin = createAdminClient();
  let payment: WebhookPaymentLookupRow | null = null;
  if (providerId) {
    const { data } = await admin
      .from("payments")
      .select("id, status, reference_code, gateway_payment_id, studio_id, booking_id, event_booking_id, studios(owner_id)")
      .eq("gateway_payment_id", providerId)
      .limit(1)
      .maybeSingle();
    payment = data as WebhookPaymentLookupRow | null;
  }
  if (!payment?.id && referenceCode) {
    const { data } = await admin
      .from("payments")
      .select("id, status, reference_code, gateway_payment_id, studio_id, booking_id, event_booking_id, studios(owner_id)")
      .eq("reference_code", referenceCode)
      .limit(1)
      .maybeSingle();
    payment = data as WebhookPaymentLookupRow | null;
  }
  if (!payment?.id) {
    return NextResponse.json({ ok: true });
  }
  const studios = payment.studios as
    | { owner_id?: string | null }
    | { owner_id?: string | null }[]
    | null;
  const studio = Array.isArray(studios) ? studios[0] : studios;
  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_webhook_salt")
    .eq("studio_id", payment.studio_id)
    .maybeSingle();
  const verified = verifyHitpayWebhookSignature(rawBody, signature, secrets?.hitpay_webhook_salt ?? null);
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  await applyHitpayPaymentRequestStatus(
    admin,
    payment,
    studio,
    providerStatus,
    rawBody,
    providerPaymentId,
  );
  return NextResponse.json({ ok: true });
}
