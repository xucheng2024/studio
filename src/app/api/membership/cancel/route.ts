import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelMembershipSubscription } from "@/lib/subscriptionTransitions";
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
  const result = await cancelMembershipSubscription(admin, {
    subscription: sub,
    actorId: user.id,
    actorKind: "member",
    trialDays,
    allowRemoteCancelFallback: true,
  });
  if (!result.ok) {
    return NextResponse.json(
      result.error_detail ? { error: result.error, error_detail: result.error_detail } : { error: result.error },
      { status: result.status },
    );
  }
  return NextResponse.json({
    ok: true,
    mode: result.mode,
    current_period_end: "current_period_end" in result ? result.current_period_end ?? null : null,
  });
}
