import { NextResponse } from "next/server";
import { z } from "zod";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { normalizeStudioSlug } from "@/lib/slug";
import { getStudioUrlFromRequest } from "@/lib/app-url";
import { findClientIdByEmail } from "@/lib/resolveClientId";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import {
  attachHitpayCheckoutToBookingPayment,
  attachPaymentToBookingReservation,
  cancelPendingBookingCheckout,
  createBookingCheckoutPayment,
  createHitpayBookingCheckout,
  createPendingClassBookingReservation,
  finalizeBookingCheckout,
  getTimedBookingCheckoutExpiry,
  rollbackPendingBookingReservation,
} from "@/lib/bookingTransitions";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  slug: z.string().optional(),
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
  const { data: session, error: sErr } = await admin
    .from("class_sessions")
    .select(
      `
      id,
      status,
      start_time,
      spots_left,
      location_id,
      guest_price,
      credits_required,
      classes (
        studio_id,
        studios ( public_slug )
      )
    `,
    )
    .eq("id", parsed.data.session_id)
    .single();

  if (sErr || !session) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if ((session.status ?? "scheduled") !== "scheduled") {
    return NextResponse.json({ error: "session_not_available" }, { status: 409 });
  }
  // Guard: do not allow booking/checkout for past sessions.
  if (session.start_time && new Date(String(session.start_time)).getTime() < Date.now()) {
    return NextResponse.json({ error: "session_not_available" }, { status: 409 });
  }

  const classes = session.classes as
    | {
        studio_id?: string;
        studios?: { public_slug?: string | null } | { public_slug?: string | null }[] | null;
      }
    | {
        studio_id?: string;
        studios?: { public_slug?: string | null } | { public_slug?: string | null }[] | null;
      }[]
    | null;

  const cls = Array.isArray(classes) ? classes[0] : classes;
  const studioId = cls?.studio_id;
  if (!studioId) {
    return NextResponse.json({ error: "invalid_session" }, { status: 500 });
  }
  if ((session.spots_left ?? 0) <= 0) {
    return NextResponse.json({ error: "full" }, { status: 409 });
  }

  const studioRaw = cls?.studios;
  const studioObj = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const studioSlug = normalizeStudioSlug(studioObj?.public_slug ?? "");
  if (!studioSlug) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId,
      bootstrapIfMissing: true,
      declaredStudioSlug: inputSlug,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }

  const amount = Number(session.guest_price ?? 0);
  if (amount < 0) {
    return NextResponse.json({ error: "session_price_unavailable" }, { status: 409 });
  }
  const { data: studioContract } = await admin
    .from("studios")
    .select("contract_status, hitpay_enabled")
    .eq("id", studioId)
    .maybeSingle();
  if (studioContract?.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
  }
  const isZeroAmount = amount === 0;
  let merchantApiKey = "";
  if (!isZeroAmount) {
    const { data: studioSecrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", studioId)
      .maybeSingle();
    const configIssue = getHitpayConfigIssue({
      hitpayEnabled: studioContract?.hitpay_enabled,
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

  // For gifts, prevent booking a seat for a recipient who already has one for this session.
  if (isGift && giftRecipientEmail) {
    const recipientId = await findClientIdByEmail(admin, giftRecipientEmail);
    if (recipientId) {
      const { data: existing } = await admin
        .from("bookings")
        .select("id")
        .eq("session_id", parsed.data.session_id)
        .eq("client_id", recipientId)
        .in("status", ["pending", "booked"])
        .limit(1);
      if (existing?.length) {
        return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
      }
    }
    // Also catch existing guest bookings by email (recipient never created an account).
    const { data: guestExisting } = await admin
      .from("bookings")
      .select("id")
      .eq("session_id", parsed.data.session_id)
      .eq("guest_email", giftRecipientEmail)
      .in("status", ["pending", "booked"])
      .limit(1);
    if (guestExisting?.length) {
      return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
    }
  }

  const reference = generatePaymentReference();
  const expiresAt = getTimedBookingCheckoutExpiry(session.start_time as string | null | undefined);
  const bookingResult = await createPendingClassBookingReservation(admin, {
    sessionId: parsed.data.session_id,
    userId: user?.id ?? null,
    guestName,
    guestEmail,
    guestPhone,
    isGift,
    giftRecipientName,
    giftRecipientEmail,
  });
  if (!bookingResult.ok) {
    return NextResponse.json({ error: bookingResult.error }, { status: bookingResult.status });
  }

  const paymentResult = await createBookingCheckoutPayment(admin, {
    kind: "class",
    reservationId: bookingResult.reservationId,
    studioId,
    locationId: session.location_id ?? null,
    userId: user?.id ?? null,
    guestName,
    guestEmail,
    guestPhone,
    isGift,
    giftRecipientName,
    giftRecipientEmail,
    giftMessage,
    amount,
    currency: STUDIO_CURRENCY,
    referenceCode: reference,
    expiresAt,
  });
  if (!paymentResult.ok) {
    await rollbackPendingBookingReservation(admin, {
      kind: "class",
      reservationId: bookingResult.reservationId,
    });
    return NextResponse.json({ error: paymentResult.error }, { status: 500 });
  }

  await attachPaymentToBookingReservation(admin, {
    kind: "class",
    reservationId: bookingResult.reservationId,
    paymentId: paymentResult.paymentId,
  });

  const returnUrl = getStudioUrlFromRequest(req, studioSlug, `checkout/${paymentResult.paymentId}`);
  if (!returnUrl) {
    await cancelPendingBookingCheckout(admin, {
      paymentId: paymentResult.paymentId,
      studioId,
      reservationId: bookingResult.reservationId,
      kind: "class",
    });
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }
  if (isZeroAmount) {
    try {
      await finalizeBookingCheckout(admin, {
        paymentId: paymentResult.paymentId,
        studioId,
        reservationId: bookingResult.reservationId,
        kind: "class",
      });
      return NextResponse.json({
        booking_id: bookingResult.reservationId,
        payment_id: paymentResult.paymentId,
        amount,
        reference_code: reference,
        checkout_url: returnUrl,
        credits_required: bookingResult.creditsRequired
          ?? (session.credits_required != null ? Number(session.credits_required) : null),
      });
    } catch {
      await cancelPendingBookingCheckout(admin, {
        paymentId: paymentResult.paymentId,
        studioId,
        reservationId: bookingResult.reservationId,
        kind: "class",
      });
      return NextResponse.json({ error: "free_payment_finalize_failed" }, { status: 500 });
    }
  }
  const guestDisplayName = guestName ?? null;
  const guestDisplayEmail = guestEmail ?? user?.email ?? null;

  try {
    const hitpay = await createHitpayBookingCheckout({
      apiKey: merchantApiKey,
      amount,
      currency: STUDIO_CURRENCY,
      email: guestDisplayEmail ?? null,
      name: guestDisplayName,
      referenceCode: reference,
      returnUrl,
      purpose: `Booking ${session.id}`,
    });
    await attachHitpayCheckoutToBookingPayment(admin, {
      paymentId: paymentResult.paymentId,
      providerPaymentId: hitpay.providerPaymentId,
      checkoutUrl: hitpay.checkoutUrl,
      providerStatus: hitpay.providerStatus,
    });

    return NextResponse.json({
      booking_id: bookingResult.reservationId,
      payment_id: paymentResult.paymentId,
      amount,
      reference_code: reference,
      expires_at: expiresAt,
      checkout_url: hitpay.checkoutUrl,
      credits_required: bookingResult.creditsRequired
        ?? (session.credits_required != null ? Number(session.credits_required) : null),
    });
  } catch (e) {
    await cancelPendingBookingCheckout(admin, {
      paymentId: paymentResult.paymentId,
      studioId,
      reservationId: bookingResult.reservationId,
      kind: "class",
    });
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
