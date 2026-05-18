import { NextResponse } from "next/server";
import { bestRole, buildAccessContext } from "@/lib/rbac";
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

function normalizeDateRange(dateFrom: string | null, dateTo: string | null) {
  if (!dateFrom && !dateTo) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startIso: start.toISOString(), endIso: end.toISOString() };
  }

  const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
  const end = dateTo ? new Date(`${dateTo}T00:00:00`) : null;

  if (!start || Number.isNaN(start.getTime())) {
    const s = new Date();
    s.setHours(0, 0, 0, 0);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return { startIso: s.toISOString(), endIso: e.toISOString() };
  }

  if (!end || Number.isNaN(end.getTime())) {
    const e = new Date(start);
    e.setDate(e.getDate() + 1);
    return { startIso: start.toISOString(), endIso: e.toISOString() };
  }

  end.setDate(end.getDate() + 1);
  if (start > end) return { startIso: end.toISOString(), endIso: start.toISOString() };
  return { startIso: start.toISOString(), endIso: end.toISOString() };
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
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const allStudioIds = [...new Set(ctx.memberships.map((m) => m.studio_id))];
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
          .in("status", ["booked", "attended"])
      : { data: [] as SoonBookingRow[] };

  const bookings = (bookingsRaw ?? []) as SoonBookingRow[];
  const bookingsBySession = new Map<string, SoonBookingRow[]>();
  for (const b of bookings) {
    const prev = bookingsBySession.get(b.session_id) ?? [];
    bookingsBySession.set(b.session_id, [...prev, b]);
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
      status: "booked" | "attended";
    }>;
  }> = [];

  for (const sessionRow of sessions ?? []) {
    const rawList = bookingsBySession.get(sessionRow.id) ?? [];
    const attendees = rawList
      .map((b) => {
        const u = Array.isArray(b.users) ? b.users[0] : b.users;
        const label = (b.guest_name?.trim() || u?.email?.trim() || b.guest_email?.trim() || "Guest") as string;
        return {
          booking_id: b.id,
          label,
          guest_email: b.guest_email ?? u?.email ?? null,
          status: (b.status === "attended" ? "attended" : "booked") as "booked" | "attended",
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
      total_booked: attendees.length,
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
        return {
          event_booking_id: booking.id,
          label,
          guest_email: booking.guest_email ?? u?.email ?? null,
          status: status as "pending" | "booked" | "attended" | "cancelled",
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

  return NextResponse.json({ starting_soon_grouped: grouped, event_groups: eventGroups });
}
