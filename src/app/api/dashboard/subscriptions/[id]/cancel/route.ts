import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { cancelHitpayRecurringBilling } from "@/lib/hitpay";
import { isMembershipEnded } from "@/lib/membership-subscription";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: subscription } = await admin
    .from("customer_subscriptions")
    .select("id, studio_id, recurring_billing_id, status, membership_product_id, membership_name_snapshot, billing_interval_snapshot, created_at, last_charge_at, current_period_end, cancel_at_period_end, membership_products(location_id)")
    .eq("id", id)
    .maybeSingle();
  if (!subscription) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const membershipProduct = Array.isArray(subscription.membership_products)
    ? subscription.membership_products[0]
    : subscription.membership_products;

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: subscription.studio_id,
    locationId: membershipProduct?.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const now = new Date();
  const nowIso = now.toISOString();
  const interval = subscription.billing_interval_snapshot === "yearly" ? "yearly" : "monthly";
  const derivePeriodEnd = () => {
    if (subscription.current_period_end) return subscription.current_period_end;
    const anchor = subscription.last_charge_at ?? subscription.created_at ?? nowIso;
    const next = new Date(anchor);
    if (Number.isNaN(next.getTime())) return nowIso;
    if (interval === "yearly") {
      next.setFullYear(next.getFullYear() + 1);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    return next.toISOString();
  };
  const effectivePeriodEnd = derivePeriodEnd();

  if (subscription.recurring_billing_id) {
    const { data: secrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", subscription.studio_id)
      .maybeSingle();
    const apiKey = secrets?.hitpay_api_key ?? null;
    if (!apiKey) return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
    try {
      const result = await cancelHitpayRecurringBilling({
        apiKey,
        recurringBillingId: subscription.recurring_billing_id,
      });
      if (result.expiresAt) {
        // Prefer provider-confirmed paid-through time when available.
        subscription.current_period_end = result.expiresAt;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "hitpay_recurring_cancel_failed";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  const finalPeriodEnd = subscription.current_period_end ?? effectivePeriodEnd;
  const endedImmediately = isMembershipEnded(
    {
      status: subscription.status,
      cancel_at_period_end: true,
      current_period_end: finalPeriodEnd,
    },
    now,
  );
  const { error } = await admin
    .from("customer_subscriptions")
    .update({
      status: endedImmediately ? "canceled" : subscription.status,
      canceled_at: endedImmediately ? nowIso : null,
      cancel_at_period_end: !endedImmediately,
      cancel_requested_at: nowIso,
      current_period_end: finalPeriodEnd,
      updated_at: nowIso,
      cancel_reason: "cancelled_by_studio",
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath("/dashboard/memberships");
  revalidatePath("/me/memberships");
  return NextResponse.json({ ok: true });
}
