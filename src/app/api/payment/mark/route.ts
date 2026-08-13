import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertMemberStudioMembership } from "@/lib/member-studio";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeOperationAudit } from "@/lib/audit";
import { sendPaymentResultNotice } from "@/lib/email";
import { refundHitpayPayment } from "@/lib/hitpay";
import {
  cancelPendingPaymentLifecycle,
  settlePaidShopOrder,
  syncMemberZonePurchasePaymentStatus,
  syncServiceOrderPaymentStatus,
  syncShopOrderPaymentStatus,
} from "@/lib/paymentStatusTransitions";
import { recordPosOperationFailure } from "@/lib/pos-operation-observability";
import { ensurePaymentClientId } from "@/lib/resolveClientId";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  status: z.enum(["paid", "failed", "expired", "refunded"]),
  refund_reason: z.string().max(500).optional(),
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
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: payment, error: pErr } = await admin
    .from("payments")
    .select(
      `
      id,
      studio_id,
      location_id,
      booking_id,
      event_booking_id,
      customer_subscription_id,
      source,
      pos_sale_id,
      payment_method,
      amount,
      pos_sale_id,
      gateway_payment_id,
      gateway_refund_payment_id,
      studios ( owner_id )
    `,
    )
    .eq("id", parsed.data.payment_id)
    .single();

  if (pErr || !payment) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  if (!payment.studio_id) {
    return NextResponse.json({ error: "invalid_payment_scope" }, { status: 409 });
  }
  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: payment.studio_id,
    locationId: payment.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) {
    return staffScopeFailureResponse(scoped);
  }
  if (parsed.data.status === "refunded" && scoped.role === "frontdesk") {
    return NextResponse.json(
      { error: "forbidden", message: "Only owners and managers can refund payments." },
      { status: 403 },
    );
  }

  if (parsed.data.status === "paid") {
    if (payment.source === "membership_subscription") {
      return NextResponse.json(
        {
          error: "membership_payment_manual_update_not_supported",
          message: "Manage membership charges from the Memberships page so subscription access stays in sync.",
        },
        { status: 409 },
      );
    }
    const clientId = await ensurePaymentClientId(admin, parsed.data.payment_id);
    if (clientId) {
      await upsertMemberStudioMembership(admin, {
        userId: clientId,
        studioId: payment.studio_id,
      });
    }
    const { data: result, error } = await admin.rpc(
      payment.event_booking_id ? "confirm_event_payment_with_invoice" : "confirm_payment_with_invoice",
      {
        p_payment_id: parsed.data.payment_id,
        p_verified_by: user.id,
      },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const r = result as { ok?: boolean; error?: string; invoice_number?: string };
    if (!r?.ok) return NextResponse.json({ error: r?.error ?? "confirm_failed" }, { status: 409 });
    const invoiceNumber = r.invoice_number ?? null;

    await writeOperationAudit({
      actorId: user.id,
      actorRole: "staff",
      action: "payment_mark_paid",
      targetType: "payment",
      targetId: parsed.data.payment_id,
      beforeState: { status: "pending" },
      afterState: { status: "paid", invoice_number: invoiceNumber },
    });
    if (payment.booking_id) {
      const { data: booking } = await admin
        .from("bookings")
        .select("client_id, guest_email")
        .eq("id", payment.booking_id)
        .maybeSingle();
      let to: string | null = booking?.guest_email ?? null;
      if (booking?.client_id) {
        const { data: u } = await admin.from("users").select("email").eq("id", booking.client_id).maybeSingle();
        to = u?.email ?? to;
      }
      if (to) {
        await sendPaymentResultNotice({
          to,
          status: "paid",
          reference: null,
        });
      }
    }
    await syncMemberZonePurchasePaymentStatus(admin, parsed.data.payment_id, "paid");
    await syncServiceOrderPaymentStatus(admin, parsed.data.payment_id, "paid");
    await settlePaidShopOrder(admin, {
      paymentId: parsed.data.payment_id,
      studioId: payment.studio_id,
      ownerId: user.id,
    });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.status === "refunded") {
    const logRefundPosFailure = async (errorCode: string, detail: string) => {
      if (!payment.pos_sale_id) return;
      await recordPosOperationFailure({
        operation: "refund_pos_sale",
        code: "refund_pos_sale_failed",
        detail: `${errorCode}:${detail}`,
        studioId: payment.studio_id,
        locationId: payment.location_id ?? null,
        saleId: payment.pos_sale_id,
        paymentId: parsed.data.payment_id,
        safePayload: {
          payment_method: payment.payment_method,
          source: payment.source,
        },
      });
    };

    if (payment.source === "membership_subscription" || payment.customer_subscription_id) {
      return NextResponse.json(
        {
          error: "membership_payment_manual_refund_not_supported",
          message: "Refund membership charges from the Memberships page so recurring access and billing stay in sync.",
        },
        { status: 409 },
      );
    }
    if (Number(payment.amount ?? 0) <= 0) {
      return NextResponse.json(
        {
          error: "zero_amount_not_refundable",
          message: "Zero-amount payments cannot be refunded.",
        },
        { status: 409 },
      );
    }
    if ((payment.payment_method ?? "").toLowerCase() === "hitpay") {
      const { data: secrets } = await admin
        .from("studio_payment_secrets")
        .select("hitpay_api_key")
        .eq("studio_id", payment.studio_id)
        .maybeSingle();
      const apiKey = secrets?.hitpay_api_key ?? null;
      if (!apiKey) {
        await logRefundPosFailure("hitpay_not_configured", "missing studio hitpay api key");
        return NextResponse.json(
          {
            error: "hitpay_not_configured",
            message: "This studio has no HitPay API key configured for automatic refunds.",
          },
          { status: 409 },
        );
      }
      if (!payment.gateway_refund_payment_id) {
        await logRefundPosFailure("gateway_payment_id_missing", "missing gateway_refund_payment_id");
        return NextResponse.json(
          {
            error: "gateway_payment_id_missing",
            message: "Missing settled HitPay payment id. Please process this refund manually.",
          },
          { status: 409 },
        );
      }
      try {
        await refundHitpayPayment({
          apiKey,
          paymentId: payment.gateway_refund_payment_id,
          amount: Number(payment.amount ?? 0),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "hitpay_refund_failed";
        await logRefundPosFailure("hitpay_refund_failed", message);
        const lowered = message.toLowerCase();
        const manual =
          lowered.includes("refund not supported") ||
          lowered.includes("not support") ||
          lowered.includes("exceeded refund period") ||
          lowered.includes("insufficient");
        return NextResponse.json(
          {
            error: manual ? "manual_refund_required" : "hitpay_refund_failed",
            message: manual
              ? "Gateway cannot process automatic refund for this payment method. Please refund manually in back office."
              : `HitPay refund failed: ${message}`,
          },
          { status: 409 },
        );
      }
    }
    const { data: refundResult, error: refundErr } = await admin.rpc("refund_payment_with_invoice_void", {
      p_payment_id: parsed.data.payment_id,
      p_operator_id: user.id,
      p_reason: parsed.data.refund_reason?.trim() || null,
    });
    if (refundErr) {
      await logRefundPosFailure("refund_payment_with_invoice_void_rpc_failed", refundErr.message);
      return NextResponse.json({ error: refundErr.message }, { status: 500 });
    }
    const rr = refundResult as {
      ok?: boolean;
      error?: string;
      already_refunded?: boolean;
      status?: string;
      invoice_status?: string;
      invoice_voided_at?: string | null;
      invoice_void_reason?: string | null;
    };
    if (!rr?.ok) {
      if (rr?.error === "not_paid") {
        await logRefundPosFailure("not_paid", "refund only allowed on paid payments");
        return NextResponse.json(
          { error: "not_paid", message: "Only payments in paid status can be refunded." },
          { status: 409 },
        );
      }
      if (rr?.error === "must_uncheckin_first") {
        await logRefundPosFailure("must_uncheckin_first", "booking is attended");
        return NextResponse.json(
          {
            error: "must_uncheckin_first",
            message: "Guest is checked in. Use Uncheck-in first, then refund.",
          },
          { status: 409 },
        );
      }
      await logRefundPosFailure(rr?.error ?? "refund_failed", "refund rpc returned !ok");
      return NextResponse.json({ error: rr?.error ?? "refund_failed" }, { status: 409 });
    }
    const alreadyRefunded = rr.already_refunded === true;
    if (payment.booking_id && !alreadyRefunded) {
      const { data: booking } = await admin
        .from("bookings")
        .select("client_id, guest_email")
        .eq("id", payment.booking_id)
        .maybeSingle();
      let to: string | null = booking?.guest_email ?? null;
      if (booking?.client_id) {
        const { data: u } = await admin.from("users").select("email").eq("id", booking.client_id).maybeSingle();
        to = u?.email ?? to;
      }
      if (to) {
        await sendPaymentResultNotice({
          to,
          status: "refunded",
          reference: null,
        });
      }
    }
    await syncMemberZonePurchasePaymentStatus(admin, parsed.data.payment_id, "refunded");
    await syncShopOrderPaymentStatus(admin, parsed.data.payment_id, "refunded");
    await syncServiceOrderPaymentStatus(admin, parsed.data.payment_id, "refunded");

    if (payment.pos_sale_id) {
      const { data: posSyncResult, error: posSyncErr } = await admin.rpc("sync_pos_sale_refund_status", {
        p_payment_id: parsed.data.payment_id,
        p_actor_id: user.id,
        p_actor_role: scoped.role,
        p_reason: parsed.data.refund_reason?.trim() || null,
      });
      if (posSyncErr) {
        await logRefundPosFailure("sync_pos_sale_refund_status_rpc_failed", posSyncErr.message);
        return NextResponse.json({ error: posSyncErr.message }, { status: 500 });
      }
      const posPayload = posSyncResult as { ok?: boolean; reason?: string } | null;
      if (!posPayload?.ok) {
        await logRefundPosFailure("sync_pos_sale_refund_status_failed", posPayload?.reason ?? "unknown");
        return NextResponse.json({ error: posPayload?.reason ?? "pos_sale_refund_sync_failed" }, { status: 409 });
      }
    }

    return NextResponse.json({
      ok: true,
      already_refunded: alreadyRefunded,
      status: rr.status ?? "refunded",
      invoice_status: rr.invoice_status ?? null,
      invoice_voided_at: rr.invoice_voided_at ?? null,
      invoice_void_reason: rr.invoice_void_reason ?? null,
    });
  }

  // Use atomic RPC so reserved seat is restored in the same transaction.
  const cancelResult = await cancelPendingPaymentLifecycle(admin, payment, parsed.data.status);
  if (!cancelResult.ok) {
    if (cancelResult.kind === "rpc") {
      return NextResponse.json({ error: cancelResult.error }, { status: 500 });
    }
    if (cancelResult.error === "not_pending") {
      return NextResponse.json({ error: "not_pending" }, { status: 409 });
    }
    return NextResponse.json({ error: cancelResult.error ?? "cancel_failed" }, { status: 409 });
  }

  if (payment.booking_id) {
    const { data: booking } = await admin
      .from("bookings")
      .select("client_id, guest_email")
      .eq("id", payment.booking_id)
      .maybeSingle();
    let to: string | null = booking?.guest_email ?? null;
    if (booking?.client_id) {
      const { data: u } = await admin.from("users").select("email").eq("id", booking.client_id).maybeSingle();
      to = u?.email ?? to;
    }
    if (to) {
      await sendPaymentResultNotice({
        to,
        status: parsed.data.status,
        reference: null,
      });
    }
  }
  await writeOperationAudit({
    actorId: user.id,
    actorRole: "staff",
    action: `payment_mark_${parsed.data.status}`,
    targetType: "payment",
    targetId: parsed.data.payment_id,
    beforeState: { status: "pending" },
    afterState: { status: parsed.data.status },
  });

  return NextResponse.json({ ok: true });
}
