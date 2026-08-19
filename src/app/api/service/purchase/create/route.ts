import { NextResponse } from "next/server";
import { z } from "zod";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { getStudioUrlFromRequest } from "@/lib/app-url";
import { normalizeStudioSlug } from "@/lib/slug";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { cancelPendingPaymentLifecycle } from "@/lib/paymentStatusTransitions";
import { finalizeZeroAmountPayment } from "@/lib/finalizeZeroAmountPayment";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  slug: z.string().optional(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
  note: z.string().max(1000).optional(),
  qty: z.coerce.number().int().min(1).max(10).optional().default(1),
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
  const note = parsed.data.note?.trim() || null;

  if (!user && (!guestName || !guestEmail || !guestPhone)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }

  const admin = createAdminClient();
  await sweepExpiredPendingPayments(admin);

  const { data: service, error: serviceErr } = await admin
    .from("studio_services")
    .select("id, studio_id, title, price, is_active, enable_payment, studios(public_slug, contract_status, hitpay_enabled)")
    .eq("id", parsed.data.service_id)
    .single();

  if (serviceErr || !service) {
    return NextResponse.json({ error: "service_not_found" }, { status: 404 });
  }
  if (service.is_active === false) {
    return NextResponse.json({ error: "service_not_available" }, { status: 409 });
  }
  if (!(service as { enable_payment?: boolean | null }).enable_payment) {
    return NextResponse.json({ error: "service_payment_disabled" }, { status: 409 });
  }

  const studioRaw = (service as {
    studios?: { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null } | { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null }[] | null;
  }).studios;
  const studioObj = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const studioSlug = normalizeStudioSlug(studioObj?.public_slug ?? "");
  if (!studioSlug) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }
  const inputSlug = parsed.data.slug ? normalizeStudioSlug(parsed.data.slug) : null;
  if (inputSlug && inputSlug !== studioSlug) {
    return NextResponse.json({ error: "studio_mismatch" }, { status: 400 });
  }

  const blocked = await respondIfStudioContractSuspended(admin, service.studio_id);
  if (blocked) return blocked;

  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId: service.studio_id,
      bootstrapIfMissing: true,
      declaredStudioSlug: inputSlug,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
  }

  const qty = parsed.data.qty ?? 1;
  const unitPrice = Number(service.price ?? 0);
  const amount = Math.round(unitPrice * qty * 100) / 100;
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(amount) || amount < 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 409 });
  }

  const isZeroAmount = amount === 0;
  let merchantApiKey = "";
  if (!isZeroAmount) {
    const { data: studioSecrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", service.studio_id)
      .maybeSingle();
    const configIssue = getHitpayConfigIssue({
      hitpayEnabled: studioObj?.hitpay_enabled,
      merchantApiKey: studioSecrets?.hitpay_api_key,
    });
    if (configIssue) {
      return NextResponse.json(
        { error: configIssue.error, error_detail: configIssue.error_detail },
        { status: configIssue.status },
      );
    }
    merchantApiKey = studioSecrets?.hitpay_api_key ?? "";
  }

  const reference = generatePaymentReference();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      booking_id: null,
      event_booking_id: null,
      package_id: null,
      service_id: service.id,
      service_title_snapshot: service.title,
      studio_id: service.studio_id,
      location_id: null,
      client_id: user?.id ?? null,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      amount,
      currency: STUDIO_CURRENCY,
      payment_method: isZeroAmount ? "free" : "hitpay",
      sales_channel: "online",
      source: "service_purchase",
      reference_code: reference,
      expires_at: expiresAt,
      type: "single",
      status: "pending",
      remaining_uses: 0,
    })
    .select("id, studio_id")
    .single();

  if (paymentErr || !payment) {
    return NextResponse.json({ error: paymentErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  const { error: orderErr } = await admin
    .from("service_orders")
    .insert({
      studio_id: service.studio_id,
      service_id: service.id,
      payment_id: payment.id,
      client_id: user?.id ?? null,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      note,
      service_title_snapshot: service.title,
      qty,
      amount,
      currency: STUDIO_CURRENCY,
      status: "pending",
    });

  if (orderErr) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    return NextResponse.json({ error: orderErr.message ?? "service_order_create_failed" }, { status: 500 });
  }

  const returnUrl = getStudioUrlFromRequest(req, studioSlug, `checkout/${payment.id}`);
  if (!returnUrl) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }

  if (isZeroAmount) {
    try {
      await finalizeZeroAmountPayment(admin, {
        id: payment.id,
        studio_id: service.studio_id,
        booking_id: null,
        event_booking_id: null,
      });
      return NextResponse.json({
        payment_id: payment.id,
        reference_code: reference,
        checkout_url: returnUrl,
      });
    } catch {
      await cancelPendingPaymentLifecycle(admin, payment, "failed");
      return NextResponse.json({ error: "free_payment_finalize_failed" }, { status: 500 });
    }
  }

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: merchantApiKey,
      amount: amount.toFixed(2),
      currency: STUDIO_CURRENCY,
      email: guestEmail ?? user?.email ?? null,
      name: guestName ?? null,
      reference_number: reference,
      redirect_url: returnUrl,
      purpose: `Service ${service.title}`,
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
      reference_code: reference,
      expires_at: expiresAt,
      checkout_url: hitpay.checkoutUrl,
    });
  } catch (e) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    const normalized = normalizeHitpayError(e instanceof Error ? e.message : "hitpay_create_failed");
    return NextResponse.json(
      { error: normalized.error, error_detail: normalized.error_detail },
      { status: normalized.status },
    );
  }
}
