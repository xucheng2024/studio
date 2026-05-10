import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { ensurePaymentClientId } from "@/lib/resolveClientId";

export type HitpayPaymentRequestRow = {
  id: string;
  studio_id: string;
  booking_id?: string | null;
  event_booking_id?: string | null;
};

/**
 * Applies HitPay payment-request status to our `payments` row and runs the same
 * confirmation / cancellation paths as `POST /api/payment/hitpay/webhook`.
 * Idempotent when the payment is already `paid` (RPCs return already_paid).
 */
export async function applyHitpayPaymentRequestStatus(
  admin: SupabaseClient,
  payment: HitpayPaymentRequestRow,
  studio: { owner_id?: string | null } | null | undefined,
  providerStatusRaw: string,
  gatewayPayload: string | null,
  providerPaymentId: string | null,
): Promise<void> {
  const providerStatus = providerStatusRaw.trim().toLowerCase();

  await admin
    .from("payments")
    .update({
      gateway_status: providerStatus || null,
      gateway_payload: gatewayPayload,
      gateway_refund_payment_id: providerPaymentId,
    })
    .eq("id", payment.id);

  if (providerStatus === "completed" || providerStatus === "succeeded" || providerStatus === "paid") {
    const clientId = await ensurePaymentClientId(admin, payment.id);
    if (clientId) {
      await upsertMemberStudioMembership(admin, {
        userId: clientId,
        studioId: payment.studio_id,
      });
    }
    const ownerId = studio?.owner_id ?? null;
    if (ownerId) {
      if (payment.event_booking_id) {
        await admin.rpc("confirm_event_payment_with_invoice", {
          p_payment_id: payment.id,
          p_verified_by: ownerId,
        });
      } else {
        await admin.rpc("confirm_payment_with_invoice", {
          p_payment_id: payment.id,
          p_verified_by: ownerId,
        });
      }
    } else {
      if (payment.event_booking_id) {
        await admin.rpc("confirm_event_payment", {
          p_payment_id: payment.id,
        });
      } else {
        await admin.rpc("confirm_payment", {
          p_payment_id: payment.id,
        });
      }
    }
    await admin
      .from("member_zone_purchases")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_id", payment.id);
    return;
  }

  if (providerStatus === "failed" || providerStatus === "canceled" || providerStatus === "cancelled") {
    if (payment.event_booking_id) {
      await admin.rpc("cancel_pending_event_payment", { p_payment_id: payment.id, p_new_status: "failed" });
    } else {
      await admin.rpc("cancel_pending_payment", { p_payment_id: payment.id, p_new_status: "failed" });
    }
    await admin
      .from("member_zone_purchases")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("payment_id", payment.id);
    return;
  }

  if (providerStatus === "expired") {
    if (payment.event_booking_id) {
      await admin.rpc("cancel_pending_event_payment", { p_payment_id: payment.id, p_new_status: "expired" });
    } else {
      await admin.rpc("cancel_pending_payment", { p_payment_id: payment.id, p_new_status: "expired" });
    }
    await admin
      .from("member_zone_purchases")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("payment_id", payment.id);
    return;
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
    await admin
      .from("member_zone_purchases")
      .update({
        status: "refunded",
        refunded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_id", payment.id);
  }
}
