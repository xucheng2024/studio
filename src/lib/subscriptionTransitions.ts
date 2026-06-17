import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelHitpayRecurringBilling,
  isHitpayPlatformMerchantKeyConflict,
  refundHitpayPayment,
} from "@/lib/hitpay";
import { isMembershipEnded } from "@/lib/membership-subscription";
import { normalizeHitpayRecurringBillingStatus } from "@/lib/hitpayRecurringStatus";

export type SubscriptionTransitionRow = {
  id: string;
  studio_id: string;
  client_id?: string | null;
  recurring_billing_id?: string | null;
  reference_code?: string | null;
  status?: string | null;
  payment_method_attached_at?: string | null;
  canceled_at?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  billing_interval_snapshot?: string | null;
  membership_product_id?: string | null;
  membership_name_snapshot?: string | null;
  billing_start_date?: string | null;
  created_at?: string | null;
  last_charge_at?: string | null;
};

type LatestSubscriptionPayment = {
  id: string;
  status: string | null;
  amount?: number | null;
  paid_amount?: number | null;
  gateway_refund_payment_id?: string | null;
  gateway_payment_id?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
};

export function getTodayInSingapore() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export function getMembershipStartDateInSingapore(trialDays: number) {
  const base = new Date(`${getTodayInSingapore()}T00:00:00+08:00`);
  const days = Number.isFinite(trialDays) ? Math.max(0, Math.floor(trialDays)) : 0;
  base.setDate(base.getDate() + days);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

export async function createScheduledSubscriptionRecord(
  admin: SupabaseClient,
  input: {
    studioId: string;
    clientId: string;
    membershipProductId: string;
    referenceCode: string;
    customerName: string;
    customerEmail: string;
    membershipName: string;
    membershipPrice: number | null;
    billingInterval: string | null;
    billingStartDate: string;
  },
) {
  return admin
    .from("customer_subscriptions")
    .insert({
      studio_id: input.studioId,
      client_id: input.clientId,
      membership_product_id: input.membershipProductId,
      reference_code: input.referenceCode,
      status: "scheduled",
      customer_name_snapshot: input.customerName,
      customer_email_snapshot: input.customerEmail,
      membership_name_snapshot: input.membershipName,
      membership_price_snapshot: input.membershipPrice,
      billing_interval_snapshot: input.billingInterval,
      cancel_at_period_end: false,
      billing_start_date: input.billingStartDate,
    })
    .select("id")
    .single();
}

export async function attachRecurringBillingToSubscription(
  admin: SupabaseClient,
  input: {
    subscriptionId: string;
    recurringBillingId: string;
    checkoutUrl: string | null;
    status: string | null;
    nowIso?: string;
  },
) {
  return admin
    .from("customer_subscriptions")
    .update({
      recurring_billing_id: input.recurringBillingId,
      checkout_url: input.checkoutUrl,
      status: input.status,
      updated_at: input.nowIso ?? new Date().toISOString(),
    })
    .eq("id", input.subscriptionId);
}

export async function applyRecurringSubscriptionStatus(
  admin: SupabaseClient,
  subscription: SubscriptionTransitionRow,
  input: {
    recurringStatusRaw: string | null | undefined;
    gatewayPayload: string;
    eventKind: "method_attached" | "provider_status" | "provider_sync";
    occurredAt?: string | null;
    now?: Date;
  },
) {
  const recurringStatus = normalizeHitpayRecurringBillingStatus(input.recurringStatusRaw);
  const nowIso = (input.now ?? new Date()).toISOString();
  const update: Record<string, string | null | boolean> = {
    gateway_payload: input.gatewayPayload,
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
      input.now ?? new Date(),
    );
  const currentLower = String(subscription.status ?? "").toLowerCase();

  if (input.eventKind === "method_attached") {
    update.payment_method_attached_at = input.occurredAt ?? nowIso;
    if (currentLower === "scheduled") {
      update.status = "active";
    }
  } else if (recurringStatus) {
    if (input.eventKind === "provider_sync" && recurringStatus === "canceled") {
      update.cancel_at_period_end = false;
      update.canceled_at = subscription.canceled_at ?? nowIso;
      update.status = "canceled";
    } else if (!endingAtPeriodEnd) {
      const wouldDowngrade =
        ["active", "retrying", "paused", "inactive"].includes(currentLower) &&
        recurringStatus === "scheduled";
      if (!wouldDowngrade) {
        update.status = recurringStatus;
      }
      if (recurringStatus === "canceled") {
        update.canceled_at = input.occurredAt ?? nowIso;
      }
    }
    if (
      input.eventKind === "provider_sync" &&
      recurringStatus === "active" &&
      !subscription.payment_method_attached_at
    ) {
      update.payment_method_attached_at = input.occurredAt ?? nowIso;
    }
  }

  await admin.from("customer_subscriptions").update(update).eq("id", subscription.id);
}

export async function markSubscriptionCanceledFromRemoteNotFound(
  admin: SupabaseClient,
  subscription: Pick<SubscriptionTransitionRow, "id" | "status" | "canceled_at">,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const gatewayPayload = JSON.stringify({
    source: "hitpay_sync_not_found",
    fetched_at: nowIso,
    detail: "No recurring billing matched reference/recurring id (often after cancel or expiry).",
  });
  if (String(subscription.status ?? "").toLowerCase() !== "scheduled") {
    return false;
  }
  await admin
    .from("customer_subscriptions")
    .update({
      status: "canceled",
      canceled_at: subscription.canceled_at ?? nowIso,
      cancel_at_period_end: false,
      gateway_payload: gatewayPayload,
      updated_at: nowIso,
      cancel_reason: "hitpay_sync_remote_not_found",
    })
    .eq("id", subscription.id);
  return true;
}

export function addMembershipPeriod(anchorIso: string, interval: string | null | undefined) {
  const next = new Date(anchorIso);
  if (Number.isNaN(next.getTime())) return null;
  if (interval === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

export async function recordRecurringSubscriptionCharge(
  admin: SupabaseClient,
  subscription: SubscriptionTransitionRow & {
    client_id: string;
    reference_code: string;
  },
  input: {
    chargeId: string;
    paymentStatus: "paid" | "failed" | "refunded";
    amount: number;
    currency: string;
    gatewayStatus: string | null;
    gatewayPayload: string;
    effectiveAt: string;
  },
) {
  const currentPeriodEnd = addMembershipPeriod(input.effectiveAt, subscription.billing_interval_snapshot);
  const { data: existingPayment } = await admin
    .from("payments")
    .select("id, paid_at")
    .eq("gateway_payment_id", input.chargeId)
    .eq("source", "membership_subscription")
    .maybeSingle<{ id: string; paid_at: string | null }>();

  if (existingPayment?.id) {
    await admin
      .from("payments")
      .update({
        status: input.paymentStatus,
        gateway_status: input.gatewayStatus,
        gateway_payload: input.gatewayPayload,
        gateway_refund_payment_id: input.chargeId,
        paid_at: input.paymentStatus === "paid" ? input.effectiveAt : existingPayment.paid_at ?? null,
      })
      .eq("id", existingPayment.id);
  } else {
    await admin.from("payments").insert({
      studio_id: subscription.studio_id,
      client_id: subscription.client_id,
      membership_product_id: subscription.membership_product_id,
      customer_subscription_id: subscription.id,
      membership_name_snapshot: subscription.membership_name_snapshot ?? null,
      amount: input.amount,
      currency: input.currency,
      payment_method: "hitpay",
      source: "membership_subscription",
      type: "subscription",
      status: input.paymentStatus,
      reference_code: `${subscription.reference_code}:${input.chargeId.slice(0, 8)}`,
      gateway_payment_id: input.chargeId,
      gateway_refund_payment_id: input.chargeId,
      gateway_status: input.gatewayStatus,
      gateway_payload: input.gatewayPayload,
      created_at: input.effectiveAt,
      paid_at: input.paymentStatus === "paid" ? input.effectiveAt : null,
    });
  }

  const subscriptionUpdate: Record<string, string | null> = {
    status: input.paymentStatus === "paid" ? "active" : subscription.status ?? "scheduled",
    gateway_payload: input.gatewayPayload,
    updated_at: new Date().toISOString(),
  };
  if (input.paymentStatus === "paid") {
    subscriptionUpdate.last_charge_at = input.effectiveAt;
    if (currentPeriodEnd) subscriptionUpdate.current_period_end = currentPeriodEnd;
  }

  await admin
    .from("customer_subscriptions")
    .update(subscriptionUpdate)
    .eq("id", subscription.id);
}

async function getLatestSubscriptionPayment(
  admin: SupabaseClient,
  subscriptionId: string,
) {
  const { data } = await admin
    .from("payments")
    .select("id, status, amount, paid_amount, gateway_refund_payment_id, gateway_payment_id, paid_at, created_at")
    .eq("customer_subscription_id", subscriptionId)
    .eq("source", "membership_subscription")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<LatestSubscriptionPayment>();
  return data ?? null;
}

export function getMembershipTrialDeadline(
  subscription: Pick<SubscriptionTransitionRow, "billing_start_date" | "last_charge_at" | "created_at">,
  trialDays: number,
  latestPayment: LatestSubscriptionPayment | null,
  nowIso: string,
) {
  const billingStartDate = subscription.billing_start_date ?? null;
  if (billingStartDate) {
    return new Date(`${billingStartDate}T00:00:00+08:00`);
  }
  const anchorRaw = latestPayment?.status === "paid"
    ? (latestPayment.paid_at ?? latestPayment.created_at ?? subscription.last_charge_at ?? subscription.created_at ?? nowIso)
    : (subscription.last_charge_at ?? subscription.created_at ?? nowIso);
  const deadline = new Date(anchorRaw);
  deadline.setDate(deadline.getDate() + Math.max(0, trialDays));
  return deadline;
}

export function deriveSubscriptionPeriodEnd(
  subscription: Pick<SubscriptionTransitionRow, "current_period_end" | "last_charge_at" | "created_at" | "billing_interval_snapshot">,
  nowIso: string,
) {
  if (subscription.current_period_end) return subscription.current_period_end;
  const anchor = subscription.last_charge_at ?? subscription.created_at ?? nowIso;
  const next = new Date(anchor);
  if (Number.isNaN(next.getTime())) return nowIso;
  if (subscription.billing_interval_snapshot === "yearly") next.setFullYear(next.getFullYear() + 1);
  else next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

export async function cancelMembershipSubscription(
  admin: SupabaseClient,
  input: {
    subscription: SubscriptionTransitionRow;
    actorId: string;
    actorKind: "member" | "staff";
    trialDays: number;
    now?: Date;
    allowRemoteCancelFallback?: boolean;
  },
) {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  let recurringCancelFallback = false;

  if (input.subscription.recurring_billing_id) {
    const { data: secrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", input.subscription.studio_id)
      .maybeSingle();
    const apiKey = secrets?.hitpay_api_key ?? null;
    if (!apiKey) return { ok: false as const, status: 409, error: "hitpay_not_configured" };
    try {
      const result = await cancelHitpayRecurringBilling({
        apiKey,
        recurringBillingId: input.subscription.recurring_billing_id,
      });
      if (result.expiresAt) {
        input.subscription.current_period_end = result.expiresAt;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "hitpay_recurring_cancel_failed";
      const pendingUncharged =
        String(input.subscription.status ?? "").toLowerCase() === "scheduled" &&
        !input.subscription.last_charge_at;
      const platformKeyConflict = isHitpayPlatformMerchantKeyConflict(message);
      const allowLocalWithoutRemoteCancel =
        input.allowRemoteCancelFallback === true &&
        (pendingUncharged || (platformKeyConflict && input.trialDays > 0));

      if (allowLocalWithoutRemoteCancel) {
        recurringCancelFallback = true;
      } else {
        return {
          ok: false as const,
          status: 409,
          error: message,
          error_detail: platformKeyConflict
            ? input.actorKind === "member"
              ? "HitPay platform mode requires different values for env HITPAY_PLATFORM_API_KEY (platform) and the studio merchant API key. They must not be identical. Fix keys or cancel the subscription in the HitPay dashboard."
              : null
            : null,
        };
      }
    }
  }

  if (
    String(input.subscription.status ?? "").toLowerCase() === "scheduled" &&
    !input.subscription.last_charge_at
  ) {
    const cancelReason = recurringCancelFallback
      ? "cancelled_pending_activation_local_fallback"
      : "cancelled_pending_activation";
    const { error } = await admin
      .from("customer_subscriptions")
      .update({
        status: "canceled",
        canceled_at: nowIso,
        cancel_at_period_end: false,
        cancel_requested_at: nowIso,
        current_period_end: nowIso,
        updated_at: nowIso,
        cancel_reason: cancelReason,
      })
      .eq("id", input.subscription.id);
    if (error) return { ok: false as const, status: 500, error: error.message };
    return { ok: true as const, mode: "pending_activation" as const };
  }

  if (input.trialDays > 0) {
    const latestPayment = await getLatestSubscriptionPayment(admin, input.subscription.id);
    const trialDeadline = getMembershipTrialDeadline(input.subscription, input.trialDays, latestPayment, nowIso);
    const withinTrial = now.getTime() <= trialDeadline.getTime();

    if (withinTrial && latestPayment?.status === "paid") {
      const { data: secrets } = await admin
        .from("studio_payment_secrets")
        .select("hitpay_api_key")
        .eq("studio_id", input.subscription.studio_id)
        .maybeSingle();
      const apiKey = secrets?.hitpay_api_key ?? null;
      if (!apiKey) return { ok: false as const, status: 409, error: "hitpay_not_configured" };
      const gatewayPaymentId = latestPayment.gateway_refund_payment_id ?? latestPayment.gateway_payment_id ?? null;
      if (!gatewayPaymentId) return { ok: false as const, status: 409, error: "gateway_payment_id_missing" };

      try {
        await refundHitpayPayment({
          apiKey,
          paymentId: gatewayPaymentId,
          amount: Number(latestPayment.paid_amount ?? latestPayment.amount ?? 0),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "hitpay_refund_failed";
        const platformKeyConflict = isHitpayPlatformMerchantKeyConflict(message);
        return {
          ok: false as const,
          status: 409,
          error: message,
          error_detail: platformKeyConflict
            ? input.actorKind === "member"
              ? "HitPay refund rejected: platform and merchant API keys must differ (see env HITPAY_PLATFORM_API_KEY vs studio merchant key). Fix keys or process refund in HitPay dashboard."
              : null
            : null,
        };
      }

      const { data: refundResult, error: refundErr } = await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: latestPayment.id,
        p_operator_id: input.actorId,
        p_reason: "cancelled_within_membership_trial",
      });
      if (refundErr) return { ok: false as const, status: 500, error: refundErr.message };
      const rr = refundResult as { ok?: boolean; error?: string };
      if (!rr?.ok) return { ok: false as const, status: 409, error: rr?.error ?? "refund_failed" };
    }

    if (withinTrial) {
      const cancelReason =
        latestPayment?.status === "paid"
          ? input.actorKind === "member"
            ? "cancelled_by_member_trial_refund"
            : "cancelled_by_studio_trial_refund"
          : input.actorKind === "member"
            ? "cancelled_by_member_trial"
            : "cancelled_by_studio_trial";
      const { error } = await admin
        .from("customer_subscriptions")
        .update({
          status: "canceled",
          canceled_at: nowIso,
          cancel_at_period_end: false,
          cancel_requested_at: nowIso,
          updated_at: nowIso,
          cancel_reason: cancelReason,
        })
        .eq("id", input.subscription.id);
      if (error) return { ok: false as const, status: 500, error: error.message };
      return {
        ok: true as const,
        mode: latestPayment?.status === "paid" ? "trial_refunded" as const : "trial" as const,
      };
    }
  }

  const finalPeriodEnd = deriveSubscriptionPeriodEnd(input.subscription, nowIso);
  const endedImmediately = isMembershipEnded(
    {
      status: input.subscription.status,
      cancel_at_period_end: true,
      current_period_end: finalPeriodEnd,
    },
    now,
  );
  const { error } = await admin
    .from("customer_subscriptions")
    .update({
      status: endedImmediately ? "canceled" : input.subscription.status,
      canceled_at: endedImmediately ? nowIso : null,
      cancel_at_period_end: !endedImmediately,
      cancel_requested_at: nowIso,
      current_period_end: finalPeriodEnd,
      updated_at: nowIso,
      cancel_reason: input.actorKind === "member" ? "cancelled_by_member" : "cancelled_by_studio",
    })
    .eq("id", input.subscription.id);
  if (error) return { ok: false as const, status: 500, error: error.message };

  return {
    ok: true as const,
    mode: "period_end" as const,
    current_period_end: finalPeriodEnd,
  };
}
