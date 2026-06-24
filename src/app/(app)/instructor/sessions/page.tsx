import { redirect } from "next/navigation";
import { CheckInApiButton } from "@/components/CheckInApiButton";
import { resolveInstructorIdForEmail } from "@/lib/instructor-access";
import { buildAccessContext, hasInstructorRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export default async function InstructorSessionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await buildAccessContext(user.id, user.email ?? null, null);
  if (!hasInstructorRole(ctx) && ctx.hasSuspendedBackofficeAccess) {
    redirect("/account/suspended");
  }
  if (!hasInstructorRole(ctx)) {
    return <p className={ui.muted}>Instructor access only.</p>;
  }

  const admin = createAdminClient();
  const instructorId = await resolveInstructorIdForEmail(admin, user.email);
  if (!instructorId) {
    return <p className={ui.muted}>No instructor profile matched your account yet.</p>;
  }

  const windowStartDate = new Date();
  windowStartDate.setDate(windowStartDate.getDate() - 30);
  const windowStart = windowStartDate.toISOString();
  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      end_time,
      class_title_snapshot,
      status,
      classes!inner(title, instructor_id),
      bookings (
        id,
        status,
        client_id,
        guest_name,
        guest_email,
        users ( email )
      )
    `,
    )
    .eq("classes.instructor_id", instructorId)
    .gte("start_time", windowStart)
    .order("start_time", { ascending: true })
    .limit(100);

  return (
    <main className={ui.page}>
      <header className="mb-6">
        <h1 className={ui.h1}>My sessions</h1>
        <p className={`mt-1 ${ui.muted}`}>Your classes from the past 30 days and upcoming.</p>
      </header>

      {!(sessions ?? []).length ? (
        <div className={ui.emptyState}>
          <p className={`text-sm ${ui.muted}`}>No sessions assigned to you yet.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {(sessions ?? []).map((s) => {
          const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
          const classTitle = (s as { class_title_snapshot?: string | null }).class_title_snapshot ?? cls?.title ?? "Class";
          const attendees = (s.bookings ?? []) as {
            id: string;
            status: string;
            client_id: string | null;
            guest_name?: string | null;
            guest_email?: string | null;
            users?: { email?: string | null } | null;
          }[];
          const dt = new Date(s.start_time);
          const timeLabel = dt.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
          const endLabel = new Date(s.end_time).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
          const weekday = dt.toLocaleDateString("en-SG", { weekday: "short" });
          const dayNum = dt.getDate();
          const month = dt.toLocaleDateString("en-SG", { month: "short" });
          const activeCount = attendees.filter((b) => b.status !== "cancelled").length;
          const statusBg = s.status === "completed"
            ? "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
            : s.status === "cancelled"
              ? "bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400"
              : "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300";
          return (
            <div key={s.id} className={ui.card}>
              {/* Session header */}
              <div className="flex items-start gap-3">
                {/* Calendar block */}
                <div className="flex w-12 shrink-0 flex-col items-center rounded-xl border border-stone-200 bg-stone-50 py-1 dark:border-stone-700 dark:bg-stone-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    {weekday}
                  </span>
                  <span className="text-lg font-bold leading-tight text-stone-900 dark:text-stone-50">
                    {dayNum}
                  </span>
                  <span className="text-[10px] text-stone-500 dark:text-stone-400">
                    {month}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-stone-900 dark:text-stone-100">{classTitle}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBg}`}>
                      {s.status}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-sm ${ui.muted}`}>{timeLabel} – {endLabel}</p>
                  <p className={`mt-0.5 text-xs ${ui.muted}`}>
                    {activeCount} attendee{activeCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>

              {/* Attendee list */}
              {attendees.length > 0 ? (
                <ul className="mt-3 divide-y divide-stone-100 dark:divide-stone-800">
                  {attendees.map((b) => {
                    const name = b.client_id
                      ? (b.users?.email ?? b.client_id)
                      : `${b.guest_name ?? "Guest"}${b.guest_email ? ` · ${b.guest_email}` : ""}`;
                    const isCancelled = b.status === "cancelled";
                    return (
                      <li key={b.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${isCancelled ? "opacity-50" : ""}`}>
                        <span className={`min-w-0 truncate ${isCancelled ? ui.muted : "text-stone-800 dark:text-stone-200"}`}>
                          {name}
                        </span>
                        <div className="flex items-center gap-2">
                          {!isCancelled ? (
                            <span className={`text-xs ${ui.muted} capitalize`}>{b.status}</span>
                          ) : null}
                          {b.status === "booked" ? <CheckInApiButton bookingId={b.id} /> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={`mt-3 text-xs ${ui.muted}`}>No bookings yet.</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
