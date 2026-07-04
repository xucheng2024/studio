import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { classGuestHasActiveBooking } from "@/lib/classBookingDedup";
import { eventGuestHasActiveBooking } from "@/lib/eventBookingDedup";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { createInstantBookingSale, runInstantBookingCheckin } from "@/lib/bookingTransitions";
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
  walkinBase.extend({
    booking_type: z.literal("service"),
    target_id: z.string().uuid(),
    guest_email: z.string().email().max(320).transform((v) => v.trim().toLowerCase()),
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
  if (parsed.data.booking_type === "event") {
    return handleEventWalkin(admin, user.id, parsed.data);
  }
  return handleServiceWalkin(admin, user.id, parsed.data);
}

async function handleSessionWalkin(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  data: z.infer<typeof bodySchema> & { booking_type: "session" },
) {
  const { data: session } = await admin
    .from("class_sessions")
    .select("id, location_id, guest_price, status, start_time, spots_left, classes!inner(studio_id)")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if ((session.status ?? "scheduled") !== "scheduled") {
    return NextResponse.json({ error: "session_not_available" }, { status: 409 });
  }
  if (session.start_time && new Date(String(session.start_time)).getTime() < Date.now()) {
    return NextResponse.json({ error: "session_not_available" }, { status: 409 });
  }
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

  if (data.guest_email && await classGuestHasActiveBooking(admin, data.target_id, data.guest_email)) {
    return NextResponse.json({ error: "already_has_booking" }, { status: 409 });
  }

  const sale = await createInstantBookingSale(admin, {
    kind: "class",
    targetId: data.target_id,
    studioId,
    locationId: session.location_id ?? null,
    guestName: data.guest_name.trim(),
    guestEmail: data.guest_email ?? null,
    guestPhone: data.guest_phone?.trim() ?? null,
    amount: Number(session.guest_price ?? 0),
    currency: STUDIO_CURRENCY,
    paymentMethod: data.payment_method,
    actorId: userId,
  });
  if (!sale.ok) return NextResponse.json({ error: sale.error }, { status: sale.status });

  let checkinOk = false;
  let checkinError: string | undefined;
  if (data.mark_checkin) {
    const result = await runInstantBookingCheckin(admin, {
      kind: "class",
      bookingId: sale.bookingId,
      actorId: userId,
    });
    checkinOk = result.ok;
    checkinError = result.error;
  }
  await writeOperationAudit({
    actorId: userId,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "booking",
    targetId: sale.bookingId,
    afterState: {
      booking_type: "session",
      payment_id: sale.paymentId,
      payment_method: data.payment_method,
      checkin: checkinOk,
      checkin_error: checkinError ?? null,
    },
  });
  return NextResponse.json({
    ok: true,
    booking_type: "session",
    booking_id: sale.bookingId,
    payment_id: sale.paymentId,
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
    .select("id, studio_id, location_id, price, spots_left, is_active, start_time, external_booking_url")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (event.is_active === false) return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  if (event.start_time && new Date(String(event.start_time)).getTime() < Date.now()) {
    return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  }
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

  const sale = await createInstantBookingSale(admin, {
    kind: "event",
    targetId: data.target_id,
    studioId,
    locationId: event.location_id ?? null,
    guestName: data.guest_name.trim(),
    guestEmail: data.guest_email,
    guestPhone: data.guest_phone?.trim() ?? null,
    amount: Number(event.price ?? 0),
    currency: STUDIO_CURRENCY,
    paymentMethod: data.payment_method,
    actorId: userId,
  });
  if (!sale.ok) return NextResponse.json({ error: sale.error }, { status: sale.status });

  let checkinOk = false;
  let checkinError: string | undefined;
  if (data.mark_checkin) {
    const result = await runInstantBookingCheckin(admin, {
      kind: "event",
      bookingId: sale.bookingId,
      actorId: userId,
    });
    checkinOk = result.ok;
    checkinError = result.error;
  }

  await writeOperationAudit({
    actorId: userId,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "event_booking",
    targetId: sale.bookingId,
    afterState: {
      booking_type: "event",
      payment_id: sale.paymentId,
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
      targetId: sale.bookingId,
      afterState: { status: "attended", via: "frontdesk_walkin" },
    });
  }
  return NextResponse.json({
    ok: true,
    booking_type: "event",
    event_booking_id: sale.bookingId,
    payment_id: sale.paymentId,
    checkin: checkinOk,
    ...(checkinError ? { checkin_error: checkinError } : {}),
  });
}

async function handleServiceWalkin(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  data: z.infer<typeof bodySchema> & { booking_type: "service" },
) {
  const { data: service } = await admin
    .from("studio_services")
    .select("id, studio_id, title, price, is_active")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!service) return NextResponse.json({ error: "service_not_found" }, { status: 404 });
  if (service.is_active === false) {
    return NextResponse.json({ error: "service_not_available" }, { status: 409 });
  }
  if (service.price == null) {
    return NextResponse.json({ error: "service_price_missing" }, { status: 409 });
  }

  const studioId = service.studio_id;
  if (!studioId) return NextResponse.json({ error: "invalid_service" }, { status: 500 });

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const scoped = await requireStaffScope({
    userId,
    studioId,
    locationId: null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const nowIso = new Date().toISOString();
  const amount = Number(service.price ?? 0);
  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .insert({
      service_id: service.id,
      service_title_snapshot: service.title,
      studio_id: studioId,
      location_id: null,
      client_id: null,
      guest_name: data.guest_name.trim(),
      guest_email: data.guest_email,
      guest_phone: data.guest_phone?.trim() ?? null,
      amount,
      currency: STUDIO_CURRENCY,
      type: "single",
      sales_channel: "frontdesk",
      source: "service_purchase",
      status: "paid",
      payment_method: data.payment_method,
      paid_at: nowIso,
      verified_at: nowIso,
      verified_by: userId,
      remaining_uses: 0,
    })
    .select("id")
    .single<{ id: string }>();
  if (paymentErr || !payment?.id) {
    return NextResponse.json({ error: paymentErr?.message ?? "payment_create_failed" }, { status: 500 });
  }

  const { data: order, error: orderErr } = await admin
    .from("service_orders")
    .insert({
      studio_id: studioId,
      service_id: service.id,
      payment_id: payment.id,
      client_id: null,
      guest_name: data.guest_name.trim(),
      guest_email: data.guest_email,
      guest_phone: data.guest_phone?.trim() ?? null,
      service_title_snapshot: service.title,
      amount,
      currency: STUDIO_CURRENCY,
      status: "paid",
      paid_at: nowIso,
    })
    .select("id")
    .single<{ id: string }>();
  if (orderErr || !order?.id) {
    await admin.from("payments").delete().eq("id", payment.id);
    return NextResponse.json({ error: orderErr?.message ?? "service_order_create_failed" }, { status: 500 });
  }

  await writeOperationAudit({
    actorId: userId,
    actorRole: scoped.role,
    action: "frontdesk_walkin",
    targetType: "service_order",
    targetId: order.id,
    afterState: {
      booking_type: "service",
      payment_id: payment.id,
      payment_method: data.payment_method,
    },
  });

  return NextResponse.json({
    ok: true,
    booking_type: "service",
    service_order_id: order.id,
    payment_id: payment.id,
  });
}
