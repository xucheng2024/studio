import { NextResponse } from "next/server";
import { z } from "zod";
import { writeOperationAudit } from "@/lib/audit";
import { sendBookingOutcomeNotice } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  booking_id: z.string().uuid(),
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
  const { data: bookingScope } = await admin
    .from("bookings")
    .select("id, class_sessions!inner(classes!inner(studio_id))")
    .eq("id", parsed.data.booking_id)
    .maybeSingle();
  const session = bookingScope?.class_sessions as
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }
    | { classes?: { studio_id?: string } | { studio_id?: string }[] | null }[]
    | null;
  const s0 = Array.isArray(session) ? session[0] : session;
  const classes = s0?.classes;
  const cancelStudioId = Array.isArray(classes) ? classes[0]?.studio_id : classes?.studio_id;
  if (cancelStudioId) {
    const { data: st } = await admin.from("studios").select("contract_status").eq("id", cancelStudioId).maybeSingle();
    if (st?.contract_status === "suspended") {
      return NextResponse.json({ error: "studio_suspended" }, { status: 403 });
    }
  }

  const { data, error } = await admin.rpc("cancel_booking_with_rules", {
    p_booking_id: parsed.data.booking_id,
    p_actor_id: user.id,
    p_cancel_reason: "user_cancel",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const result = data as { ok?: boolean; error?: string; status?: string; credit_returned?: boolean };
  if (!result?.ok) {
    const status = result?.error === "forbidden" ? 403 : result?.error === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result?.error ?? "cancel_failed" }, { status });
  }
  await writeOperationAudit({
    actorId: user.id,
    action: "cancel",
    targetType: "booking",
    targetId: parsed.data.booking_id,
    afterState: { status: result.status, credit_returned: result.credit_returned },
  });
  if (result.status === "late_cancel") {
    const { data: booking } = await admin
      .from("bookings")
      .select(
        `
        id,
        guest_email,
        client_id,
        class_sessions (
          classes ( title )
        )
      `,
      )
      .eq("id", parsed.data.booking_id)
      .maybeSingle();
    const session = booking?.class_sessions as
      | { classes?: { title?: string } | { title?: string }[] | null }
      | { classes?: { title?: string } | { title?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const title = Array.isArray(classes) ? classes[0]?.title : classes?.title;
    let to = booking?.guest_email ?? null;
    if (booking?.client_id) {
      const { data: u } = await admin.from("users").select("email").eq("id", booking.client_id).maybeSingle();
      to = u?.email ?? to;
    }
    if (to) {
      await sendBookingOutcomeNotice({
        to,
        sessionTitle: title ?? "Class",
        status: "late_cancel",
        creditReturned: Boolean(result.credit_returned),
      });
      await admin.from("bookings").update({ outcome_notified_at: new Date().toISOString() }).eq("id", parsed.data.booking_id);
    }
  }
  return NextResponse.json({ ok: true, status: result.status, credit_returned: result.credit_returned });
}
