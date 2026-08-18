import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { dayRangeEndExclusiveIso, dayRangeStartIso, localISODate } from "@/lib/date";
import { buildAccessContext, filterStudioIdsByRoles } from "@/lib/rbac";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SoonBookingRow = {
  id: string;
  session_id: string;
  status: string;
  guest_name: string | null;
  guest_email: string | null;
  users: { email: string | null } | { email: string | null }[] | null;
};

type SoonEventBookingRow = {
  id: string;
  event_id: string;
  status: string;
  guest_name: string | null;
  guest_email: string | null;
  users: { email: string | null } | { email: string | null }[] | null;
};

const getQueuePayloadCached = unstable_cache(
  async (
    userId: string,
    studioIds: string[],
    locationId: string | null,
    sessionStatus: "all" | "scheduled" | "cancelled",
    startIso: string,
    endIso: string,
  ) => {
    const admin = createAdminClient();
    const windowStart = new Date(startIso);
    const windowEnd = new Date(endIso);

    let sessionsQuery = admin
      .from("class_sessions")
      .select("id, location_id, start_time, status, capacity, spots_left, locations(name), classes!inner(title, studio_id)")
      .in("classes.studio_id", studioIds)
      .gte("start_time", windowStart.toISOString())
      .lt("start_time", windowEnd.toISOString())
      .order("start_time", { ascending: true })
      .limit(150);

    if (locationId) sessionsQuery = sessionsQuery.eq("location_id", locationId);
    if (sessionStatus !== "all") sessionsQuery = sessionsQuery.eq("status", sessionStatus);

    const { data: sessions } = await sessionsQuery;
    const sessionIds = (sessions ?? []).map((s) => s.id);

    const { data: bookingsRaw } =
      sessionIds.length > 0
        ? await admin
            .from("bookings")
            .select("id, session_id, status, guest_name, guest_email, users(email)")
            .in("session_id", sessionIds)
            .in("status", ["pending", "booked", "attended"])
        : { data: [] as SoonBookingRow[] };

    const bookings = (bookingsRaw ?? []) as SoonBookingRow[];
    const bookingsBySession = new Map<string, SoonBookingRow[]>();
    for (const b of bookings) {
      const prev = bookingsBySession.get(b.session_id) ?? [];
      bookingsBySession.set(b.session_id, [...prev, b]);
    }

    const pendingBookingIds = bookings.filter((b) => b.status === "pending").map((b) => b.id);
    const { data: pendingPaymentsRaw } =
      pendingBookingIds.length > 0
        ? await admin
            .from("payments")
            .select("id, booking_id, pos_sale_id, created_at")
            .in("booking_id", pendingBookingIds)
            .order("created_at", { ascending: false })
        : { data: [] as Array<{ id: string; booking_id: string | null; pos_sale_id: string | null }> };
    const paymentByBookingId = new Map<string, { payment_id: string; pos_sale_id: string | null }>();
    for (const payment of pendingPaymentsRaw ?? []) {
      if (!payment.booking_id || paymentByBookingId.has(payment.booking_id)) continue;
      paymentByBookingId.set(payment.booking_id, {
        payment_id: payment.id,
        pos_sale_id: payment.pos_sale_id,
      });
    }

    const grouped: Array<{
      session_id: string;
      class_title: string;
      start_time: string;
      location_name: string | null;
      capacity: number;
      spots_left: number;
      total_booked: number;
      pending_checkin_count: number;
      attendees: Array<{
        booking_id: string;
        label: string;
        guest_email: string | null;
        status: "pending" | "booked" | "attended";
        payment_id: string | null;
        pos_sale_id: string | null;
      }>;
    }> = [];

    for (const sessionRow of sessions ?? []) {
      const rawList = bookingsBySession.get(sessionRow.id) ?? [];
      const attendees = rawList
        .map((b) => {
          const u = Array.isArray(b.users) ? b.users[0] : b.users;
          const label = (b.guest_name?.trim() || u?.email?.trim() || b.guest_email?.trim() || "Guest") as string;
          const status =
            b.status === "attended" ? "attended" : b.status === "booked" ? "booked" : "pending";
          const payment = status === "pending" ? paymentByBookingId.get(b.id) : undefined;
          return {
            booking_id: b.id,
            label,
            guest_email: b.guest_email ?? u?.email ?? null,
            status: status as "pending" | "booked" | "attended",
            payment_id: payment?.payment_id ?? null,
            pos_sale_id: payment?.pos_sale_id ?? null,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

      const cls = Array.isArray(sessionRow.classes) ? sessionRow.classes[0] : sessionRow.classes;
      const loc = sessionRow.locations as
        | { name?: string | null }
        | { name?: string | null }[]
        | null
        | undefined;
      const locationName = Array.isArray(loc) ? loc[0]?.name ?? null : loc?.name ?? null;

      grouped.push({
        session_id: sessionRow.id,
        class_title: cls?.title ?? "Class",
        start_time: sessionRow.start_time ?? new Date().toISOString(),
        location_name: locationName,
        capacity: Number((sessionRow as { capacity?: number }).capacity ?? 0),
        spots_left: Number((sessionRow as { spots_left?: number }).spots_left ?? 0),
        total_booked: attendees.filter((a) => a.status === "booked" || a.status === "attended").length,
        pending_checkin_count: attendees.filter((a) => a.status === "booked").length,
        attendees,
      });
    }

    const eventsQuery = admin
      .from("events")
      .select("id, title, start_time, address, capacity, spots_left")
      .in("studio_id", studioIds)
      .gte("start_time", windowStart.toISOString())
      .lt("start_time", windowEnd.toISOString())
      .order("start_time", { ascending: true })
      .limit(150);

    const { data: events } = await eventsQuery;
    const eventIds = (events ?? []).map((eventRow) => eventRow.id);

    const eventBookingStatuses =
      sessionStatus === "cancelled"
        ? ["cancelled"]
        : sessionStatus === "scheduled"
          ? ["pending", "booked", "attended"]
          : ["pending", "booked", "attended", "cancelled"];

    const { data: eventBookingsRaw } =
      eventIds.length > 0
        ? await admin
            .from("event_bookings")
            .select("id, event_id, status, guest_name, guest_email, users(email)")
            .in("event_id", eventIds)
            .in("status", eventBookingStatuses)
        : { data: [] as SoonEventBookingRow[] };

    const eventBookings = (eventBookingsRaw ?? []) as SoonEventBookingRow[];
    const eventBookingsByEvent = new Map<string, SoonEventBookingRow[]>();
    for (const booking of eventBookings) {
      const prev = eventBookingsByEvent.get(booking.event_id) ?? [];
      eventBookingsByEvent.set(booking.event_id, [...prev, booking]);
    }

    const pendingEventBookingIds = eventBookings.filter((booking) => booking.status === "pending").map((booking) => booking.id);
    const { data: pendingEventPaymentsRaw } =
      pendingEventBookingIds.length > 0
        ? await admin
            .from("payments")
            .select("id, event_booking_id, pos_sale_id, created_at")
            .in("event_booking_id", pendingEventBookingIds)
            .order("created_at", { ascending: false })
        : { data: [] as Array<{ id: string; event_booking_id: string | null; pos_sale_id: string | null }> };
    const paymentByEventBookingId = new Map<string, { payment_id: string; pos_sale_id: string | null }>();
    for (const payment of pendingEventPaymentsRaw ?? []) {
      if (!payment.event_booking_id || paymentByEventBookingId.has(payment.event_booking_id)) continue;
      paymentByEventBookingId.set(payment.event_booking_id, {
        payment_id: payment.id,
        pos_sale_id: payment.pos_sale_id,
      });
    }

    const eventGroups: Array<{
      event_id: string;
      event_title: string;
      start_time: string;
      address: string | null;
      capacity: number;
      spots_left: number;
      active_booking_count: number;
      pending_checkin_count: number;
      attendees: Array<{
        event_booking_id: string;
        label: string;
        guest_email: string | null;
        status: "pending" | "booked" | "attended" | "cancelled";
        payment_id: string | null;
        pos_sale_id: string | null;
      }>;
    }> = [];

    for (const eventRow of events ?? []) {
      const rawList = eventBookingsByEvent.get(eventRow.id) ?? [];
      if (!rawList.length) continue;

      const attendees = rawList
        .map((booking) => {
          const u = Array.isArray(booking.users) ? booking.users[0] : booking.users;
          const label = (booking.guest_name?.trim() || u?.email?.trim() || booking.guest_email?.trim() || "Guest") as string;
          const status =
            booking.status === "cancelled"
              ? "cancelled"
              : booking.status === "attended"
                ? "attended"
                : booking.status === "booked"
                  ? "booked"
                  : "pending";
          const payment = status === "pending" ? paymentByEventBookingId.get(booking.id) : undefined;
          return {
            event_booking_id: booking.id,
            label,
            guest_email: booking.guest_email ?? u?.email ?? null,
            status: status as "pending" | "booked" | "attended" | "cancelled",
            payment_id: payment?.payment_id ?? null,
            pos_sale_id: payment?.pos_sale_id ?? null,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

      const activeAttendees = attendees.filter((attendee) => attendee.status !== "cancelled");
      eventGroups.push({
        event_id: eventRow.id,
        event_title: eventRow.title ?? "Event",
        start_time: eventRow.start_time ?? new Date().toISOString(),
        address: (eventRow as { address?: string | null }).address ?? null,
        capacity: Number((eventRow as { capacity?: number }).capacity ?? 0),
        spots_left: Number((eventRow as { spots_left?: number }).spots_left ?? 0),
        active_booking_count: activeAttendees.length,
        pending_checkin_count: activeAttendees.filter((attendee) => attendee.status === "booked").length,
        attendees,
      });
    }

    return { starting_soon_grouped: grouped, event_groups: eventGroups };
  },
  ["operations-queue-v3"],
  { revalidate: 5 },
);

function normalizeDateRange(dateFrom: string | null, dateTo: string | null) {
  const fallbackDate = localISODate();
  const startText = dateFrom ?? dateTo ?? fallbackDate;
  const endText = dateTo ?? dateFrom ?? fallbackDate;
  const normalizedStartText = dateFrom && dateTo && dateFrom > dateTo ? endText : startText;
  const normalizedEndText = dateFrom && dateTo && dateFrom > dateTo ? startText : endText;

  const startIso = dayRangeStartIso(normalizedStartText);
  const endIso = dayRangeEndExclusiveIso(normalizedEndText);
  if (startIso && endIso) {
    return { startIso, endIso };
  }

  const fallbackStartIso = dayRangeStartIso(fallbackDate) ?? new Date().toISOString();
  const fallbackEndIso = dayRangeEndExclusiveIso(fallbackDate) ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  return { startIso: fallbackStartIso, endIso: fallbackEndIso };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const studioIdInput = url.searchParams.get("studio_id");
  const locationIdInput = url.searchParams.get("location_id");
  const sessionStatusInput = url.searchParams.get("session_status");
  const sessionStatus =
    sessionStatusInput === "scheduled" || sessionStatusInput === "cancelled"
      ? sessionStatusInput
      : "all";

  const { startIso, endIso } = normalizeDateRange(
    url.searchParams.get("date_from"),
    url.searchParams.get("date_to"),
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  const allStudioIds = filterStudioIdsByRoles(
    ctx,
    [...new Set(ctx.memberships.map((m) => m.studio_id))],
    ["owner", "manager", "frontdesk"],
  );
  if (allStudioIds.length === 0) {
    return NextResponse.json({ starting_soon_grouped: [], event_groups: [] });
  }

  const studioIds =
    studioIdInput && allStudioIds.includes(studioIdInput) ? [studioIdInput] : allStudioIds;
  const selectedStudioId = studioIds.length === 1 ? studioIds[0] : null;
  const locationId =
    locationIdInput &&
    ctx.locations.some(
      (l) => l.id === locationIdInput && (selectedStudioId ? l.studio_id === selectedStudioId : true),
    )
      ? locationIdInput
      : null;

  const admin = createAdminClient();
  const effectiveStudioId =
    studioIdInput && allStudioIds.includes(studioIdInput)
      ? studioIdInput
      : studioIds.length === 1
        ? studioIds[0]
        : null;
  if (effectiveStudioId) {
    const blocked = await respondIfStudioContractSuspended(admin, effectiveStudioId);
    if (blocked) return blocked;
  }

  const payload = await getQueuePayloadCached(
    user.id,
    [...studioIds].sort(),
    locationId,
    sessionStatus,
    startIso,
    endIso,
  );
  return NextResponse.json(payload);
}
