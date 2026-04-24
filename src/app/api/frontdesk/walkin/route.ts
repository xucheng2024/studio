import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  session_id: z.string().uuid(),
  guest_name: z.string().min(1).max(120),
  guest_email: z.string().email().max(320).optional(),
  guest_phone: z.string().max(40).optional(),
  amount: z.number().nonnegative(),
  payment_method: z.enum(["hitpay", "cash"]),
  mark_checkin: z.boolean().optional(),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("class_sessions")
    .select("id, location_id, spots_left, classes!inner(studio_id)")
    .eq("id", parsed.data.session_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if ((session.spots_left ?? 0) <= 0) return NextResponse.json({ error: "full" }, { status: 409 });

  const classes = session.classes as { studio_id?: string } | { studio_id?: string }[] | null;
  const studioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
  if (!studioId) return NextResponse.json({ error: "invalid_session" }, { status: 500 });

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId,
    locationId: session.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      session_id: parsed.data.session_id,
      location_id: session.location_id ?? null,
      client_id: null,
      guest_name: parsed.data.guest_name.trim(),
      guest_email: parsed.data.guest_email?.trim().toLowerCase() ?? null,
      guest_phone: parsed.data.guest_phone?.trim() ?? null,
      status: "booked",
      payment_status: "paid",
    })
    .select("id")
    .single();
  if (bErr || !booking) return NextResponse.json({ error: bErr?.message ?? "booking_create_failed" }, { status: 500 });

  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      booking_id: booking.id,
      studio_id: studioId,
      location_id: session.location_id ?? null,
      amount: parsed.data.amount,
      currency: "SGD",
      type: "single",
      status: "paid",
      payment_method: parsed.data.payment_method,
      paid_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      verified_by: user.id,
      remaining_uses: 1,
    })
    .select("id")
    .single();
  if (pErr || !payment) return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });

  await admin.from("bookings").update({ payment_id: payment.id }).eq("id", booking.id);
  const { data: seatRow } = await admin
    .from("class_sessions")
    .update({ spots_left: (session.spots_left ?? 1) - 1 })
    .eq("id", session.id)
    .gt("spots_left", 0)
    .select("id")
    .maybeSingle();
  if (!seatRow) {
    await admin.from("bookings").update({ status: "cancelled", cancel_reason: "full_race" }).eq("id", booking.id);
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return NextResponse.json({ error: "full" }, { status: 409 });
  }

  let checkinOk = false;
  let checkinError: string | undefined;
  if (parsed.data.mark_checkin) {
    const { data: checkinData, error: checkinErr } = await admin.rpc("checkin_booking", {
      p_booking_id: booking.id,
      p_actor_id: user.id,
    });
    const cr = checkinData as { ok?: boolean; error?: string } | null;
    checkinOk = !checkinErr && (cr?.ok === true);
    checkinError = checkinErr?.message ?? (cr?.ok === false ? (cr?.error ?? "checkin_failed") : undefined);
  }
  await writeOperationAudit({
    actorId: user.id,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "booking",
    targetId: booking.id,
    afterState: {
      payment_id: payment.id,
      payment_method: parsed.data.payment_method,
      checkin: checkinOk,
      checkin_error: checkinError ?? null,
    },
  });
  return NextResponse.json({
    ok: true,
    booking_id: booking.id,
    payment_id: payment.id,
    checkin: checkinOk,
    ...(checkinError ? { checkin_error: checkinError } : {}),
  });
}
