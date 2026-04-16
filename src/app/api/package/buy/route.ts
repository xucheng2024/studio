import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPaynowPayload, generatePaynowReference, toQrDataUrl } from "@/lib/paynow";
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

  const reference = generatePaynowReference();
  const qrPayload = buildPaynowPayload({
    studioCode: pkg.studio_id,
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
