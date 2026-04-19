import { NextResponse } from "next/server";
import { notifyCronFailure } from "@/lib/cronAlert";
import { sendClassReminder } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  // Require the secret to be configured – absence of CRON_SECRET is not a free pass
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 5 * 60 * 1000);
  const { data: rows, error } = await admin
    .from("bookings")
    .select(
      `
      id,
      client_id,
      guest_email,
      reminder_sent_at,
      class_sessions!inner (
        start_time,
        classes!inner ( title )
      )
    `,
    )
    .eq("status", "booked")
    .is("reminder_sent_at", null)
    .gte("class_sessions.start_time", start.toISOString())
    .lt("class_sessions.start_time", end.toISOString())
    .limit(500);
  if (error) {
    await notifyCronFailure({ job: "class_reminder", error: error.message });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let sent = 0;
  for (const b of rows ?? []) {
    let to = b.guest_email ?? null;
    if (b.client_id) {
      const { data: u } = await admin.from("users").select("email").eq("id", b.client_id).maybeSingle();
      to = u?.email ?? to;
    }
    if (!to) continue;
    const session = b.class_sessions as
      | { start_time?: string; classes?: { title?: string } | { title?: string }[] | null }
      | { start_time?: string; classes?: { title?: string } | { title?: string }[] | null }[]
      | null;
    const s = Array.isArray(session) ? session[0] : session;
    const classes = s?.classes;
    const title = Array.isArray(classes) ? classes[0]?.title : classes?.title;
    await sendClassReminder({
      to,
      sessionTitle: title ?? "Class",
      startTime: s?.start_time ? new Date(s.start_time).toLocaleString() : "",
    });
    await admin.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
    sent += 1;
  }

  return NextResponse.json({ ok: true, sent });
}
