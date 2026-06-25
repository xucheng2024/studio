import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudioUrlFromRequest } from "@/lib/app-url";
import {
  createHitpayPaymentRequest,
  generatePaymentReference,
} from "@/lib/hitpay";
import { isMembershipActiveForAccess } from "@/lib/membership-subscription";
import {
  hasValidMemberZonePurchasePrice,
  isPurchaseEnabledAccessType,
  resolveMemberZoneAccessRule,
} from "@/lib/memberZoneAccess";
import {
  findClientIdByEmail,
  resolveClientIdByEmail,
} from "@/lib/resolveClientId";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { syncMemberZonePurchasePaymentStatus } from "@/lib/paymentStatusTransitions";
import { finalizeZeroAmountPayment } from "@/lib/finalizeZeroAmountPayment";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { normalizeStudioSlug } from "@/lib/slug";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  slug: z.string().optional(),
  series_id: z.string().uuid(),
  lesson_id: z.string().uuid().optional().nullable(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
  is_gift: z.boolean().optional(),
  gift_recipient_name: z.string().max(120).optional(),
  gift_recipient_email: z.string().email().max(320).optional(),
  gift_message: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });

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
  const { data: series } = await admin
    .from("member_zone_series")
    .select(
      "id, studio_id, title, is_active, share_slug, access_type, price, studios(public_slug, contract_status, hitpay_enabled)",
    )
    .eq("id", parsed.data.series_id)
    .maybeSingle();
  if (!series || !series.is_active) {
    return NextResponse.json({ error: "series_not_found" }, { status: 404 });
  }

  const lessonId = parsed.data.lesson_id ?? null;
  const lesson = lessonId
    ? await admin
        .from("member_zone_lessons")
        .select(
          "id, title, is_active, access_override, override_price, media_url",
        )
        .eq("id", lessonId)
        .eq("series_id", series.id)
        .maybeSingle()
    : { data: null };
  if (lessonId && (!lesson.data || !lesson.data.is_active)) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  const studioRaw = series.studios as
    | { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null }
    | { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null }[]
    | null;
  const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  if (!studio?.public_slug || studio.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_unavailable" }, { status: 409 });
  }
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  const studioSlug = normalizeStudioSlug(studio.public_slug ?? "");
  if (inputSlug && studioSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const blocked = await respondIfStudioContractSuspended(admin, series.studio_id);
  if (blocked) return blocked;

  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId: series.studio_id,
      bootstrapIfMissing: true,
      declaredStudioSlug: inputSlug,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }

  const accessRule = resolveMemberZoneAccessRule({
    seriesAccessType: series.access_type,
    seriesPrice: Number(series.price ?? 0),
    lessonAccessOverride: lesson.data?.access_override ?? "inherit",
    lessonOverridePrice: Number(lesson.data?.override_price ?? 0),
  });
  if (
    !isPurchaseEnabledAccessType(accessRule.resolvedAccessType) ||
    !hasValidMemberZonePurchasePrice(accessRule.resolvedAccessType, accessRule.resolvedPrice)
  ) {
    return NextResponse.json({ error: "item_not_paywalled" }, { status: 409 });
  }

  const customerEmail = guestEmail ?? user?.email?.trim().toLowerCase() ?? "";
  const customerName = guestName ?? null;
  const existingClientId =
    user?.id ??
    (await findClientIdByEmail(admin, customerEmail));

  const { data: membershipRows } = await admin
    .from("customer_subscriptions")
    .select("id, status, cancel_at_period_end, current_period_end")
    .eq("studio_id", series.studio_id)
    .eq("client_id", existingClientId ?? "__missing__")
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
    .limit(10);
  const hasMembershipAccess = (membershipRows ?? []).some((row) => isMembershipActiveForAccess(row));
  // Membership/duplicate checks apply to the buyer. For gift purchases the item goes to
  // the recipient, so the buyer's own access status is irrelevant — skip both guards.
  if (!isGift) {
    // Membership should only block purchase when membership is a valid unlock path.
    // For paid_only content, members still need to purchase.
    const membershipCanUnlock = accessRule.resolvedAccessType === "member_or_paid";
    if (membershipCanUnlock && hasMembershipAccess) {
      return NextResponse.json({ error: "already_member" }, { status: 409 });
    }

    const duplicateQuery = admin
      .from("member_zone_purchases")
      .select("id, status")
      .eq("studio_id", series.studio_id)
      .eq("client_id", existingClientId ?? "__missing__");
    const { data: dupRows } =
      accessRule.purchaseScope === "lesson" && lessonId
        ? await duplicateQuery.eq("lesson_id", lessonId).limit(10)
        : await duplicateQuery.eq("series_id", series.id).is("lesson_id", null).limit(10);
    if ((dupRows ?? []).some((row) => row.status === "paid")) {
      return NextResponse.json({ error: "already_purchased" }, { status: 409 });
    }
    if ((dupRows ?? []).some((row) => row.status === "pending")) {
      const existingPendingQuery = admin
        .from("payments")
        .select("gateway_checkout_url, status, expires_at")
        .eq("studio_id", series.studio_id)
        .eq("client_id", existingClientId ?? "__missing__")
        .eq("source", "member_zone_purchase")
        .eq("status", "pending");
      const { data: pendingPayments } =
        accessRule.purchaseScope === "lesson" && lessonId
          ? await existingPendingQuery.eq("member_zone_lesson_id", lessonId).limit(10)
          : await existingPendingQuery.eq("member_zone_series_id", series.id).is("member_zone_lesson_id", null).limit(10);
      const reusablePending = (pendingPayments ?? []).find((row) => {
        if (!row.gateway_checkout_url) return false;
        if (!row.expires_at) return true;
        return new Date(row.expires_at).getTime() > Date.now();
      });
      if (reusablePending?.gateway_checkout_url) {
        return NextResponse.json({
          ok: true,
          already_pending: true,
          checkout_url: reusablePending.gateway_checkout_url,
        });
      }
      // No reusable pending payment found. The member_zone_purchases row is stale
      // (its payment has expired/failed but expire_pending_payments didn't clean it up).
      // Expire the stale purchase records so the user can retry.
      const expireStaleQuery = admin
        .from("member_zone_purchases")
        .update({ status: "expired" })
        .eq("studio_id", series.studio_id)
        .eq("client_id", existingClientId ?? "__missing__")
        .eq("status", "pending");
      if (accessRule.purchaseScope === "lesson" && lessonId) {
        await expireStaleQuery.eq("lesson_id", lessonId);
      } else {
        await expireStaleQuery.eq("series_id", series.id).is("lesson_id", null);
      }
      // Fall through to create a new purchase below.
    }
  }

  // For gifts, prevent buying content for a recipient who already has access.
  if (isGift && giftRecipientEmail) {
    // Block duplicate gifts for the same recipient email even when the recipient
    // account does not exist yet (so we can't resolve client_id).
    const recipientGiftPaymentsQuery = admin
      .from("payments")
      .select("id")
      .eq("studio_id", series.studio_id)
      .eq("source", "member_zone_purchase")
      .eq("is_gift", true)
      .eq("gift_recipient_email", giftRecipientEmail)
      .in("status", ["pending", "paid"]);
    const { data: recipientGiftPayments } =
      accessRule.purchaseScope === "lesson" && lessonId
        ? await recipientGiftPaymentsQuery.eq("member_zone_lesson_id", lessonId).limit(5)
        : await recipientGiftPaymentsQuery.eq("member_zone_series_id", series.id).is("member_zone_lesson_id", null).limit(5);
    if ((recipientGiftPayments ?? []).length > 0) {
      return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
    }

    const recipientId = await findClientIdByEmail(admin, giftRecipientEmail);
    if (recipientId) {
      // Check existing purchase record for the same content.
      const recipientDupQuery = admin
        .from("member_zone_purchases")
        .select("id, status")
        .eq("studio_id", series.studio_id)
        .eq("client_id", recipientId);
      const { data: recipientDups } =
        accessRule.purchaseScope === "lesson" && lessonId
          ? await recipientDupQuery.eq("lesson_id", lessonId).limit(5)
          : await recipientDupQuery.eq("series_id", series.id).is("lesson_id", null).limit(5);
      if ((recipientDups ?? []).some((r) => r.status === "paid" || r.status === "pending")) {
        return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
      }

      // For member_or_paid content, also block if recipient already has an active membership
      // (membership grants free access — paying for a gift on top is wasteful/incorrect).
      if (accessRule.resolvedAccessType === "member_or_paid") {
        const { data: recipientMemberships } = await admin
          .from("customer_subscriptions")
          .select("id, status, cancel_at_period_end, current_period_end")
          .eq("studio_id", series.studio_id)
          .eq("client_id", recipientId)
          .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
          .limit(10);
        if ((recipientMemberships ?? []).some((row) => isMembershipActiveForAccess(row))) {
          return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
        }
      }
    }
  }

  const effectiveClientId =
    existingClientId ??
    (await resolveClientIdByEmail(admin, {
      email: customerEmail,
      name: customerName,
      phone: guestPhone,
    }));

  const reference = generatePaymentReference();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const amount = Number(accessRule.resolvedPrice.toFixed(2));
  const isZeroAmount = amount === 0;
  let merchantApiKey = "";
  if (!isZeroAmount) {
    const { data: studioSecrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", series.studio_id)
      .maybeSingle();
    const configIssue = getHitpayConfigIssue({
      hitpayEnabled: studio?.hitpay_enabled,
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
  const currency = accessRule.resolvedCurrency;
  const sourceTitle =
    accessRule.purchaseScope === "lesson" ? lesson.data?.title ?? series.title : series.title;

  const { data: payment } = await admin
    .from("payments")
    .insert({
      studio_id: series.studio_id,
      client_id: effectiveClientId,
      booking_id: null,
      event_booking_id: null,
      package_id: null,
      membership_product_id: null,
      member_zone_series_id: series.id,
      member_zone_lesson_id: lessonId,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      is_gift: isGift,
      gift_recipient_name: isGift ? giftRecipientName : null,
      gift_recipient_email: isGift ? giftRecipientEmail : null,
      gift_message: isGift ? giftMessage : null,
      amount,
      currency,
      payment_method: isZeroAmount ? "free" : "hitpay",
      source: "member_zone_purchase",
      status: "pending",
      reference_code: reference,
      expires_at: expiresAt,
      type: "single",
      remaining_uses: 0,
    })
    .select("id")
    .single();
  if (!payment?.id) {
    return NextResponse.json({ error: "payment_create_failed" }, { status: 500 });
  }

  const { error: purchaseInsertErr } = await admin.from("member_zone_purchases").insert({
    studio_id: series.studio_id,
    client_id: effectiveClientId,
    series_id: series.id,
    lesson_id: lessonId,
    payment_id: payment.id,
    purchase_scope: accessRule.purchaseScope,
    amount,
    currency,
    status: "pending",
  });
  if (purchaseInsertErr) {
    await admin.from("payments").delete().eq("id", payment.id);
    if (purchaseInsertErr.code === "23505") {
      const duplicateQuery = admin
        .from("member_zone_purchases")
        .select("id, status")
        .eq("studio_id", series.studio_id)
        .eq("client_id", effectiveClientId);
      const { data: duplicateRows } =
        accessRule.purchaseScope === "lesson" && lessonId
          ? await duplicateQuery.eq("lesson_id", lessonId).limit(10)
          : await duplicateQuery.eq("series_id", series.id).is("lesson_id", null).limit(10);
      if ((duplicateRows ?? []).some((row) => row.status === "paid")) {
        return NextResponse.json({ error: "already_purchased" }, { status: 409 });
      }

      const pendingPaymentsQuery = admin
        .from("payments")
        .select("gateway_checkout_url, expires_at")
        .eq("studio_id", series.studio_id)
        .eq("client_id", effectiveClientId)
        .eq("source", "member_zone_purchase")
        .eq("status", "pending");
      const { data: pendingPayments } =
        accessRule.purchaseScope === "lesson" && lessonId
          ? await pendingPaymentsQuery.eq("member_zone_lesson_id", lessonId).limit(10)
          : await pendingPaymentsQuery.eq("member_zone_series_id", series.id).is("member_zone_lesson_id", null).limit(10);
      const reusablePending = (pendingPayments ?? []).find((row) => {
        if (!row.gateway_checkout_url) return false;
        if (!row.expires_at) return true;
        return new Date(row.expires_at).getTime() > Date.now();
      });
      if (reusablePending?.gateway_checkout_url) {
        return NextResponse.json(
          {
            error: "purchase_pending",
            checkout_url: reusablePending.gateway_checkout_url,
          },
          { status: 409 },
        );
      }
      if ((duplicateRows ?? []).some((row) => row.status === "pending")) {
        return NextResponse.json({ error: "purchase_pending" }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "purchase_create_failed" }, { status: 500 });
  }

  const redirectUrl = getStudioUrlFromRequest(req, studio.public_slug, `checkout/${payment.id}`);
  if (!redirectUrl) {
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    await syncMemberZonePurchasePaymentStatus(admin, payment.id, "failed");
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }
  if (isZeroAmount) {
    try {
      await finalizeZeroAmountPayment(admin, {
        id: payment.id,
        studio_id: series.studio_id,
        booking_id: null,
        event_booking_id: null,
      });
      return NextResponse.json({ ok: true, checkout_url: redirectUrl });
    } catch {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      await syncMemberZonePurchasePaymentStatus(admin, payment.id, "failed");
      return NextResponse.json({ error: "free_payment_finalize_failed" }, { status: 500 });
    }
  }

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: merchantApiKey,
      amount: amount.toFixed(2),
      currency,
      email: guestEmail ?? user?.email ?? null,
      // Keep member-zone aligned with package/session payload shape for logged-in users.
      name: guestName ?? null,
      reference_number: reference,
      redirect_url: redirectUrl,
      purpose: `Member zone purchase: ${sourceTitle}`,
    });
    await admin
      .from("payments")
      .update({
        gateway_payment_id: hitpay.providerPaymentId,
        gateway_checkout_url: hitpay.checkoutUrl,
        gateway_status: hitpay.providerStatus,
      })
      .eq("id", payment.id);
    return NextResponse.json({ ok: true, checkout_url: hitpay.checkoutUrl });
  } catch (e) {
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    await syncMemberZonePurchasePaymentStatus(admin, payment.id, "failed");
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
