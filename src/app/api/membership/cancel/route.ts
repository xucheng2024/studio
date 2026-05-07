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
    .select("id, client_id, studio_id, recurring_billing_id, status, billing_start_date, last_charge_at")
    .eq("id", parsed.data.subscription_id)
    .maybeSingle();
  if (!sub) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (sub.client_id !== user.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const billingStartDate = (sub as { billing_start_date?: string | null }).billing_start_date ?? null;
  const lastChargeAt = (sub as { last_charge_at?: string | null }).last_charge_at ?? null;
  const isTrial = Boolean(billingStartDate && !lastChargeAt);
  if (!isTrial) return NextResponse.json({ error: "cancel_not_allowed" }, { status: 409 });

  const now = new Date();
  const scheduledStart = billingStartDate ? new Date(`${billingStartDate}T00:00:00+08:00`) : null;
  if (!scheduledStart || now.getTime() >= scheduledStart.getTime()) {
    // If we've reached or passed the first-charge date, treat as non-trial for self-service cancellation.
    return NextResponse.json({ error: "cancel_not_allowed" }, { status: 409 });
  }

  if (sub.recurring_billing_id) {
    const { data: secrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", sub.studio_id)
      .maybeSingle();
    const apiKey = secrets?.hitpay_api_key ?? null;
    if (!apiKey) return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
    await cancelHitpayRecurringBilling({
      apiKey,
      recurringBillingId: sub.recurring_billing_id,
    });
  }

  const nowIso = now.toISOString();
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

  return NextResponse.json({ ok: true });
}

