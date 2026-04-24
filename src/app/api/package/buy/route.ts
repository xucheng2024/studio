import { NextResponse } from "next/server";
import { z } from "zod";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
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
  const guestName = parsed.data.guest_name?.trim();
  const guestEmail = parsed.data.guest_email?.trim().toLowerCase();
  const guestPhone = parsed.data.guest_phone?.trim() || null;
  if (!user && (!guestName || !guestEmail)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();

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
  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId: pkg.studio_id,
      bootstrapIfMissing: true,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }
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
  if (!studioHitpay?.hitpay_enabled || !studioSecrets?.hitpay_api_key) {
    return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
  }

  const reference = generatePaymentReference();
  // Package payments have no class start time, so give staff 24 h to confirm.
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      package_id: pkg.id,
      studio_id: pkg.studio_id,
      client_id: user?.id ?? null,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      amount: pkg.price,
      currency: "SGD",
      payment_method: "hitpay",
      reference_code: reference,
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

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) {
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }
  const returnUrl = `${baseUrl}/checkout/${payment.id}`;
  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: studioSecrets.hitpay_api_key,
      amount: Number(pkg.price).toFixed(2),
      currency: "SGD",
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
    await admin.rpc("cancel_pending_payment", {
      p_payment_id: payment.id,
      p_new_status: "failed",
    });
    const message = e instanceof Error ? e.message : "hitpay_create_failed";
    const status = message === "hitpay_not_configured" ? 409 : 502;
    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
