import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export const POS_OPERATION_FAILURE_CODES = [
  "void_pos_sale_failed",
  "refund_pos_sale_failed",
  "refund_pos_sale_items_failed",
] as const;

export type PosOperationFailureCode = (typeof POS_OPERATION_FAILURE_CODES)[number];

export async function recordPosOperationFailure(input: {
  operation: "void_pos_sale" | "refund_pos_sale" | "refund_pos_sale_items";
  code: PosOperationFailureCode;
  detail?: string | null;
  studioId?: string | null;
  locationId?: string | null;
  saleId?: string | null;
  paymentId?: string | null;
  safePayload?: unknown;
}) {
  const admin = createAdminClient();
  const payload = {
    operation: input.operation,
    code: input.code,
    detail: input.detail?.slice(0, 1000) ?? null,
    sale_id: input.saleId ?? null,
    payment_id: input.paymentId ?? null,
  };

  const { error } = await admin
    .from("pos_operation_failures")
    .insert({
      studio_id: input.studioId ?? null,
      location_id: input.locationId ?? null,
      sale_id: input.saleId ?? null,
      payment_id: input.paymentId ?? null,
      operation: input.operation,
      error_code: input.code,
      error_detail: input.detail?.slice(0, 1000) ?? null,
      safe_payload: input.safePayload ?? payload,
    });

  if (error) {
    console.error("[pos_operation_failures] insert failed", {
      error: error.message,
      payload,
    });
  }
}
