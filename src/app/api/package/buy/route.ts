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
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: pkg, error: pkgErr } = await admin
    .from("packages")
    .select("id, studio_id, name, credits, price, expiry_days")
    .eq("id", parsed.data.package_id)
    .single();

  if (pkgErr || !pkg) {
    return NextResponse.json({ error: "package_not_found" }, { status: 404 });
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
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      package_id: pkg.id,
      studio_id: pkg.studio_id,
      client_id: user.id,
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
