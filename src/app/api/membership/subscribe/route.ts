import { NextResponse } from "next/server";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import { z } from "zod";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { createHitpayRecurringBilling, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  membership_id: z.string().uuid(),
  slug: z.string().optional(),
});

function todayInSingapore() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

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
  const [{ data: membership, error: membershipErr }, { data: account }, { data: profile }] = await Promise.all([
    admin
      .from("membership_products")
      .select("id, studio_id, location_id, name, description, price, currency, billing_interval, trial_days, is_active, deleted_at, share_slug")
      .eq("id", parsed.data.membership_id)
      .maybeSingle(),
    admin.from("users").select("id, email").eq("id", user.id).maybeSingle(),
    admin.from("user_profiles").select("full_name, phone").eq("id", user.id).maybeSingle(),
  ]);

  if (membershipErr || !membership) {
    return NextResponse.json({ error: "membership_not_found" }, { status: 404 });
  }
  if (membership.is_active === false || (membership as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: "membership_not_available" }, { status: 409 });
  }
  const blocked = await respondIfStudioContractSuspended(admin, membership.studio_id);
  if (blocked) return blocked;

  const studioAccess = await verifyMemberStudioAccess(admin, {
    userId: user.id,
    studioId: membership.studio_id,
    bootstrapIfMissing: true,
  });
  if (!studioAccess.ok) {
    return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
  }

  const { data: studio } = await admin
    .from("studios")
    .select("public_slug, hitpay_enabled")
    .eq("id", membership.studio_id)
    .maybeSingle();
  const { data: studioSecrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", membership.studio_id)
    .maybeSingle();
  if (!studio?.hitpay_enabled || !studioSecrets?.hitpay_api_key) {
    return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
  }

  const studioSlug = normalizeStudioSlug(studio.public_slug ?? "");
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && studioSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const customerEmail = String(account?.email ?? user.email ?? "").trim().toLowerCase();
  const customerName = String(profile?.full_name ?? "").trim() || customerEmail.split("@")[0] || "Member";
  if (!customerEmail) return NextResponse.json({ error: "email_required" }, { status: 409 });

  const { data: existing } = await admin
    .from("customer_subscriptions")
    .select("id, status, cancel_at_period_end, current_period_end")
    .eq("client_id", user.id)
    .eq("membership_product_id", membership.id)
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
    .maybeSingle();
  if (existing?.id && isMembershipActiveForAccess(existing)) {
    return NextResponse.json({ error: "subscription_exists" }, { status: 409 });
  }

  const reference = generatePaymentReference();
  const trialDays = Number((membership as { trial_days?: number | null }).trial_days ?? 0);
  const startDate = todayInSingapore();
  const { data: localSubscription, error: insertErr } = await admin
    .from("customer_subscriptions")
    .insert({
      studio_id: membership.studio_id,
      client_id: user.id,
      membership_product_id: membership.id,
      reference_code: reference,
      status: "scheduled",
      customer_name_snapshot: customerName,
      customer_email_snapshot: customerEmail,
      membership_name_snapshot: membership.name,
      membership_price_snapshot: membership.price,
      billing_interval_snapshot: membership.billing_interval,
      cancel_at_period_end: false,
      billing_start_date: startDate,
    })
    .select("id")
    .single();
  if (insertErr || !localSubscription) {
    return NextResponse.json({ error: insertErr?.message ?? "subscription_create_failed" }, { status: 500 });
  }

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) {
    await admin.from("customer_subscriptions").delete().eq("id", localSubscription.id);
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }

  const membershipSlug = (membership as { share_slug?: string | null }).share_slug ?? "";
  const redirectUrl = `${baseUrl}/membership/${studioSlug}/${membershipSlug}`;

  try {
    const hitpay = await createHitpayRecurringBilling({
      apiKey: studioSecrets.hitpay_api_key,
      customerEmail,
      customerName,
      startDate,
      name: membership.name,
      amount: Number(membership.price ?? 0),
      currency: String(membership.currency ?? "SGD"),
      cycle: membership.billing_interval === "yearly" ? "yearly" : "monthly",
      redirectUrl,
      reference,
      paymentMethods: ["card"],
    });

    await admin
      .from("customer_subscriptions")
      .update({
        recurring_billing_id: hitpay.recurringBillingId,
        checkout_url: hitpay.checkoutUrl,
        status: hitpay.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", localSubscription.id);

    return NextResponse.json({
      subscription_id: localSubscription.id,
      checkout_url: hitpay.checkoutUrl,
      recurring_billing_id: hitpay.recurringBillingId,
    });
  } catch (e) {
    await admin.from("customer_subscriptions").delete().eq("id", localSubscription.id);
    const message = e instanceof Error ? e.message : "hitpay_recurring_create_failed";
    const status = message === "hitpay_not_configured" ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
