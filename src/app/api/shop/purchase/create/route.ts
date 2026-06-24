import { NextResponse } from "next/server";
import { z } from "zod";
import { createHitpayPaymentRequest, generatePaymentReference } from "@/lib/hitpay";
import { verifyMemberStudioAccess } from "@/lib/member-studio";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import { normalizeStudioSlug } from "@/lib/slug";
import { getHitpayConfigIssue, normalizeHitpayError } from "@/lib/paymentErrors";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { cancelPendingPaymentLifecycle } from "@/lib/paymentStatusTransitions";
import { findClientIdByEmail, resolveClientIdByEmail } from "@/lib/resolveClientId";
import { finalizeZeroAmountPayment } from "@/lib/finalizeZeroAmountPayment";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  product_id: z.string().uuid(),
  guest_name: z.string().max(120).optional(),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional().nullable(),
  is_gift: z.boolean().optional(),
  gift_recipient_name: z.string().max(120).optional(),
  gift_recipient_email: z.string().email().max(320).optional(),
  gift_message: z.string().max(500).optional(),
  save_shipping_to_profile: z.boolean().optional(),
  shipping_name: z.string().min(1).max(120),
  shipping_phone: z.string().min(1).max(40),
  shipping_address_line1: z.string().min(1).max(200),
  shipping_address_line2: z.string().max(200).optional().nullable(),
  shipping_city: z.string().min(1).max(120),
  shipping_postal_code: z.string().min(1).max(20),
  shipping_country: z.string().min(2).max(80).default("SG"),
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
  const isGift = parsed.data.is_gift === true;
  const giftRecipientName = parsed.data.gift_recipient_name?.trim() || null;
  const giftRecipientEmail = parsed.data.gift_recipient_email?.trim().toLowerCase() || null;
  const giftMessage = parsed.data.gift_message?.trim() || null;
  if (!user && (!guestName || !guestEmail || !guestPhone)) {
    return NextResponse.json({ error: "guest_details_required" }, { status: 400 });
  }
  if (isGift) {
    if (!giftRecipientEmail) {
      return NextResponse.json({ error: "gift_recipient_email_required" }, { status: 400 });
    }
    const buyerEmail = (guestEmail ?? user?.email ?? "").trim().toLowerCase();
    if (buyerEmail && giftRecipientEmail === buyerEmail) {
      return NextResponse.json({ error: "gift_self_not_allowed" }, { status: 400 });
    }
  }

  const admin = createAdminClient();
  await sweepExpiredPendingPayments(admin);

  const { data: product, error: productErr } = await admin
    .from("shop_products")
    .select("id, studio_id, title, price, stock_qty, is_active, studios(public_slug, hitpay_enabled)")
    .eq("id", parsed.data.product_id)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }
  if (!product.is_active) {
    return NextResponse.json({ error: "product_not_available" }, { status: 409 });
  }
  if (product.stock_qty != null && Number(product.stock_qty) < 1) {
    return NextResponse.json({ error: "out_of_stock" }, { status: 409 });
  }

  const studioRaw = (product as { studios?: { public_slug?: string | null; hitpay_enabled?: boolean | null } | { public_slug?: string | null; hitpay_enabled?: boolean | null }[] | null }).studios;
  const studioObj = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  const studioSlug = normalizeStudioSlug(studioObj?.public_slug ?? "");
  if (!studioSlug) {
    return NextResponse.json({ error: "studio_not_found" }, { status: 404 });
  }

  const blocked = await respondIfStudioContractSuspended(admin, product.studio_id);
  if (blocked) return blocked;

  if (isGift && giftRecipientEmail) {
    const { data: recipientGiftPayments } = await admin
      .from("payments")
      .select("id")
      .eq("studio_id", product.studio_id)
      .eq("source", "shop_purchase")
      .eq("shop_product_id", product.id)
      .eq("is_gift", true)
      .eq("gift_recipient_email", giftRecipientEmail)
      .in("status", ["pending", "paid"])
      .limit(1);
    if ((recipientGiftPayments ?? []).length > 0) {
      return NextResponse.json({ error: "gift_recipient_already_has_order" }, { status: 409 });
    }

    const recipientId = await findClientIdByEmail(admin, giftRecipientEmail);
    if (recipientId) {
      const { data: recipientOrders } = await admin
        .from("shop_orders")
        .select("id")
        .eq("studio_id", product.studio_id)
        .eq("product_id", product.id)
        .eq("client_id", recipientId)
        .in("status", ["pending", "processing", "paid"])
        .limit(1);
      if ((recipientOrders ?? []).length > 0) {
        return NextResponse.json({ error: "gift_recipient_already_has_order" }, { status: 409 });
      }
    }
  }

  let effectiveClientId: string;
  if (user) {
    const studioAccess = await verifyMemberStudioAccess(admin, {
      userId: user.id,
      studioId: product.studio_id,
      bootstrapIfMissing: true,
    });
    if (!studioAccess.ok) {
      return NextResponse.json({ error: studioAccess.reason }, { status: 403 });
    }
    effectiveClientId = user.id;

    if (parsed.data.save_shipping_to_profile !== false) {
      await admin.from("user_profiles").upsert(
        {
          id: user.id,
          email: user.email ?? null,
          shipping_name: parsed.data.shipping_name,
          shipping_phone: parsed.data.shipping_phone,
          shipping_address_line1: parsed.data.shipping_address_line1,
          shipping_address_line2: parsed.data.shipping_address_line2?.trim() || null,
          shipping_city: parsed.data.shipping_city,
          shipping_postal_code: parsed.data.shipping_postal_code,
          shipping_country: parsed.data.shipping_country.toUpperCase(),
        },
        { onConflict: "id" },
      );
    }
  } else {
    effectiveClientId = await resolveClientIdByEmail(admin, {
      email: guestEmail!,
      name: guestName,
      phone: guestPhone,
    });
  }

  const amount = Number(Number(product.price).toFixed(2));
  if (amount < 0) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 409 });
  }
  const isZeroAmount = amount === 0;
  let merchantApiKey = "";
  if (!isZeroAmount) {
    const { data: studioSecrets } = await admin
      .from("studio_payment_secrets")
      .select("hitpay_api_key")
      .eq("studio_id", product.studio_id)
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
  const currency = STUDIO_CURRENCY;
  const reference = generatePaymentReference();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: payment } = await admin
    .from("payments")
    .insert({
      studio_id: product.studio_id,
      client_id: effectiveClientId,
      booking_id: null,
      event_booking_id: null,
      package_id: null,
      membership_product_id: null,
      member_zone_series_id: null,
      member_zone_lesson_id: null,
      shop_product_id: product.id,
      shop_product_name_snapshot: product.title,
      guest_name: user ? null : guestName ?? null,
      guest_email: user ? null : guestEmail ?? null,
      guest_phone: user ? null : guestPhone,
      is_gift: isGift,
      gift_recipient_name: isGift ? giftRecipientName : null,
      gift_recipient_email: isGift ? giftRecipientEmail : null,
      gift_message: isGift ? giftMessage : null,
      amount,
      currency,
      payment_method: isZeroAmount ? "free" : "hitpay",
      source: "shop_purchase",
      status: "pending",
      reference_code: reference,
      expires_at: expiresAt,
      type: "single",
      remaining_uses: 0,
    })
    .select("id")
    .single();

  if (!payment?.id) {
    return NextResponse.json({ error: "payment_create_failed" }, { status: 500 });
  }

  const shippingLine2 = parsed.data.shipping_address_line2?.trim() || null;
  const { error: orderErr } = await admin.from("shop_orders").insert({
    studio_id: product.studio_id,
    client_id: effectiveClientId,
    product_id: product.id,
    payment_id: payment.id,
    qty: 1,
    status: "pending",
    product_title_snapshot: product.title,
    amount,
    currency,
    shipping_name: parsed.data.shipping_name,
    shipping_phone: parsed.data.shipping_phone,
    shipping_address_line1: parsed.data.shipping_address_line1,
    shipping_address_line2: shippingLine2,
    shipping_city: parsed.data.shipping_city,
    shipping_postal_code: parsed.data.shipping_postal_code,
    shipping_country: parsed.data.shipping_country.toUpperCase(),
  });

  if (orderErr) {
    await admin.from("payments").delete().eq("id", payment.id);
    return NextResponse.json({ error: "order_create_failed" }, { status: 500 });
  }

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  }
  const returnUrl = `${baseUrl}/${studioSlug}/checkout/${payment.id}`;
  if (isZeroAmount) {
    try {
      await finalizeZeroAmountPayment(admin, {
        id: payment.id,
        studio_id: product.studio_id,
        booking_id: null,
        event_booking_id: null,
      });
      return NextResponse.json({
        payment_id: payment.id,
        amount,
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
      currency,
      email: guestEmail ?? user?.email ?? null,
      name: guestName ?? parsed.data.shipping_name,
      reference_number: reference,
      redirect_url: returnUrl,
      purpose: `Shop: ${product.title}`,
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
      amount,
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
