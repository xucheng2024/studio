import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { normalizeStudioSlug } from "@/lib/slug";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { findClientIdByEmail } from "@/lib/resolveClientId";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  event_id: z.string().uuid(),
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
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

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
  const { data: event, error: eErr } = await admin
    .from("events")
    .select("id, studio_id, is_active, start_time, spots_left, price, currency, external_booking_url, studios(public_slug)")
    .eq("id", parsed.data.event_id)
    .single();

  if (eErr || !event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (sanitizeEventExternalBookingUrl((event as { external_booking_url?: string | null }).external_booking_url)) {
    return NextResponse.json({ error: "event_external_booking_url" }, { status: 409 });
  }
  if (event.is_active === false) return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  if ((event.spots_left ?? 0) <= 0) return NextResponse.json({ error: "full" }, { status: 409 });
  // Guard: do not allow booking/checkout for past events.
  if (event.start_time && new Date(String(event.start_time)).getTime() < Date.now()) {
    return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  }

  const studioId = event.studio_id as string | null;
  if (!studioId) return NextResponse.json({ error: "invalid_event" }, { status: 500 });

  const studioRaw = event.studios as { public_slug?: string | null } | { public_slug?: string | null }[] | null;
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
    if (!studioAccess.ok) return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
  }

  const amount = Number(event.price ?? 0);
  if (!(amount > 0)) return NextResponse.json({ error: "invalid_amount" }, { status: 409 });

  const { data: studioContract } = await admin
    .from("studios")
    .select("contract_status, hitpay_enabled")
    .eq("id", studioId)
    .maybeSingle();
  const { data: studioSecrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", studioId)
    .maybeSingle();
  if (studioContract?.contract_status === "suspended") return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
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
  const merchantApiKey = studioSecrets?.hitpay_api_key ?? "";

  // For gifts, prevent booking a seat for a recipient who already has one for this event.
  if (isGift && giftRecipientEmail) {
    const recipientId = await findClientIdByEmail(admin, giftRecipientEmail);
    if (recipientId) {
      const { data: existing } = await admin
        .from("event_bookings")
        .select("id")
        .eq("event_id", parsed.data.event_id)
        .eq("client_id", recipientId)
        .in("status", ["pending", "booked"])
        .limit(1);
      if (existing?.length) {
        return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
      }
    }
    // Also catch existing guest bookings by email.
    const { data: guestExisting } = await admin
      .from("event_bookings")
      .select("id")
      .eq("event_id", parsed.data.event_id)
      .eq("guest_email", giftRecipientEmail)
      .in("status", ["pending", "booked"])
      .limit(1);
    if (guestExisting?.length) {
      return NextResponse.json({ error: "gift_recipient_already_has_access" }, { status: 409 });
    }
  }

  const reference = generatePaymentReference();
  // Expire before event start to avoid holding reserved seats too long.
  // Target: now + 15m. Clamp to [now+1m, now+15m], and never after start-5m.
  const eventStart = event.start_time ? new Date(event.start_time as string).getTime() : null;
  const holdWindowMs = 15 * 60 * 1000;
  const nowMs = Date.now();
  const minExpiry = nowMs + 60 * 1000;
  const maxExpiry = nowMs + holdWindowMs;
  const hardCap = eventStart ? eventStart - 5 * 60 * 1000 : null;
  const rawExpiry = maxExpiry;
  const upperBound = hardCap != null ? Math.min(maxExpiry, hardCap) : maxExpiry;
  const expiresAt = new Date(Math.max(minExpiry, Math.min(upperBound, rawExpiry))).toISOString();

  // For gift bookings made by a logged-in user, treat the seat reservation as a
  // guest-style entry (p_client_id=null) so the RPC's duplicate-booking guard doesn't
  // fire against the buyer's own booking history. The booking's client_id will be
  // reassigned to the recipient when the payment webhook confirms.
  const rpcClientId = isGift ? null : (user?.id ?? null);
  // RPC requires guest name/email when client_id is null.
  const rpcGuestName = rpcClientId ? null : (guestName ?? giftRecipientName ?? "Gift recipient");
  const rpcGuestEmail = rpcClientId ? null : (guestEmail ?? giftRecipientEmail ?? null);
  const { data: bookingRpc, error: bErr } = await admin.rpc("create_pending_event_booking", {
    p_event_id: parsed.data.event_id,
    p_client_id: rpcClientId,
    p_guest_name: rpcGuestName,
    p_guest_email: rpcGuestEmail,
    p_guest_phone: rpcClientId ? null : guestPhone,
  });
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
  const bookingResult = bookingRpc as { ok?: boolean; error?: string; event_booking_id?: string };
  if (!bookingResult?.ok || !bookingResult.event_booking_id) {
    return NextResponse.json({ error: bookingResult?.error ?? "booking_create_failed" }, { status: 409 });
  }

  const currency = String(event.currency ?? "SGD");
  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      package_id: null,
      event_booking_id: bookingResult.event_booking_id,
      studio_id: studioId,
      location_id: null,
      client_id: user?.id ?? null,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      is_gift: isGift,
      gift_recipient_name: isGift ? giftRecipientName : null,
      gift_recipient_email: isGift ? giftRecipientEmail : null,
      gift_message: isGift ? giftMessage : null,
      amount,
      currency,
      payment_method: "hitpay",
      source: "event_booking",
      status: "pending",
      reference_code: reference,
      expires_at: expiresAt,
      type: "single",
      remaining_uses: 0,
    })
    .select("id")
    .single();

  if (pErr || !payment) {
    // Payment row failed to create; undo the seat reservation + pending booking.
    await admin.from("event_bookings").delete().eq("id", bookingResult.event_booking_id);
    await admin.from("events").update({ spots_left: (event.spots_left ?? 0) + 1 }).eq("id", event.id);
    return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  await admin.from("event_bookings").update({ payment_id: payment.id }).eq("id", bookingResult.event_booking_id);

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  const returnUrl = `${baseUrl}/${studioSlug}/checkout/${payment.id}`;
  const guestDisplayName = guestName ?? null;
  const guestDisplayEmail = guestEmail ?? user?.email ?? null;

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: merchantApiKey,
      amount: amount.toFixed(2),
      currency,
      email: guestDisplayEmail,
      name: guestDisplayName,
      reference_number: reference,
      redirect_url: returnUrl,
      purpose: `Event booking ${event.id}`,
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
      event_booking_id: bookingResult.event_booking_id,
      payment_id: payment.id,
      amount,
      currency,
      reference_code: reference,
      expires_at: expiresAt,
      checkout_url: hitpay.checkoutUrl,
    });
  } catch (e) {
    await admin.rpc("cancel_pending_event_payment", { p_payment_id: payment.id, p_new_status: "failed" });
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
