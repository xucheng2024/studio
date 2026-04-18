import { redirect } from "next/navigation";
import { CheckInApiButton } from "@/components/CheckInApiButton";
import { bestRole, buildAccessContext } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createClient } from "@/lib/supabase/server";

export default async function InstructorSessionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ctx = await buildAccessContext({ userId: user.id, email: user.email });
  if (bestRole(ctx) !== "instructor" && ctx.hasSuspendedBackofficeAccess) {
    redirect("/account/suspended");
  }
  if (bestRole(ctx) !== "instructor") {
    return <p className={ui.muted}>Instructor access only.</p>;
  }

  const { data: instructors } = await supabase
    .from("instructors")
    .select("id")
    .eq("email", user.email ?? "")
    .limit(1);
  const instructorId = instructors?.[0]?.id;
  if (!instructorId) {
    return <p className={ui.muted}>No instructor profile matched your account yet.</p>;
  }

  const { data: sessions } = await supabase
    .from("class_sessions")
    .select(
      `
      id,
      start_time,
      end_time,
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
    .order("start_time", { ascending: true })
    .limit(100);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className={ui.h1}>My Sessions</h1>
      <div className="mt-6 space-y-3">
        {(sessions ?? []).map((s) => {
          const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
          const attendees = (s.bookings ?? []) as {
            id: string;
            status: string;
            client_id: string | null;
            guest_name?: string | null;
            guest_email?: string | null;
            users?: { email?: string | null } | null;
          }[];
          return (
            <div key={s.id} className={ui.card}>
              <p className="font-medium text-stone-900 dark:text-stone-100">{cls?.title ?? "Class"}</p>
              <p className={`mt-1 text-sm ${ui.muted}`}>
                {new Date(s.start_time).toLocaleString()} - {new Date(s.end_time).toLocaleTimeString()} ({s.status})
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                {attendees.map((b) => (
                  <li key={b.id} className="flex items-center gap-2">
                    <span className="text-stone-800 dark:text-stone-200">
                      {b.client_id
                        ? (b.users?.email ?? b.client_id)
                        : `${b.guest_name ?? "Guest"} · ${b.guest_email ?? ""}`}
                    </span>
                    <span className={ui.muted}>({b.status})</span>
                    {b.status === "booked" ? <CheckInApiButton bookingId={b.id} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
