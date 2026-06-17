import { NextResponse } from "next/server";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import { z } from "zod";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { createHitpayRecurringBilling, generatePaymentReference } from "@/lib/hitpay";
import { upsertMemberStudioMembership, verifyMemberStudioAccess } from "@/lib/member-studio";
import { findClientIdByEmail, resolveClientIdByEmail } from "@/lib/resolveClientId";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { normalizeStudioSlug } from "@/lib/slug";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import {
  attachRecurringBillingToSubscription,
  createScheduledSubscriptionRecord,
  getMembershipStartDateInSingapore,
} from "@/lib/subscriptionTransitions";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  membership_id: z.string().uuid(),
  slug: z.string().optional(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const guestName = parsed.data.guest_name?.trim();
  const guestEmail = parsed.data.guest_email?.trim().toLowerCase();
  const guestPhone = parsed.data.guest_phone?.trim() || null;
  if (!user && (!guestName || !guestEmail || !guestPhone)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  await sweepExpiredPendingPayments(admin);
  const [{ data: membership, error: membershipErr }, { data: account }, { data: profile }] = await Promise.all([
    admin
      .from("membership_products")
      .select("id, studio_id, location_id, name, description, price, billing_interval, trial_days, is_active, deleted_at, share_slug")
      .eq("id", parsed.data.membership_id)
      .maybeSingle(),
    user ? admin.from("users").select("id, email").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    user ? admin.from("user_profiles").select("full_name, phone").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (membershipErr || !membership) {
    return NextResponse.json({ error: "membership_not_found" }, { status: 404 });
  }
  if (membership.is_active === false || (membership as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: "membership_not_available" }, { status: 409 });
  }
  const blocked = await respondIfStudioContractSuspended(admin, membership.studio_id);
  if (blocked) return blocked;

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
  if (!studio) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }
  const configIssue = getHitpayConfigIssue({
    hitpayEnabled: studio.hitpay_enabled,
    merchantApiKey: studioSecrets?.hitpay_api_key,
  });
  if (configIssue) {
    return NextResponse.json(
      { error: configIssue.error, error_detail: configIssue.error_detail },
      { status: configIssue.status },
    );
  }
  const merchantApiKey = studioSecrets?.hitpay_api_key ?? "";

  const studioSlug = normalizeStudioSlug(studio.public_slug ?? "");
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && studioSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const customerEmail = String(guestEmail ?? account?.email ?? user?.email ?? "").trim().toLowerCase();
  const customerName =
    String(guestName ?? profile?.full_name ?? "").trim() || customerEmail.split("@")[0] || "Member";
  const customerPhone = guestPhone ?? profile?.phone?.trim() ?? null;
  if (!customerEmail) return NextResponse.json({ error: "email_required" }, { status: 409 });
  const existingClientId = user?.id ?? (await findClientIdByEmail(admin, customerEmail));

  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: existingClientId ?? user.id,
      studioId: membership.studio_id,
      bootstrapIfMissing: true,
      declaredStudioSlug: inputSlug,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }

  /** Block if user already has any active or pending subscription at this studio (not just the same plan). */
  const { data: existingAnySub } = await admin
    .from("customer_subscriptions")
    .select("id, status, cancel_at_period_end, current_period_end, membership_product_id")
    .eq("client_id", existingClientId ?? "__missing__")
    .eq("studio_id", membership.studio_id)
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
    .limit(1)
    .maybeSingle();
  const existingAnyStatus = String(existingAnySub?.status ?? "").toLowerCase();
  const hasPendingOrActiveSubscription =
    existingAnySub?.id != null &&
    (existingAnyStatus === "scheduled" || isMembershipActiveForAccess(existingAnySub));
  if (hasPendingOrActiveSubscription) {
    const isSamePlan = existingAnySub?.membership_product_id === membership.id;
    return NextResponse.json(
      { error: "subscription_exists", same_plan: isSamePlan },
      { status: 409 },
    );
  }
  const clientId =
    existingClientId ??
    (await resolveClientIdByEmail(admin, {
      email: customerEmail,
      name: customerName,
      phone: customerPhone,
    }));
  if (!user) {
    await upsertMemberStudioMembership(admin, {
      userId: clientId,
      studioId: membership.studio_id,
    });
  }

  const reference = generatePaymentReference();
  const trialDays = Number((membership as { trial_days?: number | null }).trial_days ?? 0);
  const startDate = getMembershipStartDateInSingapore(trialDays);
  const { data: localSubscription, error: insertErr } = await createScheduledSubscriptionRecord(admin, {
    studioId: membership.studio_id,
    clientId,
    membershipProductId: membership.id,
    referenceCode: reference,
    customerName,
    customerEmail,
    membershipName: membership.name,
    membershipPrice: membership.price,
    billingInterval: membership.billing_interval,
    billingStartDate: startDate,
  });
  if (insertErr || !localSubscription) {
    return NextResponse.json({ error: insertErr?.message ?? "subscription_create_failed" }, { status: 500 });
  }

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) {
    await admin.from("customer_subscriptions").delete().eq("id", localSubscription.id);
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }

  const membershipSlug = (membership as { share_slug?: string | null }).share_slug ?? "";
  const redirectUrl = `${baseUrl}/${studioSlug}/memberships/${membershipSlug}?membership_checkout=1&subscription_id=${encodeURIComponent(localSubscription.id)}`;

  try {
    const hitpay = await createHitpayRecurringBilling({
      apiKey: merchantApiKey,
      customerEmail,
      customerName,
      startDate,
      name: membership.name,
      amount: Number(membership.price ?? 0),
      currency: STUDIO_CURRENCY,
      cycle: membership.billing_interval === "yearly" ? "yearly" : "monthly",
      redirectUrl,
      reference,
    });

    await attachRecurringBillingToSubscription(admin, {
      subscriptionId: localSubscription.id,
      recurringBillingId: hitpay.recurringBillingId,
      checkoutUrl: hitpay.checkoutUrl,
      status: hitpay.status,
    });

    return NextResponse.json({
      subscription_id: localSubscription.id,
      checkout_url: hitpay.checkoutUrl,
      recurring_billing_id: hitpay.recurringBillingId,
    });
  } catch (e) {
    await admin.from("customer_subscriptions").delete().eq("id", localSubscription.id);
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_recurring_create_failed");
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
