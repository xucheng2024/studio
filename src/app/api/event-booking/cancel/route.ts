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
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: scopeRow, error: scopeErr } = await admin
    .from("event_bookings")
    .select("id, status, event_id, events!inner(studio_id, location_id, title)")
    .eq("id", parsed.data.event_booking_id)
    .maybeSingle();

  if (scopeErr || !scopeRow) {
    return NextResponse.json({ error: "event_booking_not_found" }, { status: 404 });
  }

  const eventRow = Array.isArray(scopeRow.events) ? scopeRow.events[0] : scopeRow.events;
  const studioId = eventRow?.studio_id ?? null;
  if (!studioId) {
    return NextResponse.json({ error: "event_booking_not_found" }, { status: 404 });
  }

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId,
    locationId: eventRow.location_id ?? null,
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) {
    return staffScopeFailureResponse(scoped);
  }

  const blocked = await respondIfStudioContractSuspended(admin, studioId);
  if (blocked) return blocked;

  const { data: rpcData, error: rpcErr } = await admin.rpc("staff_cancel_event_booking", {
    p_event_booking_id: parsed.data.event_booking_id,
    p_actor_id: user.id,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });

  const result = rpcData as { ok?: boolean; error?: string; already_cancelled?: boolean };
  if (!result?.ok) {
    return NextResponse.json({ error: result?.error ?? "cancel_failed" }, { status: 409 });
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: "staff",
    action: "cancel",
    targetType: "event_booking",
    targetId: parsed.data.event_booking_id,
    beforeState: { status: scopeRow.status ?? null },
    afterState: { status: "cancelled", already_cancelled: result.already_cancelled === true },
  });

  return NextResponse.json({ ok: true, already_cancelled: result.already_cancelled === true });
}
