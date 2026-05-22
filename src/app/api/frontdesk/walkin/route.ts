import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { eventGuestHasActiveBooking } from "@/lib/eventBookingDedup";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const optionalEmail = z
  .union([z.string().email().max(320), z.literal("")])
  .optional()
  .transform((v) => {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t.toLowerCase() : undefined;
  });

const walkinBase = z.object({
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional(),
  amount: z.number().nonnegative(),
  payment_method: z.enum(["hitpay", "cash"]),
});

const bodySchema = z.discriminatedUnion("booking_type", [
  walkinBase.extend({
    booking_type: z.literal("session"),
    target_id: z.string().uuid(),
    guest_email: optionalEmail,
    mark_checkin: z.boolean().optional(),
  }),
  walkinBase.extend({
    booking_type: z.literal("event"),
    target_id: z.string().uuid(),
    guest_email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
    mark_checkin: z.boolean().optional(),
  }),
]);

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
  await sweepExpiredPendingPayments(admin);

  if (parsed.data.booking_type === "session") {
    return handleSessionWalkin(admin, user.id, parsed.data);
  }
  return handleEventWalkin(admin, user.id, parsed.data);
}

async function handleSessionWalkin(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  data: z.infer<typeof bodySchema> & { booking_type: "session" },
) {
  const { data: session } = await admin
    .from("class_sessions")
    .select("id, location_id, spots_left, classes!inner(studio_id)")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if ((session.spots_left ?? 0) <= 0) return NextResponse.json({ error: "full" }, { status: 409 });

  const classes = session.classes as { studio_id?: string } | { studio_id?: string }[] | null;
  const studioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
  if (!studioId) return NextResponse.json({ error: "invalid_session" }, { status: 500 });

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const scoped = await requireStaffScope({
    userId,
    studioId,
    locationId: session.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      session_id: data.target_id,
      location_id: session.location_id ?? null,
      client_id: null,
      guest_name: data.guest_name.trim(),
      guest_email: data.guest_email ?? null,
      guest_phone: data.guest_phone?.trim() ?? null,
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
      amount: data.amount,
      currency: STUDIO_CURRENCY,
      type: "single",
      source: "walkin",
      status: "paid",
      payment_method: data.payment_method,
      paid_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      verified_by: userId,
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
  if (data.mark_checkin) {
    const { data: checkinData, error: checkinErr } = await admin.rpc("checkin_booking", {
      p_booking_id: booking.id,
      p_actor_id: userId,
    });
    const cr = checkinData as { ok?: boolean; error?: string } | null;
    checkinOk = !checkinErr && cr?.ok === true;
    checkinError = checkinErr?.message ?? (cr?.ok === false ? (cr?.error ?? "checkin_failed") : undefined);
  }
  await writeOperationAudit({
    actorId: userId,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "booking",
    targetId: booking.id,
    afterState: {
      booking_type: "session",
      payment_id: payment.id,
      payment_method: data.payment_method,
      checkin: checkinOk,
      checkin_error: checkinError ?? null,
    },
  });
  return NextResponse.json({
    ok: true,
    booking_type: "session",
    booking_id: booking.id,
    payment_id: payment.id,
    checkin: checkinOk,
    ...(checkinError ? { checkin_error: checkinError } : {}),
  });
}

async function handleEventWalkin(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  data: z.infer<typeof bodySchema> & { booking_type: "event" },
) {
  const { data: event } = await admin
    .from("events")
    .select("id, studio_id, location_id, spots_left, is_active, external_booking_url")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (event.is_active === false) return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  if ((event.spots_left ?? 0) <= 0) return NextResponse.json({ error: "full" }, { status: 409 });
  if (sanitizeEventExternalBookingUrl(event.external_booking_url)) {
    return NextResponse.json({ error: "event_external_booking_url" }, { status: 409 });
  }

  const studioId = event.studio_id;
  if (!studioId) return NextResponse.json({ error: "invalid_event" }, { status: 500 });

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const scoped = await requireStaffScope({
    userId,
    studioId,
    locationId: event.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  if (await eventGuestHasActiveBooking(admin, data.target_id, data.guest_email)) {
    return NextResponse.json({ error: "already_has_booking" }, { status: 409 });
  }

  const { data: booking, error: bErr } = await admin
    .from("event_bookings")
    .insert({
      event_id: data.target_id,
      location_id: event.location_id ?? null,
      client_id: null,
      guest_name: data.guest_name.trim(),
      guest_email: data.guest_email,
      guest_phone: data.guest_phone?.trim() ?? null,
      status: "booked",
      payment_status: "paid",
    })
    .select("id")
    .single();
  if (bErr || !booking) return NextResponse.json({ error: bErr?.message ?? "booking_create_failed" }, { status: 500 });

  const currency = STUDIO_CURRENCY;
  const { data: payment, error: pErr } = await admin
    .from("payments")
    .insert({
      event_booking_id: booking.id,
      studio_id: studioId,
      location_id: event.location_id ?? null,
      guest_name: data.guest_name.trim(),
      guest_email: data.guest_email,
      guest_phone: data.guest_phone?.trim() ?? null,
      amount: data.amount,
      currency,
      type: "single",
      source: "walkin",
      status: "paid",
      payment_method: data.payment_method,
      paid_at: new Date().toISOString(),
      verified_at: new Date().toISOString(),
      verified_by: userId,
      remaining_uses: 1,
    })
    .select("id")
    .single();
  if (pErr || !payment) {
    await admin.from("event_bookings").delete().eq("id", booking.id);
    return NextResponse.json({ error: pErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  await admin.from("event_bookings").update({ payment_id: payment.id }).eq("id", booking.id);
  const { data: seatRow } = await admin
    .from("events")
    .update({ spots_left: (event.spots_left ?? 1) - 1 })
    .eq("id", event.id)
    .gt("spots_left", 0)
    .select("id")
    .maybeSingle();
  if (!seatRow) {
    await admin.from("event_bookings").update({ status: "cancelled" }).eq("id", booking.id);
    await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
    return NextResponse.json({ error: "full" }, { status: 409 });
  }

  let checkinOk = false;
  let checkinError: string | undefined;
  if (data.mark_checkin) {
    const { data: checkinData, error: checkinErr } = await admin.rpc("checkin_event_booking", {
      p_event_booking_id: booking.id,
      p_actor_id: userId,
    });
    const cr = checkinData as { ok?: boolean; error?: string } | null;
    checkinOk = !checkinErr && cr?.ok === true;
    checkinError = checkinErr?.message ?? (cr?.ok === false ? (cr?.error ?? "checkin_failed") : undefined);
  }

  await writeOperationAudit({
    actorId: userId,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "event_booking",
    targetId: booking.id,
    afterState: {
      booking_type: "event",
      payment_id: payment.id,
      payment_method: data.payment_method,
      checkin: checkinOk,
      checkin_error: checkinError ?? null,
    },
  });
  if (checkinOk) {
    await writeOperationAudit({
      actorId: userId,
      actorRole: scoped.role,
      action: "event_checkin",
      targetType: "event_booking",
      targetId: booking.id,
      afterState: { status: "attended", via: "frontdesk_walkin" },
    });
  }
  return NextResponse.json({
    ok: true,
    booking_type: "event",
    event_booking_id: booking.id,
    payment_id: payment.id,
    checkin: checkinOk,
    ...(checkinError ? { checkin_error: checkinError } : {}),
  });
}
