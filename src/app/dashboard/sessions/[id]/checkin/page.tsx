import { redirect } from "next/navigation";
import { CancelBookingButton } from "@/components/CancelBookingButton";
import { DashboardAppLink } from "@/components/DashboardAppLink";
import { CheckInToggleButton } from "@/components/CheckInToggleButton";
import { getDashboardScope } from "@/lib/dashboard";
import { bestRole } from "@/lib/rbac";
import { ui } from "@/lib/ui";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ studio_id?: string; location_id?: string; date_from?: string; date_to?: string; session_status?: string; status?: string }>;
};

export default async function SessionCheckinPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { ctx } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk", "instructor"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from("class_sessions")
    .select("id, start_time, class_title_snapshot, classes!inner(title, studio_id, instructor_id), locations(name)")
    .eq("id", id)
    .maybeSingle();
  if (!session) return <p className={ui.muted}>Session not found.</p>;

  const cls = Array.isArray(session.classes) ? session.classes[0] : session.classes;
  const studioId = cls?.studio_id ?? null;
  if (!studioId || !ctx.memberships.some((m) => m.studio_id === studioId)) {
    return <p className={ui.muted}>Forbidden.</p>;
  }

  if (role === "instructor") {
    const { data: instructor } = await admin
      .from("instructors")
      .select("id")
      .eq("email", user.email ?? "")
      .maybeSingle();
    if (!instructor?.id || cls?.instructor_id !== instructor.id) {
      return <p className={ui.muted}>Forbidden.</p>;
    }
  }

  const { data: bookingRows } = await admin
    .from("bookings")
    .select("id, client_id, status, guest_name, guest_email, guest_phone, users(email)")
    .eq("session_id", id)
    .in("status", ["booked", "attended"])
    .order("created_at", { ascending: true });

  const clientIds = Array.from(
    new Set((bookingRows ?? []).map((b) => b.client_id).filter((v): v is string => typeof v === "string" && v.length > 0))
  );
  const { data: profileRows } =
    clientIds.length > 0 ? await admin.from("user_profiles").select("id, full_name, phone").in("id", clientIds) : { data: [] };
  const profileById = new Map(
    (profileRows ?? []).map((p) => [p.id, { full_name: p.full_name ?? null, phone: p.phone ?? null }] as const)
  );

  const attendees = (bookingRows ?? []).map((b) => {
    const u = Array.isArray(b.users) ? b.users[0] : b.users;
    const profile = b.client_id ? profileById.get(b.client_id) : null;
    const email = b.guest_email ?? u?.email ?? null;
    const name = b.guest_name?.trim() || profile?.full_name?.trim() || null;
    const phone = b.guest_phone?.trim() || profile?.phone?.trim() || null;
    const label = name || email?.trim() || "Guest";
    const status = (b.status === "attended" ? "attended" : "booked") as "booked" | "attended";
    return { id: b.id, label, name, email, phone, status };
  });

  const checkedInCount = attendees.filter((a) => a.status === "attended").length;
  const total = attendees.length;
  const dt = session.start_time ? new Date(session.start_time) : null;
  const timeLabel = dt
    ? dt.toLocaleString("en-SG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
  const loc = session.locations as { name?: string | null } | { name?: string | null }[] | null | undefined;
  const locationName = Array.isArray(loc) ? loc[0]?.name ?? null : loc?.name ?? null;

  const backParams = new URLSearchParams();
  if (sp.studio_id) backParams.set("studio_id", sp.studio_id);
  if (sp.location_id) backParams.set("location_id", sp.location_id);
  if (sp.date_from) backParams.set("date_from", sp.date_from);
  if (sp.date_to) backParams.set("date_to", sp.date_to);
  if (sp.session_status) backParams.set("session_status", sp.session_status);
  else if (sp.status) backParams.set("session_status", sp.status);
  const backHref = `/dashboard/operations${backParams.toString() ? `?${backParams.toString()}` : ""}`;

  return (
    <div className={ui.pageNarrow}>
      <div className="flex flex-col gap-4">
        <DashboardAppLink href={backHref} className={ui.btnSecondarySm}>
          ← Back to sessions
        </DashboardAppLink>

        <section className={ui.card}>
          <h1 className={ui.h1}>{(session as { class_title_snapshot?: string | null }).class_title_snapshot ?? cls?.title ?? "Session"}</h1>
          <p className={`mt-1 ${ui.muted}`}>{timeLabel}</p>
          {locationName ? <p className={`mt-1 ${ui.muted}`}>{locationName}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={ui.badgeNeutral}>Enrolled: {total}</span>
            <span className={ui.badge}>Checked-in: {checkedInCount}</span>
            <span className={ui.badgeAmber}>Pending: {Math.max(0, total - checkedInCount)}</span>
          </div>
        </section>

        <section className={ui.card}>
          <h2 className={ui.h2}>Attendees</h2>
          {attendees.length === 0 ? (
            <div className={`mt-3 ${ui.emptyState}`}>
              <p className={ui.muted}>No attendees yet for this session.</p>
              <p className={`text-xs ${ui.muted}`}>Bookings will appear here once payment is confirmed.</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {attendees.map((a) => (
                <li
                  key={a.id}
                  className="rounded-xl border border-stone-100 bg-stone-50/60 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{a.label}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {a.email && a.email !== a.label ? <p className={`truncate text-xs ${ui.muted}`}>{a.email}</p> : null}
                      {a.phone ? <p className={`text-xs ${ui.muted}`}>{a.phone}</p> : null}
                      <span className={a.status === "attended" ? ui.badge : ui.badgeNeutral}>
                        {a.status === "attended" ? "Checked-in" : "Booked"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <CheckInToggleButton bookingId={a.id} status={a.status} />
                    {a.status === "booked" ? <CancelBookingButton bookingId={a.id} label={a.label} /> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
