import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { cancelHitpayRecurringBilling } from "@/lib/hitpay";
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
    .select("id, studio_id, recurring_billing_id, status, membership_product_id, membership_products(location_id)")
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

  if (subscription.recurring_billing_id) {
    const { data: secrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", subscription.studio_id)
      .maybeSingle();
    const apiKey = secrets?.hitpay_api_key ?? null;
    if (!apiKey) return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
    try {
      await cancelHitpayRecurringBilling({
        apiKey,
        recurringBillingId: subscription.recurring_billing_id,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "hitpay_recurring_cancel_failed";
      return NextResponse.json({ error: message }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("customer_subscriptions")
    .update({
      status: "canceled",
      canceled_at: now,
      updated_at: now,
      cancel_reason: "cancelled_by_studio",
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath("/dashboard/memberships");
  revalidatePath("/me/memberships");
  return NextResponse.json({ ok: true });
}
