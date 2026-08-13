import { NextResponse } from "next/server";
import { z } from "zod";
import { createHitpayPaymentRequest } from "@/lib/hitpay";
import { ensurePosSalePayment } from "@/lib/pos-sales";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";

const bodySchema = z.object({
  studio_id: z.string().uuid(),
  sale_id: z.string().uuid(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const ensurePayment = await ensurePosSalePayment({
    userId: user.id,
    studioId: parsed.data.studio_id,
    saleId: parsed.data.sale_id,
  });
  if (!ensurePayment.ok) {
    return NextResponse.json(
      { ok: false, error: ensurePayment.code, message: ensurePayment.message },
      { status: ensurePayment.code === "forbidden" ? 403 : ensurePayment.code === "not_found" ? 404 : 400 },
    );
  }

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("id, status, amount, currency, reference_code, gateway_payment_id, gateway_checkout_url, location_id")
    .eq("id", ensurePayment.payload.payment_id)
    .maybeSingle<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      reference_code: string | null;
      gateway_payment_id: string | null;
      gateway_checkout_url: string | null;
      location_id: string | null;
    }>();

  if (!payment) {
    return NextResponse.json({ ok: false, error: "payment_not_found" }, { status: 404 });
  }

  if (payment.status === "paid" || payment.status === "refunded") {
    return NextResponse.json({ ok: false, error: "payment_not_pending" }, { status: 409 });
  }

  if (payment.gateway_payment_id && payment.gateway_checkout_url && payment.status === "pending") {
    return NextResponse.json({
      ok: true,
      payment_id: payment.id,
      checkout_url: payment.gateway_checkout_url,
      provider_payment_id: payment.gateway_payment_id,
      reused_existing_request: true,
    });
  }

  const [{ data: studio }, { data: secrets }] = await Promise.all([
    admin.from("studios").select("hitpay_enabled").eq("id", parsed.data.studio_id).maybeSingle<{ hitpay_enabled: boolean | null }>(),
    admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", parsed.data.studio_id)
      .maybeSingle<{ hitpay_api_key: string | null }>(),
  ]);

  const merchantApiKey = secrets?.hitpay_api_key?.trim() ?? "";
  const configIssue = getHitpayConfigIssue({
    hitpayEnabled: studio?.hitpay_enabled,
    merchantApiKey,
  });
  if (configIssue) {
    return NextResponse.json(
      { ok: false, error: configIssue.error, error_detail: configIssue.error_detail },
      { status: configIssue.status },
    );
  }

  const appBaseUrl = getAppBaseUrlFromRequest(req);
  if (!appBaseUrl) {
    return NextResponse.json({ ok: false, error: "app_url_missing" }, { status: 500 });
  }

  const returnQuery = new URLSearchParams();
  returnQuery.set("studio_id", parsed.data.studio_id);
  if (payment.location_id) returnQuery.set("location_id", payment.location_id);
  returnQuery.set("payment_status", "pending");

  const returnUrl = `${appBaseUrl}/dashboard/pos/${parsed.data.sale_id}?${returnQuery.toString()}`;
  const referenceCode =
    payment.reference_code?.trim() || `POS-${parsed.data.sale_id.replaceAll("-", "").slice(0, 24).toUpperCase()}`;

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: merchantApiKey,
      amount: Number(payment.amount ?? 0).toFixed(2),
      currency: (payment.currency || "SGD").toUpperCase(),
      reference_number: referenceCode,
      redirect_url: returnUrl,
      purpose: `POS Sale ${parsed.data.sale_id.slice(0, 8)}`,
    });

    await admin
      .from("payments")
      .update({
        payment_method: "hitpay",
        reference_code: referenceCode,
        gateway_payment_id: hitpay.providerPaymentId,
        gateway_checkout_url: hitpay.checkoutUrl,
        gateway_status: hitpay.providerStatus,
      })
      .eq("id", payment.id);

    return NextResponse.json({
      ok: true,
      payment_id: payment.id,
      checkout_url: hitpay.checkoutUrl,
      provider_payment_id: hitpay.providerPaymentId,
      provider_status: hitpay.providerStatus,
      reused_existing_request: false,
    });
  } catch (e) {
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    return NextResponse.json(
      { ok: false, error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
