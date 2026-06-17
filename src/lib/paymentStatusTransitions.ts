import type { SupabaseClient } from "@supabase/supabase-js";
import { sendRefundNotice } from "@/lib/email";

export type PaymentLifecycleStatus = "paid" | "failed" | "expired" | "refunded";
type ShopOrderDirectStatus = Exclude<PaymentLifecycleStatus, "paid">;

export type PaymentLifecycleRow = {
  id: string;
  studio_id?: string | null;
  event_booking_id?: string | null;
};

type StatusUpdateOptions = {
  nowIso?: string;
};

export async function syncMemberZonePurchasePaymentStatus(
  admin: SupabaseClient,
  paymentId: string,
  status: PaymentLifecycleStatus,
  options: StatusUpdateOptions = {},
) {
  const nowIso = options.nowIso ?? new Date().toISOString();

  const memberZonePatch: Record<string, string> = {
    status,
    updated_at: nowIso,
  };
  if (status === "paid") memberZonePatch.paid_at = nowIso;
  if (status === "refunded") memberZonePatch.refunded_at = nowIso;

  await admin
    .from("member_zone_purchases")
    .update(memberZonePatch)
    .eq("payment_id", paymentId);
}

export async function syncShopOrderPaymentStatus(
  admin: SupabaseClient,
  paymentId: string,
  status: ShopOrderDirectStatus,
  options: StatusUpdateOptions = {},
) {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const shopPatch: Record<string, string> = {
    status,
    updated_at: nowIso,
  };
  if (status === "refunded") shopPatch.refunded_at = nowIso;

  await admin
    .from("shop_orders")
    .update(shopPatch)
    .eq("payment_id", paymentId);
}

type SettlePaidShopOrderParams = {
  paymentId: string;
  studioId: string;
  ownerId?: string | null;
};

export async function settlePaidShopOrder(
  admin: SupabaseClient,
  params: SettlePaidShopOrderParams,
) {
  const nowIso = new Date().toISOString();
  const { data: shopOrder } = await admin
    .from("shop_orders")
    .select("id, product_id, qty, status")
    .eq("payment_id", params.paymentId)
    .maybeSingle<{ id: string; product_id: string; qty: number; status: string }>();

  if (!shopOrder?.id) {
    return { ok: true as const, kind: "noop" as const };
  }
  if (shopOrder.status === "processing") {
    return { ok: true as const, kind: "in_flight" as const };
  }
  if (shopOrder.status !== "pending") {
    return { ok: true as const, kind: "terminal" as const };
  }

  const { data: claimed } = await admin
    .from("shop_orders")
    .update({ status: "processing", updated_at: nowIso })
    .eq("id", shopOrder.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (!claimed) {
    return { ok: true as const, kind: "lost_race" as const };
  }

  const { data: stockOk } = await admin.rpc("decrement_shop_product_stock", {
    p_product_id: shopOrder.product_id,
    p_qty: shopOrder.qty ?? 1,
  });

  if (stockOk === false) {
    if (params.ownerId) {
      await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: params.paymentId,
        p_operator_id: params.ownerId,
        p_reason: "shop_out_of_stock",
      });
    } else {
      await admin
        .from("payments")
        .update({ status: "refunded", updated_at: nowIso })
        .eq("id", params.paymentId);
    }

    await admin
      .from("shop_orders")
      .update({ status: "refunded", updated_at: nowIso, refunded_at: nowIso })
      .eq("id", shopOrder.id)
      .eq("status", "processing");

    const { data: paymentDetails } = await admin
      .from("payments")
      .select("guest_email, guest_name, client_id, amount, currency, reference_code, shop_product_name_snapshot")
      .eq("id", params.paymentId)
      .maybeSingle<{
        guest_email: string | null;
        guest_name: string | null;
        client_id: string | null;
        amount: number | null;
        currency: string | null;
        reference_code: string | null;
        shop_product_name_snapshot: string | null;
      }>();
    const { data: studio } = await admin
      .from("studios")
      .select("name")
      .eq("id", params.studioId)
      .maybeSingle<{ name: string }>();

    let buyerEmail = paymentDetails?.guest_email ?? null;
    let buyerName = paymentDetails?.guest_name ?? null;
    if (!buyerEmail && paymentDetails?.client_id) {
      const [profileRes, authRes] = await Promise.all([
        admin.from("user_profiles").select("full_name").eq("id", paymentDetails.client_id).maybeSingle<{ full_name: string | null }>(),
        admin.from("users").select("email").eq("id", paymentDetails.client_id).maybeSingle<{ email: string | null }>(),
      ]);
      buyerName = buyerName ?? profileRes.data?.full_name ?? null;
      buyerEmail = authRes.data?.email ?? null;
    }

    if (buyerEmail) {
      void sendRefundNotice({
        to: buyerEmail,
        buyerName,
        studioName: studio?.name ?? "the studio",
        itemDescription: paymentDetails?.shop_product_name_snapshot ?? "a shop order",
        amount: paymentDetails?.amount ?? 0,
        currency: paymentDetails?.currency ?? "SGD",
        referenceCode: paymentDetails?.reference_code,
        orderCategory: "shop",
      });
    }

    return { ok: true as const, kind: "refunded_out_of_stock" as const };
  }

  await admin
    .from("shop_orders")
    .update({
      status: "paid",
      paid_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", shopOrder.id)
    .eq("status", "processing");

  return { ok: true as const, kind: "paid" as const };
}

export async function cancelPendingPaymentLifecycle(
  admin: SupabaseClient,
  payment: PaymentLifecycleRow,
  nextStatus: Extract<PaymentLifecycleStatus, "failed" | "expired">,
) {
  const rpcResult = await admin.rpc(
    payment.event_booking_id ? "cancel_pending_event_payment" : "cancel_pending_payment",
    {
      p_payment_id: payment.id,
      p_new_status: nextStatus,
    },
  );

  const result = rpcResult as {
    data?: { ok?: boolean; error?: string } | null;
    error?: { message?: string } | null;
  };
  if (result.error) {
    return { ok: false as const, error: result.error.message ?? "cancel_failed", kind: "rpc" as const };
  }

  const payload = result.data ?? null;
  if (!payload?.ok) {
    return { ok: false as const, error: payload?.error ?? "cancel_failed", kind: "domain" as const };
  }

  await syncMemberZonePurchasePaymentStatus(admin, payment.id, nextStatus);
  await syncShopOrderPaymentStatus(admin, payment.id, nextStatus);
  return { ok: true as const };
}
