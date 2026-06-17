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
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk", "instructor"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: bookingForStudio } = await admin
    .from("bookings")
    .select("id, class_sessions!inner(classes!inner(studio_id))")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  const sessionForContract = bookingForStudio?.class_sessions as
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }[]
    | null;
  const sC = Array.isArray(sessionForContract) ? sessionForContract[0] : sessionForContract;
  const classesC = sC?.classes;
  const checkinStudioId = Array.isArray(classesC) ? classesC[0]?.studio_id : classesC?.studio_id;
  if (!checkinStudioId) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const blocked = await respondIfStudioContractSuspended(admin, checkinStudioId);
  if (blocked) return blocked;
  if (
    role !== "instructor"
    && !ctx.isSuperAdmin
    && !ctx.memberships.some(
      (m) => m.studio_id === checkinStudioId && ["owner", "manager", "frontdesk"].includes(m.role),
    )
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (role === "instructor") {
    const { data: booking } = await admin
      .from("bookings")
      .select("id, session_id, class_sessions!inner(classes!inner(instructor_id))")
      .eq("id", parsed.data.booking_id)
      .maybeSingle();
    const session = booking?.class_sessions as
      | { classes?: { instructor_id?: string } | { instructor_id?: string }[] | null }
      | { classes?: { instructor_id?: string } | { instructor_id?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const classInstructorId = Array.isArray(classes) ? classes[0]?.instructor_id : classes?.instructor_id;
    const { data: instructor } = await admin
      .from("instructors")
      .select("id")
      .eq("email", user.email ?? "")
      .maybeSingle();
    if (!classInstructorId || !instructor?.id || classInstructorId !== instructor.id) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const { data, error } = await admin.rpc("checkin_booking", {
    p_booking_id: parsed.data.booking_id,
    p_actor_id: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = data as { ok?: boolean; error?: string };
  if (!result?.ok) {
    const status = result?.error === "forbidden" ? 403 : result?.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result?.error ?? "checkin_failed" }, { status });
  }
  await writeOperationAudit({
    actorId: user.id,
    actorRole: role,
    action: "checkin",
    targetType: "booking",
    targetId: parsed.data.booking_id,
    afterState: { status: "attended" },
  });
  return NextResponse.json({ ok: true });
}
