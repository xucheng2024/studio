import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { resolveInstructorIdForEmail, resolveStaffActorRoleForStudio } from "@/lib/instructor-access";
import { bestRole, buildAccessContext, hasAnyRole } from "@/lib/rbac";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  booking_ids: z.array(z.string().uuid()).min(1).max(200),
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
  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  if (!hasAnyRole(ctx, ["owner", "manager", "frontdesk", "instructor"])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: bulkBookings } = await admin
    .from("bookings")
    .select("id, class_sessions!inner(classes!inner(studio_id, instructor_id))")
    .in("id", parsed.data.booking_ids);
  const bookingsById = new Map<string, { studioId: string | null; instructorId: string | null }>();
  const bulkStudioIds = new Set<string>();
  for (const b of bulkBookings ?? []) {
    const session = b.class_sessions as
      | { classes?: { studio_id?: string; instructor_id?: string | null } | { studio_id?: string; instructor_id?: string | null }[] | null }
      | { classes?: { studio_id?: string; instructor_id?: string | null } | { studio_id?: string; instructor_id?: string | null }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const sid = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
    const instructorId = Array.isArray(classes) ? classes[0]?.instructor_id : classes?.instructor_id;
    if (sid) bulkStudioIds.add(sid);
    bookingsById.set(b.id, { studioId: sid ?? null, instructorId: instructorId ?? null });
  }
  for (const sid of bulkStudioIds) {
    const blocked = await respondIfStudioContractSuspended(admin, sid);
    if (blocked) return blocked;
  }

  const staffStudioIds = new Set(
    ctx.memberships
      .filter((membership) => ["owner", "manager", "frontdesk"].includes(membership.role))
      .map((membership) => membership.studio_id),
  );

  let instructorId: string | null = null;
  if ([...bookingsById.values()].some((booking) => booking.studioId && !ctx.isSuperAdmin && !staffStudioIds.has(booking.studioId))) {
    instructorId = await resolveInstructorIdForEmail(admin, user.email);
    if (!instructorId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  for (const bookingId of parsed.data.booking_ids) {
    const booking = bookingsById.get(bookingId);
    if (!booking?.studioId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const hasBackofficeAccess = ctx.isSuperAdmin || staffStudioIds.has(booking.studioId);
    if (hasBackofficeAccess) continue;
    if (!instructorId || !booking.instructorId || booking.instructorId !== instructorId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const results: { booking_id: string; ok: boolean; error?: string }[] = [];
  for (const bookingId of parsed.data.booking_ids) {
    const { data, error } = await admin.rpc("checkin_booking", {
      p_booking_id: bookingId,
      p_actor_id: user.id,
    });
    if (error) {
      results.push({ booking_id: bookingId, ok: false, error: error.message });
      continue;
    }
    const r = data as { ok?: boolean; error?: string };
    if (!r?.ok && r?.error === "not_booked") {
      // "not_booked" means the booking status is not 'booked' (e.g. cancelled,
      // already attended, or wrong session). Treat as a real failure so callers
      // know which IDs were not actually checked in.
      results.push({ booking_id: bookingId, ok: false, error: "not_booked" });
      continue;
    }
    if (!r?.ok) {
      results.push({ booking_id: bookingId, ok: false, error: r?.error ?? "checkin_failed" });
      continue;
    }
    const booking = bookingsById.get(bookingId);
    const actorRole =
      booking?.studioId && (ctx.isSuperAdmin || staffStudioIds.has(booking.studioId))
        ? resolveStaffActorRoleForStudio(ctx, booking.studioId) ?? bestRole(ctx)
        : "instructor";
    await writeOperationAudit({
      actorId: user.id,
      actorRole,
      action: "bulk_checkin",
      targetType: "booking",
      targetId: bookingId,
      afterState: { status: "attended" },
    });
    results.push({ booking_id: bookingId, ok: true });
  }
  return NextResponse.json({ ok: true, results });
}
