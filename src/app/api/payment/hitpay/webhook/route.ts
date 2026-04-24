import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyHitpayWebhookSignature } from "@/lib/hitpay";

type HitpayWebhookPayload = {
  payment_request_id?: string;
  payment_id?: string;
  charge_id?: string;
  status?: string;
  reference_number?: string;
  currency?: string;
  amount?: string;
};

function parseWebhookPayload(rawBody: string): HitpayWebhookPayload {
  try {
    return JSON.parse(rawBody) as HitpayWebhookPayload;
  } catch {
    const form = new URLSearchParams(rawBody);
    return {
      payment_request_id: form.get("payment_request_id") ?? undefined,
      payment_id: form.get("payment_id") ?? undefined,
      charge_id: form.get("charge_id") ?? undefined,
      status: form.get("status") ?? undefined,
      reference_number: form.get("reference_number") ?? undefined,
      currency: form.get("currency") ?? undefined,
      amount: form.get("amount") ?? undefined,
    };
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hitpay-signature");
  const payload = parseWebhookPayload(rawBody);
  const providerId = payload.payment_request_id?.trim() || null;
  const providerPaymentId = payload.payment_id?.trim() || payload.charge_id?.trim() || null;
  const referenceCode = payload.reference_number?.trim() || null;
  const providerStatus = (payload.status ?? "").trim().toLowerCase();
  if (!providerId && !referenceCode) {
    return NextResponse.json({ error: "missing_payment_reference" }, { status: 400 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("payments")
    .select("id, status, reference_code, gateway_payment_id, studio_id, studios(owner_id)")
    .limit(1);
  if (providerId) {
    query = query.eq("gateway_payment_id", providerId);
  } else {
    query = query.eq("reference_code", referenceCode);
  }
  const { data: payment } = await query.maybeSingle();
  if (!payment?.id) {
    return NextResponse.json({ ok: true });
  }
  const studios = payment.studios as
    | { owner_id?: string | null }
    | { owner_id?: string | null }[]
    | null;
  const studio = Array.isArray(studios) ? studios[0] : studios;
  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_webhook_salt")
    .eq("studio_id", payment.studio_id)
    .maybeSingle();
  const verified = verifyHitpayWebhookSignature(rawBody, signature, secrets?.hitpay_webhook_salt ?? null);
  if (!verified) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  await admin
    .from("payments")
    .update({
      gateway_status: providerStatus || null,
      gateway_payload: rawBody,
      gateway_refund_payment_id: providerPaymentId,
    })
    .eq("id", payment.id);

  if (providerStatus === "completed" || providerStatus === "succeeded") {
    const ownerId = studio?.owner_id ?? null;
    if (ownerId) {
      await admin.rpc("confirm_payment_with_invoice", {
        p_payment_id: payment.id,
        p_verified_by: ownerId,
      });
    } else {
      await admin.rpc("confirm_payment", {
        p_payment_id: payment.id,
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "failed" || providerStatus === "canceled" || providerStatus === "cancelled") {
    await admin.rpc("cancel_pending_payment", {
      p_payment_id: payment.id,
      p_new_status: "failed",
    });
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "expired") {
    await admin.rpc("cancel_pending_payment", {
      p_payment_id: payment.id,
      p_new_status: "expired",
    });
    return NextResponse.json({ ok: true });
  }

  if (providerStatus === "refunded") {
    const ownerId = studio?.owner_id ?? null;
    if (ownerId) {
      await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: payment.id,
        p_operator_id: ownerId,
        p_reason: "hitpay_webhook_refund",
      });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
