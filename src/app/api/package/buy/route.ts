import { NextResponse } from "next/server";
import { z } from "zod";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { getStudioUrlFromRequest } from "@/lib/app-url";
import { getLatestSalonTermsVersion } from "@/lib/salon-appointments-self";
import { normalizeStudioSlug } from "@/lib/slug";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { cancelPendingPaymentLifecycle } from "@/lib/paymentStatusTransitions";
import { finalizeZeroAmountPayment } from "@/lib/finalizeZeroAmountPayment";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  package_id: z.string().uuid(),
  slug: z.string().optional(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
  is_gift: z.boolean().optional(),
  gift_recipient_name: z.string().max(120).optional(),
  gift_recipient_email: z.string().email().max(320).optional(),
  gift_message: z.string().max(500).optional(),
  terms_accepted: z.boolean().optional(),
  terms_version_id: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const guestName = parsed.data.guest_name?.trim();
  const guestEmail = parsed.data.guest_email?.trim().toLowerCase();
  const guestPhone = parsed.data.guest_phone?.trim() || null;
  const isGift = parsed.data.is_gift === true;
  const giftRecipientName = parsed.data.gift_recipient_name?.trim() || null;
  const giftRecipientEmail = parsed.data.gift_recipient_email?.trim().toLowerCase() || null;
  const giftMessage = parsed.data.gift_message?.trim() || null;
  if (!user && (!guestName || !guestEmail || !guestPhone)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }
  if (isGift) {
    if (!giftRecipientEmail) {
      return NextResponse.json({ error: "gift_recipient_email_required" }, { status: 400 });
    }
    const buyerEmail = (guestEmail ?? user?.email ?? "").trim().toLowerCase();
    if (giftRecipientEmail === buyerEmail) {
      return NextResponse.json({ error: "gift_self_not_allowed" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  await sweepExpiredPendingPayments(admin);

  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select("id, studio_id, location_id, name, credits, price, expiry_days, is_active, deleted_at, studios(public_slug)")
    .eq("id", parsed.data.package_id)
    .single();

  if (pkgErr || !pkg) {
    return NextResponse.json({ error: "package_not_found" }, { status: 404 });
  }
  if (pkg.is_active === false || (pkg as { deleted_at?: string | null }).deleted_at) {
    return NextResponse.json({ error: "package_not_available" }, { status: 409 });
  }
  const studioRaw = (pkg as { studios?: { public_slug?: string | null } | { public_slug?: string | null }[] | null }).studios;
  const studioObj = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const studioSlug = normalizeStudioSlug(studioObj?.public_slug ?? "");
  if (!studioSlug) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const blockedPkg = await respondIfStudioContractSuspended(admin, pkg.studio_id);
  if (blockedPkg) return blockedPkg;

  const latestTerms = await getLatestSalonTermsVersion({ studioId: pkg.studio_id });
  if (latestTerms?.id) {
    if (!parsed.data.terms_accepted || !parsed.data.terms_version_id) {
      return NextResponse.json({ error: "terms_required" }, { status: 400 });
    }
    if (parsed.data.terms_version_id !== latestTerms.id) {
      return NextResponse.json({ error: "terms_version_stale" }, { status: 409 });
    }
  }
  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId: pkg.studio_id,
      bootstrapIfMissing: true,
      declaredStudioSlug: inputSlug,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }
  const amount = Number(pkg.price ?? 0);
  if (amount < 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 409 });
  }
  const isZeroAmount = amount === 0;
  let merchantApiKey = "";
  if (!isZeroAmount) {
    const { data: studioHitpay } = await admin
      .from("studios")
      .select("hitpay_enabled")
      .eq("id", pkg.studio_id)
      .maybeSingle();
    const { data: studioSecrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", pkg.studio_id)
      .maybeSingle();
    const configIssue = getHitpayConfigIssue({
      hitpayEnabled: studioHitpay?.hitpay_enabled,
      merchantApiKey: studioSecrets?.hitpay_api_key,
    });
    if (configIssue) {
      return NextResponse.json(
        { error: configIssue.error, error_detail: configIssue.error_detail },
        { status: configIssue.status },
      );
    }
    merchantApiKey = studioSecrets?.hitpay_api_key ?? "";
  }

  const reference = generatePaymentReference();
  // Keep package checkout short to avoid long stale pending holds.
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      package_id: pkg.id,
      package_name_snapshot: pkg.name,
      studio_id: pkg.studio_id,
      location_id: pkg.location_id ?? null,
      client_id: user?.id ?? null,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      is_gift: isGift,
      gift_recipient_name: isGift ? giftRecipientName : null,
      gift_recipient_email: isGift ? giftRecipientEmail : null,
      gift_message: isGift ? giftMessage : null,
      amount,
      currency: STUDIO_CURRENCY,
      payment_method: isZeroAmount ? "free" : "hitpay",
      sales_channel: "online",
      source: "package_buy",
      reference_code: reference,
      expires_at: expiresAt,
      type: "package",
      status: "pending",
      remaining_uses: 0,
    })
    .select("id, amount")
    .single();

  if (pErr || !payment) {
    console.error("[package-buy] payment creation failed", {
      packageId: pkg.id,
      studioId: pkg.studio_id,
      error: pErr?.message ?? "payment_create_failed",
    });
    return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  const returnUrl = getStudioUrlFromRequest(req, studioSlug, `checkout/${payment.id}`);
  if (!returnUrl) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }
  if (isZeroAmount) {
    try {
      await finalizeZeroAmountPayment(admin, {
        id: payment.id,
        studio_id: pkg.studio_id,
        booking_id: null,
        event_booking_id: null,
      });
      return NextResponse.json({
        payment_id: payment.id,
        amount: payment.amount,
        reference_code: reference,
        checkout_url: returnUrl,
      });
    } catch {
      await cancelPendingPaymentLifecycle(admin, payment, "failed");
      return NextResponse.json({ error: "free_payment_finalize_failed" }, { status: 500 });
    }
  }
  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: merchantApiKey,
      amount: Number(pkg.price).toFixed(2),
      currency: STUDIO_CURRENCY,
      email: guestEmail ?? user?.email ?? null,
      name: guestName ?? null,
      reference_number: reference,
      redirect_url: returnUrl,
      purpose: `Package ${pkg.name}`,
    });
    await admin
      .from("payments")
      .update({
        gateway_payment_id: hitpay.providerPaymentId,
        gateway_checkout_url: hitpay.checkoutUrl,
        gateway_status: hitpay.providerStatus,
      })
      .eq("id", payment.id);

    return NextResponse.json({
      payment_id: payment.id,
      amount: payment.amount,
      reference_code: reference,
      expires_at: expiresAt,
      checkout_url: hitpay.checkoutUrl,
    });
  } catch (e) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    console.error("[package-buy] HitPay payment creation failed", {
      packageId: pkg.id,
      studioId: pkg.studio_id,
      error: normalized.error,
      status: normalized.status,
    });
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
