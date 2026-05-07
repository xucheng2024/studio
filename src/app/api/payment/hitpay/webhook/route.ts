import { NextResponse } from "next/server";
import { isMembershipEnded } from "@/lib/membership-subscription";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHitpayWebhookSignature } from "@/lib/hitpay";
import { ensurePaymentClientId } from "@/lib/resolveClientId";

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

function normalizeRecurringStatus(raw: string | null | undefined) {
  const status = String(raw ?? "").trim().toLowerCase();
  if (status === "cancelled") return "canceled";
  if (["scheduled", "active", "retrying", "inactive", "paused", "canceled"].includes(status)) return status;
  if (status === "succeeded") return "active";
  return null;
}

function normalizeRecurringPaymentStatus(raw: string | null | undefined) {
  const status = String(raw ?? "").trim().toLowerCase();
  if (status === "succeeded" || status === "completed") return "paid";
  if (status === "refunded") return "refunded";
  if (status === "failed" || status === "canceled" || status === "cancelled" || status === "expired") return "failed";
  return null;
}

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

function addMembershipPeriod(anchorIso: string, interval: string | null | undefined) {
  const next = new Date(anchorIso);
  if (Number.isNaN(next.getTime())) return null;
  if (interval === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

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

  if (!subscription) return { admin, subscription: null };

  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_webhook_salt")
    .eq("studio_id", subscription.studio_id)
    .maybeSingle();
  const verified = verifyHitpayWebhookSignature(args.rawBody, args.signature, secrets?.hitpay_webhook_salt ?? null);
  if (!verified) return { admin, subscription: null };

  return { admin, subscription };
}

async function handleRecurringWebhook(req: Request, rawBody: string, payload: HitpayWebhookPayload) {
  const signature = req.headers.get("x-hitpay-signature");
  const eventType = (req.headers.get("hitpay-event-type") ?? "").trim().toLowerCase();
  const eventObject = (req.headers.get("hitpay-event-object") ?? "").trim().toLowerCase();
  const referenceCode = payload.reference_number?.trim() || payload.reference?.trim() || null;
  const recurringBillingId = eventObject === "recurring_billing" ? payload.id?.trim() || null : null;
  const chargeId =
    payload.payment_provider?.charge?.id?.trim() ||
    payload.payment_id?.trim() ||
    payload.charge_id?.trim() ||
    (eventObject === "charge" ? payload.id?.trim() || null : null);

  const { admin, subscription } = await resolveRecurringWebhookContext({
    rawBody,
    signature,
    referenceCode,
    recurringBillingId,
    chargeId,
  });
  if (!subscription?.id) {
    return NextResponse.json({ ok: true });
  }

  if (eventObject === "recurring_billing" || eventType === "method_attached" || eventType === "method_detached" || eventType === "subscription_updated") {
    const recurringStatus = normalizeRecurringStatus(payload.status);
    const nowIso = new Date().toISOString();
    const update: Record<string, string | null> = {
      gateway_payload: rawBody,
      updated_at: nowIso,
    };
    const endingAtPeriodEnd =
      recurringStatus === "canceled" &&
      subscription.cancel_at_period_end &&
      subscription.current_period_end &&
      !isMembershipEnded(
        {
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_end: subscription.current_period_end,
        },
        new Date(),
      );
    if (recurringStatus && !endingAtPeriodEnd) update.status = recurringStatus;
    if (eventType === "method_attached") {
      update.payment_method_attached_at = payload.updated_at ?? payload.created_at ?? nowIso;
    }
    if (recurringStatus === "canceled" && !endingAtPeriodEnd) {
      update.canceled_at = payload.updated_at ?? payload.created_at ?? nowIso;
    }
    await admin.from("customer_subscriptions").update(update).eq("id", subscription.id);
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
  const gatewayMethod = payload.payment_provider?.charge?.method ?? "card";
  const gatewayStatus = String(payload.status ?? "").trim().toLowerCase() || null;
  const currentPeriodEnd = addMembershipPeriod(effectiveAt, subscription.billing_interval_snapshot);

  const { data: existingPayment } = await admin
    .from("payments")
    .select("id, paid_at")
    .eq("gateway_payment_id", chargeId)
    .eq("source", "membership_subscription")
    .maybeSingle();

  if (existingPayment?.id) {
    await admin
      .from("payments")
      .update({
        status: paymentStatus,
        gateway_status: gatewayStatus,
        gateway_payload: rawBody,
        gateway_refund_payment_id: chargeId,
        paid_at: paymentStatus === "paid" ? effectiveAt : existingPayment.paid_at ?? null,
      })
      .eq("id", existingPayment.id);
  } else {
    await admin.from("payments").insert({
      studio_id: subscription.studio_id,
      client_id: subscription.client_id,
      membership_product_id: subscription.membership_product_id,
      customer_subscription_id: subscription.id,
      membership_name_snapshot: subscription.membership_name_snapshot ?? null,
      amount,
      currency,
      payment_method: "hitpay",
      source: "membership_subscription",
      type: "subscription",
      status: paymentStatus,
      reference_code: `${subscription.reference_code}:${chargeId.slice(0, 8)}`,
      gateway_payment_id: chargeId,
      gateway_refund_payment_id: chargeId,
      gateway_status: gatewayStatus,
      gateway_payload: rawBody,
      created_at: effectiveAt,
      paid_at: paymentStatus === "paid" ? effectiveAt : null,
    });
  }

  const subscriptionUpdate: Record<string, string | null> = {
    status: paymentStatus === "paid" ? "active" : subscription.status ?? "scheduled",
    gateway_payload: rawBody,
    updated_at: new Date().toISOString(),
  };
  if (paymentStatus === "paid") {
    subscriptionUpdate.last_charge_at = effectiveAt;
    if (currentPeriodEnd) subscriptionUpdate.current_period_end = currentPeriodEnd;
  }

  await admin
    .from("customer_subscriptions")
    .update(subscriptionUpdate)
    .eq("id", subscription.id);

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hitpay-signature");
  const payload = parseWebhookPayload(rawBody);
  const eventObject = (req.headers.get("hitpay-event-object") ?? "").trim().toLowerCase();
  const eventType = (req.headers.get("hitpay-event-type") ?? "").trim().toLowerCase();

  if (
    payload.channel === "recurrent" ||
    eventObject === "recurring_billing" ||
    eventObject === "charge" ||
    eventType === "method_attached" ||
    eventType === "method_detached" ||
    eventType === "subscription_updated"
  ) {
    return handleRecurringWebhook(req, rawBody, payload);
  }

  const providerId = payload.id?.trim() || payload.payment_request_id?.trim() || null;
  const firstSettledPayment = Array.isArray(payload.payments) ? payload.payments[0] : null;
  const providerPaymentId =
    firstSettledPayment?.id?.trim() || payload.payment_id?.trim() || payload.charge_id?.trim() || null;
  const referenceCode = payload.reference_number?.trim() || null;
  const providerStatus = (payload.status ?? "").trim().toLowerCase();
  if (!providerId && !referenceCode) {
    return NextResponse.json({ error: "missing_payment_reference" }, { status: 400 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("payments")
    .select("id, status, reference_code, gateway_payment_id, studio_id, booking_id, event_booking_id, studios(owner_id)")
    .limit(1);
  if (providerId) {
    query = query.eq("gateway_payment_id", providerId);
  } else {
    query = query.eq("reference_code", referenceCode);
  }
  const { data: payment } = await query.maybeSingle();
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

  await admin
    .from("payments")
    .update({
      gateway_status: providerStatus || null,
      gateway_payload: rawBody,
      gateway_refund_payment_id: providerPaymentId,
    })
    .eq("id", payment.id);

  if (providerStatus === "completed" || providerStatus === "succeeded") {
    const clientId = await ensurePaymentClientId(admin, payment.id);
    if (clientId) {
      await upsertMemberStudioMembership(admin, {
        userId: clientId,
        studioId: payment.studio_id,
      });
    }
    const ownerId = studio?.owner_id ?? null;
    if (ownerId) {
      if ((payment as { event_booking_id?: string | null }).event_booking_id) {
        await admin.rpc("confirm_event_payment_with_invoice", {
          p_payment_id: payment.id,
          p_verified_by: ownerId,
        });
      } else {
        await admin.rpc("confirm_payment_with_invoice", {
          p_payment_id: payment.id,
          p_verified_by: ownerId,
        });
      }
    } else {
      if ((payment as { event_booking_id?: string | null }).event_booking_id) {
        await admin.rpc("confirm_event_payment", {
          p_payment_id: payment.id,
        });
      } else {
        await admin.rpc("confirm_payment", {
          p_payment_id: payment.id,
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "failed" || providerStatus === "canceled" || providerStatus === "cancelled") {
    if ((payment as { event_booking_id?: string | null }).event_booking_id) {
      await admin.rpc("cancel_pending_event_payment", { p_payment_id: payment.id, p_new_status: "failed" });
    } else {
      await admin.rpc("cancel_pending_payment", { p_payment_id: payment.id, p_new_status: "failed" });
    }
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "expired") {
    if ((payment as { event_booking_id?: string | null }).event_booking_id) {
      await admin.rpc("cancel_pending_event_payment", { p_payment_id: payment.id, p_new_status: "expired" });
    } else {
      await admin.rpc("cancel_pending_payment", { p_payment_id: payment.id, p_new_status: "expired" });
    }
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "refunded") {
    const ownerId = studio?.owner_id ?? null;
    if (ownerId) {
      await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: payment.id,
        p_operator_id: ownerId,
        p_reason: "hitpay_webhook_refund",
      });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
