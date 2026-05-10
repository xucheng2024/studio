import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelHitpayRecurringBilling, refundHitpayPayment } from "@/lib/hitpay";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  subscription_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("customer_subscriptions")
    .select("id, client_id, studio_id, recurring_billing_id, status, billing_start_date, last_charge_at, created_at, current_period_end, billing_interval_snapshot, membership_product_id, membership_products(trial_days)")
    .eq("id", parsed.data.subscription_id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (sub.client_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const membership = Array.isArray(sub.membership_products) ? sub.membership_products[0] : sub.membership_products;
  const trialDays = Number(membership?.trial_days ?? 0);

  const now = new Date();
  const nowIso = now.toISOString();
  let recurringCancelFallback = false;

  if (sub.recurring_billing_id) {
    const { data: secrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", sub.studio_id)
      .maybeSingle();
    const apiKey = secrets?.hitpay_api_key ?? null;
    if (!apiKey) return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
    try {
      const result = await cancelHitpayRecurringBilling({
        apiKey,
        recurringBillingId: sub.recurring_billing_id,
      });
      if (result.expiresAt) {
        (sub as { current_period_end?: string | null }).current_period_end = result.expiresAt;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "hitpay_recurring_cancel_failed";
      const pendingUncharged =
        String(sub.status ?? "").toLowerCase() === "scheduled" &&
        !(sub as { last_charge_at?: string | null }).last_charge_at;
      if (!pendingUncharged) {
        return NextResponse.json({ error: message }, { status: 409 });
      }
      recurringCancelFallback = true;
    }
  }

  // Pending activation with no successful charge should be cancellable locally
  // even when upstream recurring cancellation cannot be confirmed.
  if (
    String(sub.status ?? "").toLowerCase() === "scheduled" &&
    !(sub as { last_charge_at?: string | null }).last_charge_at
  ) {
    const { error } = await admin
      .from("customer_subscriptions")
      .update({
        status: "canceled",
        canceled_at: nowIso,
        cancel_at_period_end: false,
        cancel_requested_at: nowIso,
        current_period_end: nowIso,
        updated_at: nowIso,
        cancel_reason: recurringCancelFallback
          ? "cancelled_pending_activation_local_fallback"
          : "cancelled_pending_activation",
      })
      .eq("id", sub.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, mode: "pending_activation" });
  }

  if (trialDays > 0) {
    const { data: latestPayment } = await admin
      .from("payments")
      .select("id, status, amount, paid_amount, gateway_refund_payment_id, gateway_payment_id, payment_method, paid_at, created_at")
      .eq("customer_subscription_id", sub.id)
      .eq("source", "membership_subscription")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const trialAnchorRaw = latestPayment?.status === "paid"
      ? (latestPayment.paid_at ?? latestPayment.created_at ?? sub.last_charge_at ?? sub.created_at ?? nowIso)
      : (sub.last_charge_at ?? sub.created_at ?? nowIso);
    const trialAnchor = new Date(trialAnchorRaw);
    const trialDeadline = new Date(trialAnchor);
    trialDeadline.setDate(trialDeadline.getDate() + Math.max(0, trialDays));
    const withinTrial = now.getTime() <= trialDeadline.getTime();

    if (withinTrial && latestPayment?.status === "paid") {
      const { data: secrets } = await admin
        .from("studio_payment_secrets")
        .select("hitpay_api_key")
        .eq("studio_id", sub.studio_id)
        .maybeSingle();
      const apiKey = secrets?.hitpay_api_key ?? null;
      if (!apiKey) return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
      const gatewayPaymentId = latestPayment.gateway_refund_payment_id ?? latestPayment.gateway_payment_id ?? null;
      if (!gatewayPaymentId) return NextResponse.json({ error: "gateway_payment_id_missing" }, { status: 409 });

      try {
        await refundHitpayPayment({
          apiKey,
          paymentId: gatewayPaymentId,
          amount: Number(latestPayment.paid_amount ?? latestPayment.amount ?? 0),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "hitpay_refund_failed";
        return NextResponse.json({ error: message }, { status: 409 });
      }

      const { data: refundResult, error: refundErr } = await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: latestPayment.id,
        p_operator_id: user.id,
        p_reason: "cancelled_within_membership_trial",
      });
      if (refundErr) return NextResponse.json({ error: refundErr.message }, { status: 500 });
      const rr = refundResult as { ok?: boolean; error?: string };
      if (!rr?.ok) return NextResponse.json({ error: rr?.error ?? "refund_failed" }, { status: 409 });
    }

    if (withinTrial) {
      const { error } = await admin
        .from("customer_subscriptions")
        .update({
          status: "canceled",
          canceled_at: nowIso,
          cancel_at_period_end: false,
          cancel_requested_at: nowIso,
          updated_at: nowIso,
          cancel_reason: latestPayment?.status === "paid" ? "cancelled_by_member_trial_refund" : "cancelled_by_member_trial",
        })
        .eq("id", sub.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, mode: latestPayment?.status === "paid" ? "trial_refunded" : "trial" });
    }
    // Trial window has passed — fall through to normal period-end cancellation.
  }

  // Already billed (or trial window passed): cancel renewals, keep access until period end.
  const interval = (sub as { billing_interval_snapshot?: string | null }).billing_interval_snapshot === "yearly" ? "yearly" : "monthly";
  const derivePeriodEnd = () => {
    const existing = (sub as { current_period_end?: string | null }).current_period_end ?? null;
    if (existing) return existing;
    const anchor = (sub as { last_charge_at?: string | null }).last_charge_at ?? (sub as { created_at?: string | null }).created_at ?? nowIso;
    const next = new Date(anchor);
    if (Number.isNaN(next.getTime())) return null;
    if (interval === "yearly") next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
    return next.toISOString();
  };
  const finalPeriodEnd = derivePeriodEnd();

  const { error } = await admin
    .from("customer_subscriptions")
    .update({
      // Do not flip to canceled immediately; keep status and mark ending.
      cancel_at_period_end: true,
      cancel_requested_at: nowIso,
      current_period_end: finalPeriodEnd,
      updated_at: nowIso,
      cancel_reason: "cancelled_by_member",
    })
    .eq("id", sub.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, mode: "period_end", current_period_end: finalPeriodEnd });
}
