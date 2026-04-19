import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { bestRole, buildAccessContext } from "@/lib/rbac";
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
  const ctx = await buildAccessContext({ userId: user.id, email: user.email });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk", "instructor"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: bulkBookings } = await admin
    .from("bookings")
    .select("id, class_sessions!inner(classes!inner(studio_id))")
    .in("id", parsed.data.booking_ids);
  const bulkStudioIds = new Set<string>();
  for (const b of bulkBookings ?? []) {
    const session = b.class_sessions as
      | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }
      | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const sid = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
    if (sid) bulkStudioIds.add(sid);
  }
  for (const sid of bulkStudioIds) {
    const blocked = await respondIfStudioContractSuspended(admin, sid);
    if (blocked) return blocked;
  }

  let instructorId: string | null = null;
  let allowedBookingIds: Set<string> | null = null;
  if (role === "instructor") {
    const { data: instructor } = await admin
      .from("instructors")
      .select("id")
      .eq("email", user.email ?? "")
      .maybeSingle();
    instructorId = instructor?.id ?? null;
    if (!instructorId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const { data: ownedBookings } = await admin
      .from("bookings")
      .select("id, class_sessions!inner(classes!inner(instructor_id))")
      .in("id", parsed.data.booking_ids);
    allowedBookingIds = new Set(
      (ownedBookings ?? [])
        .filter((booking) => {
          const session = booking.class_sessions as
            | { classes?: { instructor_id?: string } | { instructor_id?: string }[] | null }
            | { classes?: { instructor_id?: string } | { instructor_id?: string }[] | null }[]
            | null;
          const s = Array.isArray(session) ? session[0] : session;
          const classes = s?.classes;
          const classInstructorId = Array.isArray(classes)
            ? classes[0]?.instructor_id
            : classes?.instructor_id;
          return classInstructorId === instructorId;
        })
        .map((booking) => booking.id),
    );
  }

  const results: { booking_id: string; ok: boolean; error?: string }[] = [];
  for (const bookingId of parsed.data.booking_ids) {
    if (role === "instructor" && !allowedBookingIds?.has(bookingId)) {
      results.push({ booking_id: bookingId, ok: false, error: "forbidden" });
      continue;
    }
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
    await writeOperationAudit({
      actorId: user.id,
      actorRole: role,
      action: "bulk_checkin",
      targetType: "booking",
      targetId: bookingId,
      afterState: { status: "attended" },
    });
    results.push({ booking_id: bookingId, ok: true });
  }
  return NextResponse.json({ ok: true, results });
}
