import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { classGuestHasActiveBooking } from "@/lib/classBookingDedup";
import { eventGuestHasActiveBooking } from "@/lib/eventBookingDedup";
import { sanitizeEventExternalBookingUrl } from "@/lib/eventBookingUrl";
import { createInstantBookingSale, runInstantBookingCheckin } from "@/lib/bookingTransitions";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  hashIdempotencyRequest,
  type IdempotencyClaimResult,
} from "@/lib/idempotency";
import { sweepExpiredPendingPayments } from "@/lib/paymentExpiry";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { STUDIO_CURRENCY } from "@/lib/currency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { walkinStartIsOpen } from "@/lib/walkinAvailability";

const requiredEmail = z.string().email().max(320).transform((v) => v.trim().toLowerCase());

const walkinBase = z.object({
  guest_name: z.string().min(1).max(120),
  guest_phone: z.string().max(40).optional(),
  payment_method: z.enum(["hitpay", "cash"]),
  client_id: z.string().uuid().optional(),
  guest_email: requiredEmail,
  target_id: z.string().uuid(),
  mark_checkin: z.boolean().optional(),
  idempotency_key: z.string().trim().min(8).max(200),
});

const bodySchema = z.discriminatedUnion("booking_type", [
  walkinBase.extend({ booking_type: z.literal("session") }),
  walkinBase.extend({ booking_type: z.literal("event") }),
]);

type WalkinBody = z.infer<typeof bodySchema>;
type AdminClient = ReturnType<typeof createAdminClient>;

async function resolveWalkinClientId(admin: AdminClient, clientId: string | undefined) {
  if (!clientId) return null;
  const { data: userRow } = await admin.from("users").select("id").eq("id", clientId).maybeSingle();
  if (userRow?.id) return userRow.id;
  const { data: customer } = await admin
    .from("salon_customers")
    .select("user_id")
    .eq("id", clientId)
    .maybeSingle();
  return customer?.user_id ?? null;
}

async function findOpenCashSession(admin: AdminClient, studioId: string, locationId: string) {
  const { data } = await admin
    .from("pos_cash_sessions")
    .select("id")
    .eq("studio_id", studioId)
    .eq("location_id", locationId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

async function resolveCashSessionId(
  admin: AdminClient,
  paymentMethod: "hitpay" | "cash",
  studioId: string,
  locationId: string | null,
) {
  if (paymentMethod !== "cash") return { ok: true as const, cashSessionId: null };
  if (!locationId) {
    return { ok: false as const, error: "no_open_cash_session", status: 409 as const };
  }
  const cashSessionId = await findOpenCashSession(admin, studioId, locationId);
  if (!cashSessionId) {
    return { ok: false as const, error: "no_open_cash_session", status: 409 as const };
  }
  return { ok: true as const, cashSessionId };
}

function walkinRequestHashPayload(data: WalkinBody) {
  return {
    booking_type: data.booking_type,
    target_id: data.target_id,
    guest_email: data.guest_email,
    payment_method: data.payment_method,
    client_id: data.client_id ?? null,
    mark_checkin: data.mark_checkin === true,
  };
}

function replayWalkinSnapshot(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const body = snapshot as Record<string, unknown>;
  if (body.ok !== true) return null;
  return body;
}

function parseWalkinIdempotencyClaim(claim: IdempotencyClaimResult) {
  if (claim.ok && claim.outcome === "claimed") {
    return { continue: true as const, claimId: claim.id, claimToken: claim.claimToken };
  }
  if (claim.ok && claim.outcome === "already_completed") {
    const body = replayWalkinSnapshot(claim.result);
    if (!body) {
      return { continue: false as const, response: NextResponse.json({ error: "idempotency_conflict" }, { status: 409 }) };
    }
    return { continue: false as const, response: NextResponse.json(body) };
  }
  if (claim.ok && claim.outcome === "in_progress") {
    return { continue: false as const, response: NextResponse.json({ error: "idempotency_in_progress" }, { status: 409 }) };
  }
  if (!claim.ok && claim.outcome === "hash_conflict") {
    return { continue: false as const, response: NextResponse.json({ error: "idempotency_conflict" }, { status: 409 }) };
  }
  return { continue: false as const, response: NextResponse.json({ error: "idempotency_permanently_failed" }, { status: 409 }) };
}

async function withWalkinIdempotency(
  studioId: string,
  data: WalkinBody,
  run: () => Promise<NextResponse>,
) {
  const claim = await claimIdempotencyKey({
    studioId,
    operationScope: "frontdesk_walkin",
    idempotencyKey: data.idempotency_key,
    requestHash: hashIdempotencyRequest(walkinRequestHashPayload(data)),
  });
  const parsed = parseWalkinIdempotencyClaim(claim);
  if (!parsed.continue) return parsed.response;

  const response = await run();
  const body = await response.clone().json().catch(() => null);
  if (!response.ok) {
    await failIdempotencyKey({
      recordId: parsed.claimId,
      claimToken: parsed.claimToken,
      errorSummary: typeof body?.error === "string" ? body.error : `http_${response.status}`,
      retryable: true,
    });
    return response;
  }
  const completed = await completeIdempotencyKey({
    recordId: parsed.claimId,
    claimToken: parsed.claimToken,
    resultSnapshot: body,
  });
  if (!completed.ok) {
    console.log("walk-in idempotency complete failed", { claimId: parsed.claimId });
  }
  return response;
}

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
  admin: AdminClient,
  userId: string,
  data: WalkinBody & { booking_type: "session" },
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
  if (session.start_time && !walkinStartIsOpen(String(session.start_time))) {
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

  return withWalkinIdempotency(studioId, data, async () => {
    if (await classGuestHasActiveBooking(admin, data.target_id, data.guest_email)) {
      return NextResponse.json({ error: "already_has_booking" }, { status: 409 });
    }

    const till = await resolveCashSessionId(admin, data.payment_method, studioId, session.location_id ?? null);
    if (!till.ok) return NextResponse.json({ error: till.error }, { status: till.status });

    const clientId = await resolveWalkinClientId(admin, data.client_id);
    const sale = await createInstantBookingSale(admin, {
      kind: "class",
      targetId: data.target_id,
      studioId,
      locationId: session.location_id ?? null,
      guestName: data.guest_name.trim(),
      guestEmail: data.guest_email,
      guestPhone: data.guest_phone?.trim() ?? null,
      amount: Number(session.guest_price ?? 0),
      currency: STUDIO_CURRENCY,
      paymentMethod: data.payment_method,
      clientId,
      actorId: userId,
      cashSessionId: till.cashSessionId,
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
        cash_session_id: till.cashSessionId,
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
  });
}

async function handleEventWalkin(
  admin: AdminClient,
  userId: string,
  data: WalkinBody & { booking_type: "event" },
) {
  const { data: event } = await admin
    .from("events")
    .select("id, studio_id, location_id, price, spots_left, is_active, start_time, external_booking_url")
    .eq("id", data.target_id)
    .maybeSingle();
  if (!event) return NextResponse.json({ error: "event_not_found" }, { status: 404 });
  if (event.is_active === false) return NextResponse.json({ error: "event_not_available" }, { status: 409 });
  if (event.start_time && !walkinStartIsOpen(String(event.start_time))) {
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

  return withWalkinIdempotency(studioId, data, async () => {
    if (await eventGuestHasActiveBooking(admin, data.target_id, data.guest_email)) {
      return NextResponse.json({ error: "already_has_booking" }, { status: 409 });
    }

    const till = await resolveCashSessionId(admin, data.payment_method, studioId, event.location_id ?? null);
    if (!till.ok) return NextResponse.json({ error: till.error }, { status: till.status });

    const clientId = await resolveWalkinClientId(admin, data.client_id);
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
      clientId,
      actorId: userId,
      cashSessionId: till.cashSessionId,
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
        cash_session_id: till.cashSessionId,
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
  });
}
