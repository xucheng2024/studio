import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppBaseUrlFromRequest } from "@/lib/app-url";
import {
  createHitpayPaymentRequest,
  generatePaymentReference,
} from "@/lib/hitpay";
import { resolveMemberZoneAccessRule } from "@/lib/memberZoneAccess";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  series_id: z.string().uuid(),
  lesson_id: z.string().uuid().optional().nullable(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: series } = await admin
    .from("member_zone_series")
    .select(
      "id, studio_id, title, is_active, share_slug, access_type, price, currency, studios(public_slug, contract_status, hitpay_enabled)",
    )
    .eq("id", parsed.data.series_id)
    .maybeSingle();
  if (!series || !series.is_active) {
    return NextResponse.json({ error: "series_not_found" }, { status: 404 });
  }

  const lessonId = parsed.data.lesson_id ?? null;
  const lesson = lessonId
    ? await admin
        .from("member_zone_lessons")
        .select(
          "id, title, is_active, access_override, override_price, currency, media_url",
        )
        .eq("id", lessonId)
        .eq("series_id", series.id)
        .maybeSingle()
    : { data: null };
  if (lessonId && (!lesson.data || !lesson.data.is_active)) {
    return NextResponse.json({ error: "lesson_not_found" }, { status: 404 });
  }

  const studioRaw = series.studios as
    | { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null }
    | { public_slug?: string | null; contract_status?: string | null; hitpay_enabled?: boolean | null }[]
    | null;
  const studio = Array.isArray(studioRaw) ? studioRaw[0] : studioRaw;
  if (!studio?.public_slug || studio.contract_status === "suspended") {
    return NextResponse.json({ error: "studio_unavailable" }, { status: 409 });
  }

  const accessRule = resolveMemberZoneAccessRule({
    seriesAccessType: series.access_type,
    seriesPrice: Number(series.price ?? 0),
    seriesCurrency: series.currency ?? "SGD",
    lessonAccessOverride: lesson.data?.access_override ?? "inherit",
    lessonOverridePrice: Number(lesson.data?.override_price ?? 0),
    lessonCurrency: lesson.data?.currency ?? "SGD",
  });
  if (accessRule.resolvedAccessType !== "paid" || accessRule.resolvedPrice <= 0) {
    return NextResponse.json({ error: "item_not_paywalled" }, { status: 409 });
  }

  const { data: activeMembership } = await admin
    .from("customer_subscriptions")
    .select("id")
    .eq("studio_id", series.studio_id)
    .eq("client_id", user.id)
    .in("status", ["scheduled", "active", "retrying", "inactive", "paused"])
    .limit(1);
  if ((activeMembership ?? []).length > 0) {
    return NextResponse.json({ error: "already_member" }, { status: 409 });
  }

  const duplicateQuery = admin
    .from("member_zone_purchases")
    .select("id")
    .eq("studio_id", series.studio_id)
    .eq("client_id", user.id)
    .eq("status", "paid");
  const { data: dup } =
    accessRule.purchaseScope === "lesson" && lessonId
      ? await duplicateQuery.eq("lesson_id", lessonId).limit(1)
      : await duplicateQuery.eq("series_id", series.id).is("lesson_id", null).limit(1);
  if ((dup ?? []).length > 0) {
    return NextResponse.json({ error: "already_purchased" }, { status: 409 });
  }

  const { data: studioSecrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", series.studio_id)
    .maybeSingle();
  if (!studio?.hitpay_enabled || !studioSecrets?.hitpay_api_key) {
    return NextResponse.json({ error: "hitpay_not_configured" }, { status: 409 });
  }

  const reference = generatePaymentReference();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const amount = Number(accessRule.resolvedPrice.toFixed(2));
  const currency = accessRule.resolvedCurrency;
  const sourceTitle =
    accessRule.purchaseScope === "lesson" ? lesson.data?.title ?? series.title : series.title;

  const { data: payment } = await admin
    .from("payments")
    .insert({
      studio_id: series.studio_id,
      client_id: user.id,
      booking_id: null,
      event_booking_id: null,
      package_id: null,
      membership_product_id: null,
      member_zone_series_id: series.id,
      member_zone_lesson_id: lessonId,
      amount,
      currency,
      payment_method: "hitpay",
      source: "member_zone_purchase",
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

  const { error: purchaseInsertErr } = await admin.from("member_zone_purchases").insert({
    studio_id: series.studio_id,
    client_id: user.id,
    series_id: series.id,
    lesson_id: lessonId,
    payment_id: payment.id,
    purchase_scope: accessRule.purchaseScope,
    amount,
    currency,
    status: "pending",
  });
  if (purchaseInsertErr) {
    await admin.from("payments").delete().eq("id", payment.id);
    return NextResponse.json({ error: "purchase_create_failed" }, { status: 500 });
  }

  const baseUrl = getAppBaseUrlFromRequest(req);
  if (!baseUrl) return NextResponse.json({ error: "app_url_missing" }, { status: 500 });
  const redirectUrl = `${baseUrl}/checkout/${payment.id}`;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const { data: userRow } = await admin
    .from("users")
    .select("email")
    .eq("id", user.id)
    .maybeSingle();

  try {
    const hitpay = await createHitpayPaymentRequest({
      apiKey: studioSecrets.hitpay_api_key,
      amount: amount.toFixed(2),
      currency,
      email: userRow?.email ?? null,
      name: profile?.full_name?.trim() || null,
      reference_number: reference,
      redirect_url: redirectUrl,
      purpose: `Member zone purchase: ${sourceTitle}`,
    });
    await admin
      .from("payments")
      .update({
        gateway_payment_id: hitpay.providerPaymentId,
        gateway_checkout_url: hitpay.checkoutUrl,
        gateway_status: hitpay.providerStatus,
      })
      .eq("id", payment.id);
    return NextResponse.json({ ok: true, checkout_url: hitpay.checkoutUrl });
  } catch (e) {
    await admin.from("member_zone_purchases").update({ status: "failed" }).eq("payment_id", payment.id);
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "hitpay_create_failed" },
      { status: 502 },
    );
  }
}
