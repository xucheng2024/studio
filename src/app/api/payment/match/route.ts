import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { requireStaffScope, staffScopeFailureResponse } from "@/lib/scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  payment_id: z.string().uuid(),
  booking_id: z.string().uuid(),
  recon_note: z.string().max(300).optional(),
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
  const { data: payment } = await admin
    .from("payments")
    .select("id, studio_id, location_id, booking_id")
    .eq("id", parsed.data.payment_id)
    .maybeSingle();
  if (!payment || !payment.studio_id) return NextResponse.json({ error: "payment_not_found" }, { status: 404 });

  const { data: booking } = await admin
    .from("bookings")
    .select("id, location_id, class_sessions!inner(classes!inner(studio_id))")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  if (!booking) return NextResponse.json({ error: "booking_not_found" }, { status: 404 });
  const session = booking.class_sessions as
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }[]
    | null;
  const s = Array.isArray(session) ? session[0] : session;
  const classes = s?.classes;
  const bookingStudioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
  if (!bookingStudioId || bookingStudioId !== payment.studio_id) {
    return NextResponse.json({ error: "scope_mismatch" }, { status: 409 });
  }

  const scoped = await requireStaffScope({
    userId: user.id,
    studioId: payment.studio_id,
    locationId: payment.location_id ?? (booking.location_id ?? null),
    roles: ["owner", "manager", "frontdesk"],
  });
  if (!scoped.ok) return staffScopeFailureResponse(scoped);

  const { error: matchErr } = await admin
    .from("payments")
    .update({
      booking_id: parsed.data.booking_id,
      recon_status: "manual_review",
      recon_note: parsed.data.recon_note?.trim() || "manual matched",
    })
    .eq("id", payment.id);

  if (matchErr) {
    return NextResponse.json({ error: matchErr.message }, { status: 500 });
  }

  await writeOperationAudit({
    actorId: user.id,
    actorRole: scoped.role,
    action: "payment_manual_match",
    targetType: "payment",
    targetId: payment.id,
    beforeState: { booking_id: payment.booking_id },
    afterState: { booking_id: parsed.data.booking_id, recon_status: "manual_review" },
  });
  return NextResponse.json({ ok: true });
}
