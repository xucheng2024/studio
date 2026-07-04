import type { SupabaseClient } from "@supabase/supabase-js";
import { sendGiftNotice, sendPurchaseConfirmation, sendRefundNotice } from "@/lib/email";
import { getStudioPublicUrl } from "@/lib/app-url";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import {
  cancelPendingPaymentLifecycle,
  settlePaidShopOrder,
  syncMemberZonePurchasePaymentStatus,
  syncServiceOrderPaymentStatus,
  syncShopOrderPaymentStatus,
} from "@/lib/paymentStatusTransitions";
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
  const paymentPatch: Record<string, string | null> = {
    gateway_status: providerStatus || null,
    gateway_payload: gatewayPayload,
  };
  if (providerPaymentId) {
    paymentPatch.gateway_refund_payment_id = providerPaymentId;
  }

  await admin
    .from("payments")
    .update(paymentPatch)
    .eq("id", payment.id);

  if (providerStatus === "completed" || providerStatus === "succeeded" || providerStatus === "paid") {
    const buyerClientId = await ensurePaymentClientId(admin, payment.id);

    // Gift flow: re-assign client_id to the recipient before confirming.
    const { data: giftRow } = await admin
      .from("payments")
      .select("is_gift, gift_recipient_email, gift_recipient_name, gift_message, guest_name, guest_email, package_name_snapshot, membership_name_snapshot, shop_product_name_snapshot, service_title_snapshot, source, client_id, amount, currency, reference_code")
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
        shop_product_name_snapshot: string | null;
        service_title_snapshot: string | null;
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
      // Store the original buyer before overwriting client_id with the recipient.
      await admin.from("payments").update({
        client_id: recipientClientId,
        buyer_client_id: buyerClientId ?? null,
      }).eq("id", payment.id);
      if (payment.booking_id) {
        await admin.from("bookings").update({ client_id: recipientClientId }).eq("id", payment.booking_id);
      }
      if (payment.event_booking_id) {
        await admin.from("event_bookings").update({ client_id: recipientClientId }).eq("id", payment.event_booking_id);
      }
      await admin.from("member_zone_purchases").update({ client_id: recipientClientId }).eq("payment_id", payment.id);
      await admin.from("shop_orders").update({ client_id: recipientClientId }).eq("payment_id", payment.id);
      await admin.from("service_orders").update({ client_id: recipientClientId }).eq("payment_id", payment.id);
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
    await syncMemberZonePurchasePaymentStatus(admin, payment.id, "paid");
    await syncServiceOrderPaymentStatus(admin, payment.id, "paid");
    const shopResult = await settlePaidShopOrder(admin, {
      paymentId: payment.id,
      studioId: payment.studio_id,
      ownerId: studio?.owner_id ?? null,
    });
    if (
      shopResult.kind === "in_flight" ||
      shopResult.kind === "lost_race" ||
      shopResult.kind === "refunded_out_of_stock"
    ) {
      return;
    }

    // Fetch studio info (needed for both gift + buyer confirmation emails).
    const { data: studioRow } = await admin
      .from("studios")
      .select("name, public_slug, custom_domain, custom_domain_status")
      .eq("id", payment.studio_id)
      .maybeSingle<{
        name: string;
        public_slug: string;
        custom_domain: string | null;
        custom_domain_status: string | null;
      }>();
    const studioName = studioRow?.name ?? "the studio";
    const loginUrl = studioRow?.public_slug
      ? getStudioPublicUrl(studioRow.public_slug, "", studioRow.custom_domain, studioRow.custom_domain_status)
      : (process.env.NEXT_PUBLIC_APP_URL ?? "");
    const shopOrdersUrl = studioRow?.public_slug
      ? getStudioPublicUrl(studioRow.public_slug, "me/orders", studioRow.custom_domain, studioRow.custom_domain_status)
      : loginUrl;

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
      giftRow?.shop_product_name_snapshot ??
      giftRow?.service_title_snapshot ??
      (giftRow?.source === "online_booking"
        ? "a class booking"
        : giftRow?.source === "event_booking"
          ? "an event booking"
          : giftRow?.source === "member_zone_purchase"
            ? "member zone access"
            : giftRow?.source === "shop_purchase"
              ? "a shop order"
              : giftRow?.source === "service_purchase"
                ? "a service order"
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
        loginUrl: giftRow.source === "shop_purchase" ? shopOrdersUrl : loginUrl,
        orderCategory: giftRow.source === "shop_purchase" ? "shop" : "general",
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
        orderCategory: giftRow?.source === "shop_purchase" ? "shop" : "general",
        isGift: giftRow?.is_gift ?? false,
        giftRecipientEmail: giftRow?.gift_recipient_email,
        loginUrl,
      });
    }
    return;
  }

  if (providerStatus === "failed" || providerStatus === "canceled" || providerStatus === "cancelled") {
    await cancelPendingPaymentLifecycle(admin, payment, "failed");
    return;
  }

  if (providerStatus === "expired") {
    await cancelPendingPaymentLifecycle(admin, payment, "expired");
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
    } else {
      await admin
        .from("payments")
        .update({ status: "refunded", updated_at: new Date().toISOString() })
        .eq("id", payment.id);
    }
    await syncMemberZonePurchasePaymentStatus(admin, payment.id, "refunded");
    await syncShopOrderPaymentStatus(admin, payment.id, "refunded");
    await syncServiceOrderPaymentStatus(admin, payment.id, "refunded");

    // Send refund notification to buyer (non-blocking).
    if (previousStatus !== "refunded") {
      const { data: refundRow } = await admin
        .from("payments")
        .select("guest_name, guest_email, client_id, buyer_client_id, amount, currency, reference_code, package_name_snapshot, membership_name_snapshot, shop_product_name_snapshot, service_title_snapshot, source, is_gift, gift_recipient_email")
        .eq("id", payment.id)
        .maybeSingle<{
          guest_name: string | null;
          guest_email: string | null;
          client_id: string | null;
          buyer_client_id: string | null;
          amount: number | null;
          currency: string | null;
          reference_code: string | null;
          package_name_snapshot: string | null;
          membership_name_snapshot: string | null;
          shop_product_name_snapshot: string | null;
          service_title_snapshot: string | null;
          source: string | null;
          is_gift: boolean | null;
          gift_recipient_email: string | null;
        }>();
      if (refundRow) {
        let refundBuyerName: string | null = refundRow.guest_name;
        let refundBuyerEmail: string | null = refundRow.guest_email;
        // For gift payments, resolve the original buyer via buyer_client_id (set at confirmation
        // time before client_id is overwritten with the recipient). Fall back to client_id for
        // non-gift payments or legacy rows where buyer_client_id was not yet populated.
        const resolveClientId = refundRow.is_gift && refundRow.buyer_client_id
          ? refundRow.buyer_client_id
          : refundRow.client_id;
        if (resolveClientId) {
          const [pRes, aRes] = await Promise.all([
            admin.from("user_profiles").select("full_name").eq("id", resolveClientId).maybeSingle<{ full_name: string | null }>(),
            admin.from("users").select("email").eq("id", resolveClientId).maybeSingle<{ email: string | null }>(),
          ]);
          refundBuyerName = refundRow.guest_name ?? pRes.data?.full_name ?? null;
          refundBuyerEmail = refundRow.guest_email ?? aRes.data?.email ?? null;
        }
        // Legacy guard: if buyer_client_id was not populated (row predates migration 094)
        // and the resolved email turns out to be the gift recipient, suppress the email
        // rather than notifying the wrong person.
        if (
          refundRow.is_gift &&
          !refundRow.buyer_client_id &&
          !refundRow.guest_email &&
          refundBuyerEmail &&
          refundRow.gift_recipient_email &&
          refundBuyerEmail.toLowerCase() === refundRow.gift_recipient_email.toLowerCase()
        ) {
          refundBuyerEmail = null;
        }
        const { data: refundStudio } = await admin
          .from("studios")
          .select("name")
          .eq("id", payment.studio_id)
          .maybeSingle<{ name: string }>();
        const refundItemDescription =
          refundRow.package_name_snapshot ??
          refundRow.membership_name_snapshot ??
          refundRow.shop_product_name_snapshot ??
          refundRow.service_title_snapshot ??
          (refundRow.source === "online_booking"
            ? "a class booking"
            : refundRow.source === "event_booking"
              ? "an event booking"
              : refundRow.source === "member_zone_purchase"
                ? "member zone access"
                : refundRow.source === "shop_purchase"
                  ? "a shop order"
                  : refundRow.source === "service_purchase"
                    ? "a service order"
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
            orderCategory: refundRow.source === "shop_purchase" ? "shop" : "general",
          });
        }
      }
    }
  }
}
