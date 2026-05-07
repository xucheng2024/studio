import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { normalizeStudioSlug } from "@/lib/slug";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  event_id: z.string().uuid(),
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
  if (!user && (!guestName || !guestEmail)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event, error: eErr } = await admin
    .from("events")
    .select("id, studio_id, is_active, start_time, spots_left, price, currency, studios(public_slug)")
    .eq("id", parsed.data.event_id)
    .single();

  if (eErr || !event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (event.is_active === false) return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  if ((event.spots_left ?? 0) <= 0) return NextResponse.json({ error: "full" }, { status: 409 });
  // Guard: do not allow booking/checkout for past events.
  if (event.start_time && new Date(String(event.start_time)).getTime() < Date.now()) {
    return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  }

  const studioId = event.studio_id as string | null;
  if (!studioId) return NextResponse.json({ error: "invalid_event" }, { status: 500 });

  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId,
      bootstrapIfMissing: true,
    });
    if (!studioAccess.ok) return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
  }

  const studioRaw = event.studios as { public_slug?: string | null } | { public_slug?: string | null }[] | null;
  const studioObj = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const studioSlug = normalizeStudioSlug(studioObj?.public_slug ?? "");
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
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
  if (!studioContract?.hitpay_enabled || !studioSecrets?.hitpay_api_key) {
    return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
  }

  const reference = generatePaymentReference();
  // Expire before event start to avoid holding reserved seats too long.
  // Target: 2 hours before start. Clamp to [now+1m, now+24h], and never after start-5m.
  const eventStart = event.start_time ? new Date(event.start_time as string).getTime() : null;
  const twoHoursBefore = eventStart ? eventStart - 2 * 60 * 60 * 1000 : null;
  const nowMs = Date.now();
  const minExpiry = nowMs + 60 * 1000;
  const maxExpiry = nowMs + 24 * 60 * 60 * 1000;
  const hardCap = eventStart ? eventStart - 5 * 60 * 1000 : null;
  const rawExpiry = twoHoursBefore ?? maxExpiry;
  const upperBound = hardCap != null ? Math.min(maxExpiry, hardCap) : maxExpiry;
  const expiresAt = new Date(Math.max(minExpiry, Math.min(upperBound, rawExpiry))).toISOString();

  const { data: bookingRpc, error: bErr } = await admin.rpc("create_pending_event_booking", {
    p_event_id: parsed.data.event_id,
    p_client_id: user?.id ?? null,
    p_guest_name: user ? null : guestName ?? null,
    p_guest_email: user ? null : guestEmail ?? null,
    p_guest_phone: user ? null : guestPhone,
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
  const returnUrl = `${baseUrl}/checkout/${payment.id}`;
  const guestDisplayName = guestName ?? null;
  const guestDisplayEmail = guestEmail ?? user?.email ?? null;

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: studioSecrets.hitpay_api_key,
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
    const message = e instanceof Error ? e.message : "hitpay_create_failed";
    const status = message === "hitpay_not_configured" ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}

