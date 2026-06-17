import { NextResponse } from "next/server";
import { revalidateDashboardMembershipViews } from "@/lib/revalidatePublic";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { cancelMembershipSubscription } from "@/lib/subscriptionTransitions";
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
    .select("id, studio_id, recurring_billing_id, status, membership_product_id, membership_name_snapshot, billing_interval_snapshot, created_at, last_charge_at, current_period_end, billing_start_date, cancel_at_period_end, membership_products(location_id, trial_days)")
    .eq("id", id)
    .maybeSingle();
  if (!subscription) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const membershipProduct = Array.isArray(subscription.membership_products)
    ? subscription.membership_products[0]
    : subscription.membership_products;
  const trialDays = Number(membershipProduct?.trial_days ?? 0);

  const scope = await requireStaffScope({
    userId: user.id,
    studioId: subscription.studio_id,
    locationId: membershipProduct?.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scope.ok) return staffScopeFailureResponse(scope);

  const result = await cancelMembershipSubscription(admin, {
    subscription,
    actorId: user.id,
    actorKind: "staff",
    trialDays,
  });
  if (!result.ok) {
    return NextResponse.json(
      result.error_detail ? { error: result.error, error_detail: result.error_detail } : { error: result.error },
      { status: result.status },
    );
  }

  revalidateDashboardMembershipViews();
  return NextResponse.json({
    ok: true,
    mode: result.mode,
    current_period_end: "current_period_end" in result ? result.current_period_end ?? null : null,
  });
}
