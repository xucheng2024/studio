import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { respondIfStudioContractSuspended } from "@/lib/studio-contract";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  event_booking_id: z.string().uuid(),
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

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("event_bookings")
    .select("id, location_id, events!inner(studio_id)")
    .eq("id", parsed.data.event_booking_id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ev = row.events as { studio_id?: string } | { studio_id?: string }[] | null;
  const studioId = Array.isArray(ev) ? ev[0]?.studio_id : ev?.studio_id;
  if (!studioId) return NextResponse.json({ error: "invalid_booking" }, { status: 409 });

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId,
    locationId: row.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const { data, error } = await admin.rpc("uncheckin_event_booking", {
    p_event_booking_id: parsed.data.event_booking_id,
    p_actor_id: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = data as { ok?: boolean; error?: string };
  if (!result?.ok) {
    const status = result?.error === "forbidden" ? 403 : result?.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result?.error ?? "uncheckin_failed" }, { status });
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: scoped.role,
    action: "event_uncheckin",
    targetType: "event_booking",
    targetId: parsed.data.event_booking_id,
    afterState: { status: "booked" },
  });
  return NextResponse.json({ ok: true });
}
