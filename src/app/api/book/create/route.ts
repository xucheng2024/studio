import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildPaynowPayload,
  generatePaynowReference,
  toQrDataUrl,
  validatePaynowConfig,
} from "@/lib/paynow";
import { normalizeStudioSlug } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  slug: z.string().optional(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
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

  if (!user && (!guestName || !guestEmail)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: session, error: sErr } = await admin
    .from("class_sessions")
    .select(
      `
      id,
      spots_left,
      location_id,
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
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const { data: dropIn } = await admin
    .from("packages")
    .select("price")
    .eq("studio_id", studioId)
    .eq("is_drop_in", true)
    .limit(1)
    .maybeSingle();
  const amount = Number(dropIn?.price ?? 25);
  const { data: studioPaynow } = await admin
    .from("studios")
    .select(
      "paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name, contract_status",
    )
    .eq("id", studioId)
    .maybeSingle();
  if (studioPaynow?.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
  }
  const paynow = validatePaynowConfig({
    paynow_enabled: Boolean(studioPaynow?.paynow_enabled),
    paynow_proxy_type: studioPaynow?.paynow_proxy_type ?? null,
    paynow_uen: studioPaynow?.paynow_uen ?? null,
    paynow_mobile: studioPaynow?.paynow_mobile ?? null,
    paynow_payee_name: studioPaynow?.paynow_payee_name ?? null,
  });
  if (!paynow.ok) {
    return NextResponse.json({ error: paynow.error, message: paynow.message }, { status: 409 });
  }
  const reference = generatePaynowReference();
  const qrPayload = buildPaynowPayload({
    proxyType: paynow.proxyType,
    uen: paynow.uen,
    mobile: paynow.mobile,
    payeeName: paynow.payeeName,
    amount,
    reference,
  });
  const qrCodeUrl = await toQrDataUrl(qrPayload);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: bookingRpc, error: bErr } = await admin.rpc("create_pending_booking", {
    p_session_id: parsed.data.session_id,
    p_client_id: user?.id ?? null,
    p_guest_name: user ? null : guestName ?? null,
    p_guest_email: user ? null : guestEmail ?? null,
    p_guest_phone: user ? null : guestPhone,
  });
  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 });
  }
  const bookingResult = bookingRpc as { ok?: boolean; error?: string; booking_id?: string };
  if (!bookingResult?.ok || !bookingResult.booking_id) {
    return NextResponse.json(
      { error: bookingResult?.error ?? "booking_create_failed" },
      { status: 409 },
    );
  }

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: bookingResult.booking_id,
      package_id: null,
      studio_id: studioId,
      location_id: session.location_id ?? null,
      client_id: user?.id ?? null,
      amount,
      currency: "SGD",
      payment_method: "paynow",
      status: "pending",
      reference_code: reference,
      qr_payload: qrPayload,
      paynow_proxy_type_snapshot: paynow.proxyType,
      paynow_uen_snapshot: paynow.uen,
      paynow_mobile_snapshot: paynow.mobile,
      paynow_payee_name_snapshot: paynow.payeeName,
      expires_at: expiresAt,
      type: "single",
      remaining_uses: 0,
    })
    .select("id")
    .single();

  if (pErr || !payment) {
    await admin.from("bookings").delete().eq("id", bookingResult.booking_id);
    return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  await admin.from("bookings").update({ payment_id: payment.id }).eq("id", bookingResult.booking_id);

  return NextResponse.json({
    booking_id: bookingResult.booking_id,
    payment_id: payment.id,
    qr_code_url: qrCodeUrl,
    amount,
    reference_code: reference,
    expires_at: expiresAt,
    checkout_url: `/checkout/${payment.id}`,
  });
}
