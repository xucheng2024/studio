import { NextResponse } from "next/server";
import { notifyCronFailure } from "@/lib/cronAlert";
import { writeOperationAudit } from "@/lib/audit";
import { sendBookingOutcomeNotice } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  // Require the secret to be configured – absence of CRON_SECRET is not a free pass
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("process_no_show_bookings", { p_limit: 500 });
  if (error) {
    await notifyCronFailure({ job: "no_show_process", error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: noShows } = await admin
    .from("bookings")
    .select(
      `
      id,
      guest_email,
      client_id,
      outcome_notified_at,
      credit_policy_applied,
      class_sessions (
        classes ( title )
      )
    `,
    )
    .eq("status", "no_show")
    .is("outcome_notified_at", null)
    .gt("no_show_marked_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .limit(200);

  for (const b of noShows ?? []) {
    let to = b.guest_email ?? null;
    if (b.client_id) {
      const { data: u } = await admin.from("users").select("email").eq("id", b.client_id).maybeSingle();
      to = u?.email ?? to;
    }
    if (!to) continue;
    const session = b.class_sessions as
      | { classes?: { title?: string } | { title?: string }[] | null }
      | { classes?: { title?: string } | { title?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const title = Array.isArray(classes) ? classes[0]?.title : classes?.title;
    const policy = b.credit_policy_applied as { credit_returned?: boolean } | null;
    await sendBookingOutcomeNotice({
      to,
      sessionTitle: title ?? "Class",
      status: "no_show",
      creditReturned: Boolean(policy?.credit_returned),
    });
    await admin.from("bookings").update({ outcome_notified_at: new Date().toISOString() }).eq("id", b.id);
    await writeOperationAudit({
      action: "mark_no_show",
      targetType: "booking",
      targetId: b.id,
      afterState: { status: "no_show", credit_returned: Boolean(policy?.credit_returned) },
    });
  }

  return NextResponse.json({ ok: true, processed: Number(data ?? 0), notified: (noShows ?? []).length });
}
