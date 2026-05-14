import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftNotice, sendPurchaseConfirmation, sendRefundNotice } from "@/lib/email";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { ensurePaymentClientId, resolveClientIdByEmail } from "@/lib/resolveClientId";

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
  const { data: statusBeforeUpdate } = await admin
    .from("payments")
    .select("status")
    .eq("id", payment.id)
    .maybeSingle<{ status: string | null }>();
  const previousStatus = String(statusBeforeUpdate?.status ?? "").trim().toLowerCase();

  await admin
    .from("payments")
    .update({
      gateway_status: providerStatus || null,
      gateway_payload: gatewayPayload,
      gateway_refund_payment_id: providerPaymentId,
    })
    .eq("id", payment.id);

  if (providerStatus === "completed" || providerStatus === "succeeded" || providerStatus === "paid") {
    const buyerClientId = await ensurePaymentClientId(admin, payment.id);

    // Gift flow: re-assign client_id to the recipient before confirming.
    const { data: giftRow } = await admin
      .from("payments")
      .select("is_gift, gift_recipient_email, gift_recipient_name, gift_message, guest_name, guest_email, package_name_snapshot, membership_name_snapshot, source, client_id, amount, currency, reference_code")
      .eq("id", payment.id)
      .maybeSingle<{
        is_gift: boolean;
        gift_recipient_email: string | null;
        gift_recipient_name: string | null;
        gift_message: string | null;
        guest_name: string | null;
        guest_email: string | null;
        package_name_snapshot: string | null;
        membership_name_snapshot: string | null;
        source: string | null;
        client_id: string | null;
        amount: number | null;
        currency: string | null;
        reference_code: string | null;
      }>();

    let effectiveClientId = buyerClientId;
    if (giftRow?.is_gift && giftRow.gift_recipient_email) {
      const recipientClientId = await resolveClientIdByEmail(admin, {
        email: giftRow.gift_recipient_email,
        name: giftRow.gift_recipient_name ?? undefined,
      });
      await admin.from("payments").update({ client_id: recipientClientId }).eq("id", payment.id);
      if (payment.booking_id) {
        await admin.from("bookings").update({ client_id: recipientClientId }).eq("id", payment.booking_id);
      }
      if (payment.event_booking_id) {
        await admin.from("event_bookings").update({ client_id: recipientClientId }).eq("id", payment.event_booking_id);
      }
      await admin.from("member_zone_purchases").update({ client_id: recipientClientId }).eq("payment_id", payment.id);
      effectiveClientId = recipientClientId;
    }

    if (effectiveClientId) {
      await upsertMemberStudioMembership(admin, {
        userId: effectiveClientId,
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

    // Fetch studio info (needed for both gift + buyer confirmation emails).
    const { data: studioRow } = await admin
      .from("studios")
      .select("name, public_slug")
      .eq("id", payment.studio_id)
      .maybeSingle<{ name: string; public_slug: string }>();
    const studioName = studioRow?.name ?? "the studio";
    const loginUrl = studioRow?.public_slug
      ? `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/${studioRow.public_slug}`
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");

    // For logged-in buyers guest_name/guest_email is null; look up profile instead.
    const buyerOriginalClientId = giftRow?.client_id ?? buyerClientId;
    let buyerProfileName: string | null = null;
    let buyerProfileEmail: string | null = null;
    if (buyerOriginalClientId) {
      const [profileRes, authRes] = await Promise.all([
        admin.from("user_profiles").select("full_name").eq("id", buyerOriginalClientId).maybeSingle<{ full_name: string | null }>(),
        admin.from("users").select("email").eq("id", buyerOriginalClientId).maybeSingle<{ email: string | null }>(),
      ]);
      buyerProfileName = profileRes.data?.full_name ?? null;
      buyerProfileEmail = authRes.data?.email ?? null;
    }
    const buyerName = giftRow?.guest_name ?? buyerProfileName;
    const buyerEmail = giftRow?.guest_email ?? buyerProfileEmail;

    const itemDescription =
      giftRow?.package_name_snapshot ??
      giftRow?.membership_name_snapshot ??
      (giftRow?.source === "online_booking"
        ? "a class booking"
        : giftRow?.source === "event_booking"
          ? "an event booking"
          : giftRow?.source === "member_zone_purchase"
            ? "member zone access"
            : "a purchase");

    const shouldSendPaidEmails = previousStatus !== "paid";
    // Send gift notification to recipient (non-blocking).
    if (shouldSendPaidEmails && giftRow?.is_gift && giftRow.gift_recipient_email) {
      const senderProfileName = !giftRow.guest_name ? buyerProfileName : null;
      void sendGiftNotice({
        to: giftRow.gift_recipient_email,
        recipientName: giftRow.gift_recipient_name,
        senderName: giftRow.guest_name,
        senderProfileName,
        studioName,
        itemDescription,
        giftMessage: giftRow.gift_message,
        loginUrl,
      });
    }

    // Send purchase confirmation to buyer (non-blocking).
    if (shouldSendPaidEmails && buyerEmail) {
      void sendPurchaseConfirmation({
        to: buyerEmail,
        buyerName,
        studioName,
        itemDescription,
        amount: giftRow?.amount ?? 0,
        currency: giftRow?.currency ?? "SGD",
        referenceCode: giftRow?.reference_code,
        isGift: giftRow?.is_gift ?? false,
        giftRecipientEmail: giftRow?.gift_recipient_email,
        loginUrl,
      });
    }
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

    // Send refund notification to buyer (non-blocking).
    if (previousStatus !== "refunded") {
      const { data: refundRow } = await admin
        .from("payments")
        .select("guest_name, guest_email, client_id, amount, currency, reference_code, package_name_snapshot, membership_name_snapshot, source")
        .eq("id", payment.id)
        .maybeSingle<{
          guest_name: string | null;
          guest_email: string | null;
          client_id: string | null;
          amount: number | null;
          currency: string | null;
          reference_code: string | null;
          package_name_snapshot: string | null;
          membership_name_snapshot: string | null;
          source: string | null;
        }>();
      if (refundRow) {
        let refundBuyerName: string | null = refundRow.guest_name;
        let refundBuyerEmail: string | null = refundRow.guest_email;
        if (refundRow.client_id) {
          const [pRes, aRes] = await Promise.all([
            admin.from("user_profiles").select("full_name").eq("id", refundRow.client_id).maybeSingle<{ full_name: string | null }>(),
            admin.from("users").select("email").eq("id", refundRow.client_id).maybeSingle<{ email: string | null }>(),
          ]);
          refundBuyerName = refundRow.guest_name ?? pRes.data?.full_name ?? null;
          refundBuyerEmail = refundRow.guest_email ?? aRes.data?.email ?? null;
        }
        const { data: refundStudio } = await admin
          .from("studios")
          .select("name")
          .eq("id", payment.studio_id)
          .maybeSingle<{ name: string }>();
        const refundItemDescription =
          refundRow.package_name_snapshot ??
          refundRow.membership_name_snapshot ??
          (refundRow.source === "online_booking"
            ? "a class booking"
            : refundRow.source === "event_booking"
              ? "an event booking"
              : refundRow.source === "member_zone_purchase"
                ? "member zone access"
                : "a purchase");
        if (refundBuyerEmail) {
          void sendRefundNotice({
            to: refundBuyerEmail,
            buyerName: refundBuyerName,
            studioName: refundStudio?.name ?? "the studio",
            itemDescription: refundItemDescription,
            amount: refundRow.amount ?? 0,
            currency: refundRow.currency ?? "SGD",
            referenceCode: refundRow.reference_code,
          });
        }
      }
    }
  }
}
