import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeOperationAudit } from "@/lib/audit";
import { sendPaymentResultNotice } from "@/lib/email";
import { refundHitpayPayment } from "@/lib/hitpay";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  status: z.enum(["paid", "failed", "expired", "refunded"]),
  refund_reason: z.string().max(500).optional(),
  manual_refund_reference: z.string().max(120).optional(),
  manual_refund_done: z.boolean().optional(),
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
      payment_method,
      amount,
      gateway_payment_id,
      studios ( owner_id, hitpay_api_key )
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

  if (parsed.data.status === "paid") {
    const { data: result, error } = await admin.rpc("confirm_payment_with_invoice", {
      p_payment_id: parsed.data.payment_id,
      p_verified_by: user.id,
    });
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
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.status === "refunded") {
    if ((payment.payment_method ?? "").toLowerCase() === "paynow") {
      const manualReference = parsed.data.manual_refund_reference?.trim() ?? "";
      if (!parsed.data.manual_refund_done || !manualReference) {
        return NextResponse.json(
          {
            error: "manual_refund_required",
            message: "PayNow refund must be completed manually first. Enter the transfer reference to record it.",
          },
          { status: 409 },
        );
      }
      const { data: manualResult, error: manualErr } = await admin.rpc("refund_payment_with_invoice_void", {
        p_payment_id: parsed.data.payment_id,
        p_operator_id: user.id,
        p_reason: parsed.data.refund_reason?.trim() || "manual_paynow_refund",
      });
      if (manualErr) return NextResponse.json({ error: manualErr.message }, { status: 500 });
      const mr = manualResult as { ok?: boolean; error?: string; already_refunded?: boolean };
      if (!mr?.ok) {
        if (mr?.error === "not_paid") {
          return NextResponse.json(
            { error: "not_paid", message: "Only payments in paid status can be refunded." },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: mr?.error ?? "refund_failed" }, { status: 409 });
      }
      await admin
        .from("payments")
        .update({
          manual_refund_reference: manualReference,
          manual_refund_recorded_at: new Date().toISOString(),
          manual_refund_recorded_by: user.id,
        })
        .eq("id", parsed.data.payment_id);
      await writeOperationAudit({
        actorId: user.id,
        actorRole: "staff",
        action: "payment_manual_refund_recorded",
        targetType: "payment",
        targetId: parsed.data.payment_id,
        afterState: {
          payment_method: "paynow",
          manual_refund_reference: manualReference,
        },
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
            status: "refunded",
            reference: null,
          });
        }
      }
      return NextResponse.json({ ok: true, manual: true });
    }
    if ((payment.payment_method ?? "").toLowerCase() === "hitpay") {
      const studioObj = payment.studios as
        | { owner_id?: string | null; hitpay_api_key?: string | null }
        | { owner_id?: string | null; hitpay_api_key?: string | null }[]
        | null;
      const studio = Array.isArray(studioObj) ? studioObj[0] : studioObj;
      const apiKey = studio?.hitpay_api_key ?? null;
      if (!apiKey) {
        return NextResponse.json(
          {
            error: "hitpay_not_configured",
            message: "This studio has no HitPay API key configured for automatic refunds.",
          },
          { status: 409 },
        );
      }
      if (!payment.gateway_payment_id) {
        return NextResponse.json(
          {
            error: "gateway_payment_id_missing",
            message: "Missing HitPay payment id. Please process this refund manually.",
          },
          { status: 409 },
        );
      }
      try {
        await refundHitpayPayment({
          apiKey,
          paymentId: payment.gateway_payment_id,
          amount: Number(payment.amount ?? 0),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "hitpay_refund_failed";
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
    if (refundErr) return NextResponse.json({ error: refundErr.message }, { status: 500 });
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
        return NextResponse.json(
          { error: "not_paid", message: "Only payments in paid status can be refunded." },
          { status: 409 },
        );
      }
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
    return NextResponse.json({
      ok: true,
      already_refunded: alreadyRefunded,
      status: rr.status ?? "refunded",
      invoice_status: rr.invoice_status ?? null,
      invoice_voided_at: rr.invoice_voided_at ?? null,
      invoice_void_reason: rr.invoice_void_reason ?? null,
    });
  }

  // Use the atomic RPC so the reserved seat is restored in the same transaction.
  const { data: cancelResult, error: cancelErr } = await admin.rpc("cancel_pending_payment", {
    p_payment_id: parsed.data.payment_id,
    p_new_status: parsed.data.status,
  });
  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });
  const cr = cancelResult as { ok?: boolean; error?: string };
  if (!cr?.ok && cr?.error !== "not_pending") {
    return NextResponse.json({ error: cr?.error ?? "cancel_failed" }, { status: 409 });
  }
  if (!cr?.ok && cr?.error === "not_pending") {
    return NextResponse.json({ error: "not_pending" }, { status: 409 });
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
