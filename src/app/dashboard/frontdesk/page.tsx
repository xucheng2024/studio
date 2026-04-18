import { DashboardAppLink } from "@/components/DashboardAppLink";
import { BulkCheckinPanel } from "@/components/BulkCheckinPanel";
import { FrontdeskWalkinForm } from "@/components/FrontdeskWalkinForm";
import { SubmitButton } from "@/components/SubmitButton";
import { getDashboardScope } from "@/lib/dashboard";
import { badgeToneClass, getUnifiedStatusBadges } from "@/lib/order-status";
import { ui } from "@/lib/ui";
import { bestRole } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

type Props = { searchParams: Promise<{ q?: string; studio_id?: string; location_id?: string }> };

export default async function FrontdeskPage({ searchParams }: Props) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { ctx, studioIds, selectedStudioId, selectedLocationId } = await getDashboardScope({
    userId: user.id,
    studioId: sp.studio_id ?? null,
    locationId: sp.location_id ?? null,
  });
  const role = bestRole(ctx);
  if (!["owner", "manager", "frontdesk"].includes(role)) {
    return <p className={ui.muted}>You do not have access to this page.</p>;
  }
  if (!selectedStudioId && studioIds.length > 1) {
    return <p className={ui.muted}>Select a studio in the left sidebar to continue.</p>;
  }
  const scopedLocationIds = [
    ...new Set(
      ctx.memberships
        .filter((m) => ["owner", "manager", "frontdesk"].includes(m.role))
        .map((m) => m.location_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const hasGlobalScope = role === "owner" || ctx.memberships.some((m) => m.location_id == null);
  const q = (sp.q ?? "").trim();
  const crossPageParams = new URLSearchParams();
  if (selectedStudioId) crossPageParams.set("studio_id", selectedStudioId);
  if (selectedLocationId) crossPageParams.set("location_id", selectedLocationId);
  if (q) crossPageParams.set("q", q);

  let sessionsQuery = supabase
    .from("class_sessions")
    .select(
      "id, start_time, location_id, classes!inner(title, studio_id), bookings(id, status, guest_name, guest_email, users(email))",
    )
    .in("classes.studio_id", studioIds)
    .gte("start_time", new Date().toISOString())
    .order("start_time", { ascending: true })
    .limit(20);
  if (selectedLocationId) {
    sessionsQuery = sessionsQuery.eq("location_id", selectedLocationId);
  } else if (!hasGlobalScope && scopedLocationIds.length > 0) {
    sessionsQuery = sessionsQuery.in("location_id", scopedLocationIds);
  }
  const { data: sessions } = await sessionsQuery;

  let rowsQuery = q
    ? supabase
        .from("bookings")
        .select(
          "id, guest_name, guest_email, guest_phone, status, users(email), class_sessions!inner(location_id, classes!inner(studio_id))",
        )
        .in("class_sessions.classes.studio_id", studioIds)
        .or(`guest_name.ilike.%${q}%,guest_email.ilike.%${q}%,guest_phone.ilike.%${q}%`)
        .order("created_at", { ascending: false })
        .limit(30)
    : null;
  if (rowsQuery && !hasGlobalScope && scopedLocationIds.length > 0) {
    rowsQuery = rowsQuery.in("class_sessions.location_id", scopedLocationIds);
  }
  const { data: rows } = rowsQuery ? await rowsQuery : { data: [] as const };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className={ui.h1}>Front desk</h1>
        <p className={ui.muted}>Handle walk-ins, quick member search, and class check-in.</p>
        <p className={`mt-2 text-xs ${ui.muted}`}>
          Open from Operations to keep filters and queue context aligned.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <DashboardAppLink href={`/dashboard/operations?${crossPageParams.toString()}`} className={ui.btnSecondarySm}>
            Back to operations
          </DashboardAppLink>
        </div>
      </div>
      <FrontdeskWalkinForm
        sessions={(sessions ?? []).map((s) => {
          const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
          return {
            id: s.id,
            label: `${cls?.title ?? "Class"} · ${new Date(s.start_time).toLocaleString()}`,
          };
        })}
      />

      <section className={ui.card}>
        <h2 className={ui.h2}>Quick search</h2>
        <form className="mt-2 flex flex-col gap-2 sm:flex-row" method="get">
          {selectedStudioId ? <input type="hidden" name="studio_id" value={selectedStudioId} /> : null}
          {selectedLocationId ? <input type="hidden" name="location_id" value={selectedLocationId} /> : null}
          <input name="q" defaultValue={q} className={ui.input} placeholder="name / phone / email" />
          <SubmitButton className={`${ui.btnSecondary} w-full sm:w-auto`} pendingText="Searching...">
            Search
          </SubmitButton>
        </form>
        <ul className="mt-3 space-y-2">
          {(rows ?? []).map((r) => {
            const userObj = Array.isArray(r.users) ? r.users[0] : r.users;
            return (
              <li key={r.id} className={ui.card}>
                <p className="text-sm text-stone-900 dark:text-stone-100">
                  {userObj?.email ?? `${r.guest_name ?? "Guest"} · ${r.guest_email ?? r.guest_phone ?? "-"}`}
                </p>
                {(() => {
                  const booking = getUnifiedStatusBadges({ booking_status: r.status }).booking;
                  return (
                    <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs ${badgeToneClass(booking.tone)}`}>
                      {booking.text}
                    </span>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={ui.card}>
        <h2 className={ui.h2}>Bulk check-in</h2>
        <p className={`mt-1 text-xs ${ui.muted}`}>Open a class card and check in attendees quickly before start.</p>
        <div className="mt-3 space-y-3">
          {(sessions ?? []).map((s) => {
            const cls = Array.isArray(s.classes) ? s.classes[0] : s.classes;
            const attendees = ((s.bookings ?? []) as {
              id: string;
              status: string;
              guest_name?: string | null;
              guest_email?: string | null;
              users?: { email?: string | null } | { email?: string | null }[] | null;
            }[]).map((b) => {
              const userObj = Array.isArray(b.users) ? b.users[0] : b.users;
              return {
                id: b.id,
                status: b.status,
                label: userObj?.email ?? `${b.guest_name ?? "Guest"} · ${b.guest_email ?? "-"}`,
              };
            });
            return (
              <BulkCheckinPanel
                key={s.id}
                sessionLabel={`${cls?.title ?? "Class"} · ${new Date(s.start_time).toLocaleString()}`}
                attendees={attendees}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}
