import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  booking_id: z.string().uuid(),
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
  if (!ctx.isSuperAdmin && ![...ctx.roles].some((role) => ["owner", "manager", "frontdesk", "instructor"].includes(role))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: bookingForScope } = await admin
    .from("bookings")
    .select("id, status, class_sessions!inner(classes!inner(studio_id, instructor_id))")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  if (!bookingForScope) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const session = bookingForScope.class_sessions as
    | { classes?: { studio_id?: string; instructor_id?: string | null } | { studio_id?: string; instructor_id?: string | null }[] | null }
    | { classes?: { studio_id?: string; instructor_id?: string | null } | { studio_id?: string; instructor_id?: string | null }[] | null }[]
    | null;
  const s = Array.isArray(session) ? session[0] : session;
  const classes = s?.classes;
  const studioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
  const classInstructorId = Array.isArray(classes) ? classes[0]?.instructor_id : classes?.instructor_id;
  if (!studioId) return NextResponse.json({ error: "invalid_booking" }, { status: 409 });

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const hasBackofficeAccess =
    ctx.isSuperAdmin
    || ctx.memberships.some(
      (membership) => membership.studio_id === studioId && ["owner", "manager", "frontdesk"].includes(membership.role),
    );

  if (!hasBackofficeAccess) {
    const { data: instructor } = await admin
      .from("instructors")
      .select("id")
      .eq("email", user.email ?? "")
      .maybeSingle();
    if (!classInstructorId || !instructor?.id || classInstructorId !== instructor.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (bookingForScope.status !== "attended") {
    return NextResponse.json({ error: "not_attended" }, { status: 409 });
  }

  const { error: updateErr } = await admin
    .from("bookings")
    .update({ status: "booked", checked_in_at: null })
    .eq("id", parsed.data.booking_id)
    .eq("status", "attended");
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await writeOperationAudit({
    actorId: user.id,
    actorRole: hasBackofficeAccess ? bestRole(ctx) : "instructor",
    action: "uncheckin",
    targetType: "booking",
    targetId: parsed.data.booking_id,
    afterState: { status: "booked" },
  });

  return NextResponse.json({ ok: true });
}
