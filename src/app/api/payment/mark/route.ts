import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeOperationAudit } from "@/lib/audit";
import { sendPaymentResultNotice } from "@/lib/email";
import { requireStaffScope } from "@/lib/scope";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  status: z.enum(["paid", "failed", "expired", "refunded"]),
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
      customer_confirmed_at,
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
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (parsed.data.status === "paid") {
    if (!payment.customer_confirmed_at) {
      return NextResponse.json({ error: "customer_not_confirmed" }, { status: 409 });
    }
    const { data: result, error } = await admin.rpc("confirm_paynow_payment", {
      p_payment_id: parsed.data.payment_id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const r = result as { ok?: boolean; error?: string };
    if (!r?.ok) return NextResponse.json({ error: r?.error ?? "confirm_failed" }, { status: 409 });
    await admin
      .from("payments")
      .update({
        verified_at: new Date().toISOString(),
        verified_by: user.id,
      })
      .eq("id", parsed.data.payment_id);
    await writeOperationAudit({
      actorId: user.id,
      actorRole: "staff",
      action: "payment_mark_paid",
      targetType: "payment",
      targetId: parsed.data.payment_id,
      beforeState: { status: "pending" },
      afterState: { status: "paid" },
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

  const { error: updErr } = await admin
    .from("payments")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.payment_id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if (payment.booking_id) {
    await admin
      .from("bookings")
      .update({ status: "cancelled", payment_status: "pending" })
      .eq("id", payment.booking_id)
      .eq("status", "pending");
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
