import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { bestRole, buildAccessContext } from "@/lib/rbac";
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
  const ctx = await buildAccessContext({ userId: user.id });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk", "instructor"].includes(role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
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
      results.push({ booking_id: bookingId, ok: true });
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
