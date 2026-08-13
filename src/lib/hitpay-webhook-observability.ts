import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const HITPAY_WEBHOOK_FAILURE_CODES = [
  "invalid_signature",
  "provider_event_claim_failed",
  "complete_pos_hitpay_sale_failed",
] as const;

export type HitpayWebhookFailureCode = (typeof HITPAY_WEBHOOK_FAILURE_CODES)[number];

export async function recordHitpayWebhookFailure(input: {
  code: HitpayWebhookFailureCode;
  detail?: string | null;
  studioId?: string | null;
  locationId?: string | null;
  paymentId?: string | null;
  providerEventId?: string | null;
  providerPaymentId?: string | null;
  referenceCode?: string | null;
  eventObject?: string | null;
  eventType?: string | null;
  payloadHash?: string | null;
  safePayload?: unknown;
}) {
  const admin = createAdminClient();
  const payload = {
    code: input.code,
    detail: input.detail?.slice(0, 1000) ?? null,
    provider_event_id: input.providerEventId ?? null,
    provider_payment_id: input.providerPaymentId ?? null,
    reference_code: input.referenceCode ?? null,
    event_object: input.eventObject ?? null,
    event_type: input.eventType ?? null,
  };

  const { error } = await admin
    .from("hitpay_webhook_failures")
    .insert({
      provider: "hitpay",
      studio_id: input.studioId ?? null,
      location_id: input.locationId ?? null,
      payment_id: input.paymentId ?? null,
      provider_event_id: input.providerEventId ?? null,
      provider_payment_id: input.providerPaymentId ?? null,
      reference_code: input.referenceCode ?? null,
      event_object: input.eventObject ?? null,
      event_type: input.eventType ?? null,
      error_code: input.code,
      error_detail: input.detail?.slice(0, 1000) ?? null,
      payload_hash: input.payloadHash ?? null,
      safe_payload: input.safePayload ?? payload,
    });

  if (error) {
    console.error("[hitpay_webhook_failures] insert failed", {
      error: error.message,
      payload,
    });
  }
}
