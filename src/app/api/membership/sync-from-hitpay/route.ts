import { NextResponse } from "next/server";
import { z } from "zod";
import { getHitpayRecurringBilling } from "@/lib/hitpay";
import { normalizeHitpayRecurringBillingStatus } from "@/lib/hitpayRecurringStatus";
import { getHitpayConfigIssue } from "@/lib/paymentErrors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({ subscription_id: z.string().uuid() });

/**
 * Pulls recurring-billing status from HitPay and updates `customer_subscriptions`
 * (fallback when webhooks are delayed, misconfigured, or reference/id lookup failed).
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
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("customer_subscriptions")
    .select("id, studio_id, client_id, recurring_billing_id, reference_code, status, payment_method_attached_at")
    .eq("id", parsed.data.subscription_id)
    .eq("client_id", user.id)
    .maybeSingle();

  if (!row?.reference_code?.trim()) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  const { data: studio } = await admin
    .from("studios")
    .select("hitpay_enabled")
    .eq("id", row.studio_id)
    .maybeSingle();
  const { data: secrets } = await admin
    .from("studio_payment_secrets")
    .select("hitpay_api_key")
    .eq("studio_id", row.studio_id)
    .maybeSingle();

  const configIssue = getHitpayConfigIssue({
    hitpayEnabled: studio?.hitpay_enabled,
    merchantApiKey: secrets?.hitpay_api_key,
  });
  if (configIssue) {
    return NextResponse.json(
      { error: configIssue.error, error_detail: configIssue.error_detail },
      { status: configIssue.status },
    );
  }

  let remote: Awaited<ReturnType<typeof getHitpayRecurringBilling>>;
  try {
    remote = await getHitpayRecurringBilling({
      apiKey: secrets!.hitpay_api_key!.trim(),
      reference: row.reference_code.trim(),
      recurringBillingId: row.recurring_billing_id?.trim() ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "hitpay_sync_failed";
    return NextResponse.json({ error: "hitpay_lookup_failed", detail: msg }, { status: 502 });
  }

  const next = normalizeHitpayRecurringBillingStatus(remote.status);
  const nowIso = new Date().toISOString();
  const gatewayPayload = JSON.stringify({
    source: "hitpay_recurring_get",
    fetched_at: nowIso,
    remote,
  });

  const update: Record<string, string | null> = {
    gateway_payload: gatewayPayload,
    updated_at: nowIso,
  };
  if (next) {
    update.status = next;
    if (next === "active" && !row.payment_method_attached_at) {
      update.payment_method_attached_at = nowIso;
    }
  }

  await admin.from("customer_subscriptions").update(update).eq("id", row.id);

  const { data: refreshed } = await admin.from("customer_subscriptions").select("status").eq("id", row.id).maybeSingle();

  return NextResponse.json({
    ok: true,
    hitpay_status: remote.status ?? null,
    subscription_status: refreshed?.status ?? null,
  });
}
