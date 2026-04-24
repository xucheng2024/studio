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
    return NextResponse.json({ starting_soon_grouped: [] });
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
    .select("id, location_id, start_time, status, locations(name), classes!inner(title, studio_id)")
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
      total_booked: attendees.length,
      pending_checkin_count: attendees.filter((a) => a.status === "booked").length,
      attendees,
    });
  }

  return NextResponse.json({ starting_soon_grouped: grouped });
}
