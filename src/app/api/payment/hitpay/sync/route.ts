import { NextResponse } from "next/server";
import { z } from "zod";
import { getHitpayPaymentRequest } from "@/lib/hitpay";
import { applyHitpayPaymentRequestStatus } from "@/lib/hitpayApplyPaymentRequestStatus";
import { completePosHitpaySale } from "@/lib/pos-sales";
import { normalizeStudioSlug } from "@/lib/slug";
import { requireStaffScope } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  studio_slug: z.string().min(1).max(120),
  gateway_payment_id: z.string().min(1).max(255).nullish(),
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .select("id, status, studio_id, location_id, client_id, booking_id, event_booking_id, gateway_payment_id, source, pos_sale_id, studios(owner_id, public_slug)")
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
  const paymentClientId = (payment as { client_id?: string | null }).client_id ?? null;
  const providedGatewayPaymentId = parsed.data.gateway_payment_id?.trim() ?? null;
  const gatewayId = (payment as { gateway_payment_id?: string | null }).gateway_payment_id?.trim();
  let isAuthorizedStaff = false;
  if (user) {
    const staffScope = await requireStaffScope({
      userId: user.id,
      studioId: payment.studio_id,
      locationId: (payment as { location_id?: string | null }).location_id ?? null,
      roles: ["owner", "manager", "frontdesk"],
    });
    isAuthorizedStaff = staffScope.ok;
  }
  if (!isAuthorizedStaff && paymentClientId) {
    const hasGatewayProof = Boolean(providedGatewayPaymentId && gatewayId && providedGatewayPaymentId === gatewayId);
    if ((!user || user.id !== paymentClientId) && !hasGatewayProof) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  } else if (!isAuthorizedStaff && !providedGatewayPaymentId) {
    return NextResponse.json({ error: "gateway_payment_id_required" }, { status: 400 });
  }

  if (payment.status !== "pending") {
    return NextResponse.json({ ok: true, state: payment.status });
  }

  if (!gatewayId || (providedGatewayPaymentId && providedGatewayPaymentId !== gatewayId)) {
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

  const paidLike = hitpay.status === "completed" || hitpay.status === "succeeded" || hitpay.status === "paid";
  const isPosPayment = (payment as { source?: string | null }).source === "pos_sale"
    && Boolean((payment as { pos_sale_id?: string | null }).pos_sale_id);

  if (isPosPayment && paidLike) {
    const result = await completePosHitpaySale({
      studioId: payment.studio_id,
      paymentId: payment.id,
      saleId: (payment as { pos_sale_id?: string | null }).pos_sale_id ?? null,
      providerEventId: null,
      providerPaymentId,
      providerStatus: hitpay.status,
      gatewayPayload,
      verifiedBy: studio?.owner_id ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: "complete_pos_hitpay_sale_failed", detail: `${result.code}:${result.message}` }, { status: 409 });
    }
  } else {
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
  }

  const { data: refreshed } = await admin.from("payments").select("status").eq("id", payment.id).maybeSingle();

  return NextResponse.json({
    ok: true,
    hitpay_status: hitpay.status,
    payment_status: refreshed?.status ?? null,
  });
}
