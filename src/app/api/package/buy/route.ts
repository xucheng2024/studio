import { NextResponse } from "next/server";
import { z } from "zod";
import {
  buildPaynowPayload,
  generatePaynowReference,
  toQrDataUrl,
  validatePaynowConfig,
} from "@/lib/paynow";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  package_id: z.string().uuid(),
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
  let purchaserId = user?.id ?? null;
  const guestName = parsed.data.guest_name?.trim();
  const guestEmail = parsed.data.guest_email?.trim().toLowerCase();
  const guestPhone = parsed.data.guest_phone?.trim() || null;
  if (!user && (!guestName || !guestEmail)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!purchaserId && guestEmail) {
    const { data: existingUser } = await admin
      .from("users")
      .select("id")
      .eq("email", guestEmail)
      .maybeSingle();
    purchaserId = existingUser?.id ?? null;
  }
  if (!purchaserId) {
    return NextResponse.json(
      { error: "sign_in_required_for_package", message: "Please sign in before purchasing a package." },
      { status: 409 },
    );
  }

  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select("id, studio_id, name, credits, price, expiry_days, is_active")
    .eq("id", parsed.data.package_id)
    .single();

  if (pkgErr || !pkg) {
    return NextResponse.json({ error: "package_not_found" }, { status: 404 });
  }
  if (pkg.is_active === false) {
    return NextResponse.json({ error: "package_not_available" }, { status: 409 });
  }

  const blockedPkg = await respondIfStudioContractSuspended(admin, pkg.studio_id);
  if (blockedPkg) return blockedPkg;

  const { data: studioPaynow } = await admin
    .from("studios")
    .select("paynow_enabled, paynow_proxy_type, paynow_uen, paynow_mobile, paynow_payee_name")
    .eq("id", pkg.studio_id)
    .maybeSingle();
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
    amount: Number(pkg.price),
    reference,
  });
  const qrCodeUrl = await toQrDataUrl(qrPayload);
  // Package payments have no class start time, so give staff 24 h to confirm.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      package_id: pkg.id,
      studio_id: pkg.studio_id,
      client_id: purchaserId,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      amount: pkg.price,
      currency: "SGD",
      payment_method: "paynow",
      reference_code: reference,
      qr_payload: qrPayload,
      paynow_proxy_type_snapshot: paynow.proxyType,
      paynow_uen_snapshot: paynow.uen,
      paynow_mobile_snapshot: paynow.mobile,
      paynow_payee_name_snapshot: paynow.payeeName,
      expires_at: expiresAt,
      type: "package",
      status: "pending",
      remaining_uses: 0,
    })
    .select("id, amount")
    .single();

  if (pErr || !payment) {
    return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  return NextResponse.json({
    payment_id: payment.id,
    amount: payment.amount,
    reference_code: reference,
    qr_code_url: qrCodeUrl,
    expires_at: expiresAt,
    checkout_url: `/checkout/${payment.id}`,
  });
}
