import { NextResponse } from "next/server";
import { z } from "zod";
import { getHitpayPaymentRequest } from "@/lib/hitpay";
import { applyHitpayPaymentRequestStatus } from "@/lib/hitpayApplyPaymentRequestStatus";
import { normalizeStudioSlug } from "@/lib/slug";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  studio_slug: z.string().min(1).max(120),
});

/**
 * Polls HitPay for payment-request status and applies the same DB updates as the webhook.
 * Used when the customer returns from checkout before the webhook arrives (or webhook URL/salt is misconfigured).
 */
export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select("id, status, studio_id, booking_id, event_booking_id, gateway_payment_id, studios(owner_id, public_slug)")
    .eq("id", parsed.data.payment_id)
    .maybeSingle();

  if (error || !payment) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  const studioRaw = (payment as {
    studios?: { owner_id?: string | null; public_slug?: string | null } | { owner_id?: string | null; public_slug?: string | null }[] | null;
  }).studios;
  const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const expectedStudioSlug = normalizeStudioSlug(studio?.public_slug ?? "");
  const providedStudioSlug = normalizeStudioSlug(parsed.data.studio_slug);
  if (!expectedStudioSlug || providedStudioSlug !== expectedStudioSlug) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  if (payment.status !== "pending") {
    return NextResponse.json({ ok: true, state: payment.status });
  }

  const gatewayId = (payment as { gateway_payment_id?: string | null }).gateway_payment_id?.trim();
  if (!gatewayId) {
    return NextResponse.json({ error: "no_gateway_payment_id" }, { status: 409 });
  }

  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", payment.studio_id)
    .maybeSingle();
  const apiKey = secrets?.hitpay_api_key?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "hitpay_not_configured" }, { status: 503 });
  }

  let hitpay: Awaited<ReturnType<typeof getHitpayPaymentRequest>>;
  try {
    hitpay = await getHitpayPaymentRequest({ apiKey, requestId: gatewayId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "hitpay_sync_failed";
    return NextResponse.json({ error: "hitpay_lookup_failed", detail: msg }, { status: 502 });
  }

  const firstChildPayment = Array.isArray(hitpay.payload.payments) ? hitpay.payload.payments[0] : null;
  const providerPaymentId = firstChildPayment?.id?.trim() || null;
  const gatewayPayload = JSON.stringify({
    source: "hitpay_status_sync",
    fetched_at: new Date().toISOString(),
    hitpay: hitpay.payload,
  });

  await applyHitpayPaymentRequestStatus(
    admin,
    {
      id: payment.id,
      studio_id: payment.studio_id,
      booking_id: payment.booking_id,
      event_booking_id: (payment as { event_booking_id?: string | null }).event_booking_id,
    },
    studio,
    hitpay.status,
    gatewayPayload,
    providerPaymentId,
  );

  const { data: refreshed } = await admin.from("payments").select("status").eq("id", payment.id).maybeSingle();

  return NextResponse.json({
    ok: true,
    hitpay_status: hitpay.status,
    payment_status: refreshed?.status ?? null,
  });
}
