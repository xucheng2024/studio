import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelHitpayRecurringBilling } from "@/lib/hitpay";
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
    .select("id, client_id, studio_id, recurring_billing_id, status, billing_start_date, last_charge_at, created_at, current_period_end, billing_interval_snapshot")
    .eq("id", parsed.data.subscription_id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (sub.client_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const billingStartDate = (sub as { billing_start_date?: string | null }).billing_start_date ?? null;
  const lastChargeAt = (sub as { last_charge_at?: string | null }).last_charge_at ?? null;
  const isTrial = Boolean(billingStartDate && !lastChargeAt);

  const now = new Date();
  const nowIso = now.toISOString();
  const scheduledStart = billingStartDate ? new Date(`${billingStartDate}T00:00:00+08:00`) : null;

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
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  // Trial / not yet charged: cancel immediately (no refund needed).
  if (isTrial && scheduledStart && now.getTime() < scheduledStart.getTime()) {
    const { error } = await admin
      .from("customer_subscriptions")
      .update({
        status: "canceled",
        canceled_at: nowIso,
        cancel_at_period_end: false,
        cancel_requested_at: nowIso,
        updated_at: nowIso,
        cancel_reason: "cancelled_by_member_trial",
      })
      .eq("id", sub.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, mode: "trial" });
  }

  // Already billed (or start date reached): cancel subscription renewals, keep access until period end.
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

